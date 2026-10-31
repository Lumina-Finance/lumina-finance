"""Transaction import merchant lookup and creation"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field

from fastapi import HTTPException, status
from sqlalchemy import func, literal_column, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.merchant import Merchant
from app.schemas.import_run import MAX_IMPORT_MERCHANT_NAME_LENGTH, TransactionImportMerchantMapping
from app.services.importers.shared.insertion_helpers import insert_import_records_if_absent
from app.services.importers.shared.name_keys import load_import_name_keys
from app.services.importers.shared.stats import ImportStats
from app.services.importers.shared.validation_helpers import strip_import_text_or_raise
from app.services.merchants.defaults import SELF_MERCHANT_NAME, UNKNOWN_MERCHANT_NAME


def get_import_merchant_scope_filter(user_id: uuid.UUID):
    """Return the SQL filter for the merchants an import may file rows under

    The user's own and the ones that ship with the app, which is the same scope the merchants routes
    measure a new name against

    Args:
        user_id: Identifier for the user running the import

    Returns:
        SQLAlchemy filter matching the merchants an import may use
    """
    return Merchant.is_system.is_(True) | ((Merchant.owner_id == user_id) & Merchant.group_id.is_(None))


async def load_usable_import_merchants(
    db: AsyncSession,
    merchant_ids: set[uuid.UUID],
    user_id: uuid.UUID,
) -> dict[uuid.UUID, Merchant]:
    """Read selected merchant references under the existing system-or-personal import scope

    Args:
        db: Active caller-scoped database session
        merchant_ids: Unique references declared by this request
        user_id: Authenticated importer used by the existing eligibility predicate

    Returns:
        Eligible merchants by ID, with absent or inaccessible references omitted
    """
    if not merchant_ids:
        return {}

    # Resolve reference eligibility in one query before the ordered declaration checks
    merchants = (
        (
            await db.execute(
                select(Merchant).where(
                    Merchant.id.in_(merchant_ids),
                    get_import_merchant_scope_filter(user_id),
                )
            )
        )
        .scalars()
        .all()
    )
    return {merchant.id: merchant for merchant in merchants}


async def require_usable_import_merchant(
    db: AsyncSession,
    merchant_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    merchants_by_id: dict[uuid.UUID, Merchant] | None = None,
) -> Merchant:
    """Return a merchant an import may file rows under, refusing any other

    Args:
        db: Active database session
        merchant_id: Merchant an answer points at
        user_id: Identifier for the user running the import
        merchants_by_id: Optional complete caller-eligible reference lookup for this request

    Returns:
        The merchant

    Raises:
        HTTPException: Raised with 422 when the merchant is not one this import may use, which
            covers another user's and a group's, so answering a value cannot reach further than
            matching one does
    """
    if merchants_by_id is None:
        # Resolve the selected merchant within the importer's system-or-personal scope
        result = await db.execute(
            select(Merchant).where(Merchant.id == merchant_id, get_import_merchant_scope_filter(user_id)),
        )
        merchant = result.scalar_one_or_none()
    else:
        merchant = merchants_by_id.get(merchant_id)
    if merchant is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Merchant not found")
    return merchant


@dataclass
class ImportMerchants:
    """What an import files each of its rows under, worked out once for the whole file

    Three separate questions, each with a map of its own, because one map answering more than one of
    them is what let an answer for a name in the file be read back as a merchant that exists under
    that name, and what let a name in the file reading "Unknown" take the shared merchant out of the
    lookup

    Attributes:
        existing_by_name_key: What merchants there are, keyed by their own name. Extended by what
            this import writes and by what it finds another request has written, never by an answer
        system_by_key: The merchants that ship with the app, keyed by their own name, which is what
            a row stating no merchant is stamped from
        resolved_by_merchant_name_key: What each merchant name in the file resolves to, keyed by the name as
            the file states it rather than by any merchant's own name. This is what a row is filed
            through
        skipped_keys: Merchant names the user answered skip, whose rows are filed under the shared
            merchant the app stamps on a row stating no merchant at all
        keys_by_name: The key the database gave each name this import has met, merchants' own names
            and the file's merchant names alike, since every key is worked out by the database
    """

    existing_by_name_key: dict[str, Merchant]
    system_by_key: dict[str, Merchant] = field(default_factory=dict)
    resolved_by_merchant_name_key: dict[str, Merchant] = field(default_factory=dict)
    skipped_keys: set[str] = field(default_factory=set)
    keys_by_name: dict[str, str] = field(default_factory=dict)

    def get_key(self, name: str) -> str:
        """Return the key a trimmed name is matched under

        Args:
            name: A name this import has already loaded the key of

        Returns:
            The key

        Raises:
            KeyError: Raised when the name's key was never loaded
        """
        return self.keys_by_name[name]


async def load_import_merchants(db: AsyncSession, user_id: uuid.UUID) -> ImportMerchants:
    """Return the merchants an import may match, keyed by what matches them

    Args:
        db: Active database session
        user_id: Identifier for the user running the import

    Returns:
        The merchants this import can match a merchant name to
    """
    # Every merchant a row could match is loaded once, so matching a row costs no query. System
    # merchants are included because their names are taken in every scope, and leaving them out is
    # what let an import create a personal Myself beside the seeded one
    result = await db.execute(
        select(Merchant, func.lower(Merchant.name))
        .where(get_import_merchant_scope_filter(user_id))
        # A database written before capitalisation stopped counting can hold two merchants sharing a
        # key, so the order settles which one wins rather than leaving it to the order rows arrive
        # in: the shared one first, then the oldest personal one
        .order_by(Merchant.is_system.desc(), Merchant.created_at, Merchant.id),
    )

    merchants = ImportMerchants(existing_by_name_key={})
    for merchant, key in result.all():
        merchants.keys_by_name[merchant.name] = key
        merchants.existing_by_name_key.setdefault(key, merchant)
        if merchant.is_system:
            merchants.system_by_key.setdefault(key, merchant)
    return merchants


async def create_missing_import_merchants(
    db: AsyncSession,
    user_id: uuid.UUID,
    raw_names: Iterable[str | None],
    mappings: list[TransactionImportMerchantMapping],
    merchants: ImportMerchants,
    stats: ImportStats,
) -> None:
    """Settle what every merchant name in a file resolves to, creating the merchants it needs

    A value the user answered is taken as answered: pointed at a merchant they chose, created under
    a name they wrote, or left with none. Every other value keeps what the importer does unasked,
    matching an existing merchant by name and creating one where nothing matches. Whatever the file
    introduces is written in one insert, so a file carrying a hundred thousand new merchants costs one
    round trip rather than one for each

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        raw_names: Raw merchant names from every row of the import, blanks and repeats included
        mappings: The merchant names the user answered by hand, which may be none of them
        merchants: Merchant lookup for this import, extended with what is chosen and created
        stats: Import summary counters updated when merchants are created

    Returns:
        None

    Raises:
        HTTPException: Raised with 422 when a merchant name is too long, when an answer states no
            single action, when one merchant name is answered twice, and when an answer points at a
            merchant the import cannot use. Raised with 500 when a name the insert skipped cannot
            then be found, which takes another request creating it and then rolling back
    """
    # Read once, since the caller may pass a generator, and measured before any query so a refused
    # request writes nothing
    names = [name for name in (raw_name.strip() if raw_name else "" for raw_name in raw_names) if name]
    for name in set(names):
        _require_import_merchant_name_fits(name)

    # Every key this call needs comes from one query, the answered values and the names they create
    # included, so no key is worked out in Python
    wanted = {*names}
    for mapping in mappings:
        wanted.add(mapping.source.strip())
        if mapping.create is not None:
            wanted.add(mapping.create.name)
    merchants.keys_by_name.update(
        await load_import_name_keys(db, wanted - merchants.keys_by_name.keys()),
    )

    answers = _index_import_merchant_answers(mappings, merchants)
    merchants.skipped_keys.update(key for key, answer in answers.items() if answer.skip)
    await _attach_chosen_import_merchants(db, user_id, answers, merchants)

    # Keyed by the name a merchant will be stored under rather than by the name as the file states
    # it, since two names corrected to one make one merchant between them
    names_by_key: dict[str, str] = {}
    name_key_by_merchant_name_key: dict[str, str] = {}

    for name in names:
        merchant_name_key = merchants.get_key(name)
        if merchant_name_key in name_key_by_merchant_name_key or merchant_name_key in merchants.resolved_by_merchant_name_key:
            continue

        answer = answers.get(merchant_name_key)
        if answer is None:
            # Left alone, so it matches an existing merchant or is created under its own spelling
            stored_name = name
        elif answer.create is None:
            # Answered skip or pointed at a merchant, both already settled above
            continue
        else:
            stored_name = answer.create.name

        # A name already held is reused rather than written again, which is what the merchants route
        # answers 409 for. The unique index catches the user's own, but not one that ships with the
        # app, since a system merchant has no owner and so shares no index entry with a personal one
        name_key = merchants.get_key(stored_name)
        existing = merchants.existing_by_name_key.get(name_key)
        if existing is not None:
            merchants.resolved_by_merchant_name_key[merchant_name_key] = existing
            continue

        # The first spelling wins, so two merchant names whose stored names differ only in capitals
        # make one merchant: "SQ *AMZN 88" created as "Amazon" beside "AMZN MKTP" created as
        # "AMAZON" writes Amazon alone, and both values resolve to it
        names_by_key.setdefault(name_key, stored_name)
        name_key_by_merchant_name_key[merchant_name_key] = name_key

    if not names_by_key:
        return

    inserted = await insert_import_records_if_absent(
        db,
        Merchant,
        [{"owner_id": user_id, "group_id": None, "name": name, "default_category_id": None} for name in names_by_key.values()],
        index_elements=[Merchant.owner_id, literal_column("lower(name)")],
        index_where=text("group_id IS NULL"),
    )

    written_by_key = {merchants.get_key(merchant.name): merchant for merchant in inserted}
    for merchant in inserted:
        stats.merchants_created += 1
        stats.created_merchant_ids.append(merchant.id)

    # A name the insert skipped was taken between this import loading its merchants and writing
    # them, by another import of the same file or by the user in another tab
    taken_keys = names_by_key.keys() - written_by_key.keys()
    if taken_keys:
        written_by_key.update(await _load_import_merchants_created_elsewhere(db, user_id, taken_keys))

    merchants.existing_by_name_key.update(written_by_key)
    for merchant_name_key, name_key in name_key_by_merchant_name_key.items():
        merchants.resolved_by_merchant_name_key[merchant_name_key] = written_by_key[name_key]


def _require_import_merchant_name_fits(name: str) -> None:
    """Refuse a merchant name longer than the column stores

    Args:
        name: Merchant name from a row or from an answer

    Raises:
        HTTPException: Raised with 422 when the name is too long
    """
    if len(name) > MAX_IMPORT_MERCHANT_NAME_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Merchant name is too long: {name[:28]}",
        )


def _index_import_merchant_answers(
    mappings: list[TransactionImportMerchantMapping],
    merchants: ImportMerchants,
) -> dict[str, TransactionImportMerchantMapping]:
    """Return the answered merchant names keyed by what matches them

    Args:
        mappings: The merchant names the user answered by hand
        merchants: Merchant lookup for this import, holding the key of every answered value

    Returns:
        Each answer keyed by its matching key

    Raises:
        HTTPException: Raised with 422 when an answer states no single action, and when two answers
            are given for names that match as one merchant. A staged run cannot carry that pair, since
            it holds one answer per matching key, so this second refusal is what a request built by
            hand rather than by the import page meets
    """
    answers: dict[str, TransactionImportMerchantMapping] = {}

    for mapping in mappings:
        source = strip_import_text_or_raise(mapping.source, "Merchant source")
        stated_actions = (mapping.merchant_id is not None) + (mapping.create is not None) + mapping.skip
        if stated_actions != 1:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"The merchant source {source} must map to exactly one merchant action",
            )

        # Two spellings of one merchant name resolve to one merchant, so answering both leaves nothing to
        # say which answer the rows carrying either spelling should take
        key = merchants.get_key(source)
        if key in answers:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"The merchant source {source} is answered twice",
            )
        answers[key] = mapping

    return answers


async def _attach_chosen_import_merchants(
    db: AsyncSession,
    user_id: uuid.UUID,
    answers: dict[str, TransactionImportMerchantMapping],
    merchants: ImportMerchants,
) -> None:
    """Point the merchant names answered with an existing merchant at it

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        answers: The answered merchant names keyed by what matches them
        merchants: Merchant lookup for this import, extended with what was chosen

    Returns:
        None

    Raises:
        HTTPException: Raised with 422 when an answer points at a merchant this import cannot use,
            which is any but the user's own and the ones that ship with the app
    """
    chosen = [(key, answer.merchant_id) for key, answer in answers.items() if answer.merchant_id is not None]
    if not chosen:
        return

    result = await db.execute(
        select(Merchant).where(
            Merchant.id.in_({merchant_id for _, merchant_id in chosen}),
            get_import_merchant_scope_filter(user_id),
        ),
    )
    merchants_by_id = {merchant.id: merchant for merchant in result.scalars().all()}

    for key, merchant_id in chosen:
        merchant = merchants_by_id.get(merchant_id)
        if merchant is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Merchant not found")

        # Settles what this merchant name resolves to, whatever it would have matched on its own,
        # which is the whole point of answering it: a descriptor reading nothing like the merchant
        # still lands on it
        merchants.resolved_by_merchant_name_key[key] = merchant


async def _load_import_merchants_created_elsewhere(
    db: AsyncSession,
    user_id: uuid.UUID,
    keys: set[str],
) -> dict[str, Merchant]:
    """Load the merchants another request wrote while this import was running

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        keys: Matching keys the insert skipped because the name was already taken

    Returns:
        The merchants found, keyed by what matches them

    Raises:
        HTTPException: Raised with 500 when a name the insert skipped cannot then be found, which
            would leave the rows using it with no merchant to file them under
    """
    # Ordered as the first load orders them, so which row wins does not depend on where it was found
    result = await db.execute(
        select(Merchant, func.lower(Merchant.name))
        .where(
            get_import_merchant_scope_filter(user_id),
            func.lower(Merchant.name).in_(keys),
        )
        .order_by(Merchant.is_system.desc(), Merchant.created_at, Merchant.id),
    )

    found: dict[str, Merchant] = {}
    for merchant, key in result.all():
        found.setdefault(key, merchant)

    missing = keys - found.keys()
    if missing:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Merchant could not be created or found: {sorted(missing)[0]}",
        )
    return found


def get_import_merchant(
    raw_name: str | None,
    merchants: ImportMerchants,
    stats: ImportStats,
) -> Merchant | None:
    """Return the merchant one import row's merchant name resolves to

    Args:
        raw_name: Raw merchant name from the import row
        merchants: Merchant lookup for this import
        stats: Import summary counters updated when a merchant is used

    Returns:
        The merchant for the row, or None where the row states no merchant and where the user answered
        skip for the one it states, both of which leave the caller to stamp a shared merchant on it

    Raises:
        KeyError: Raised when the name was not put through create_missing_import_merchants first
    """
    name = raw_name.strip() if raw_name else ""
    if not name:
        return None

    key = merchants.get_key(name)
    if key in merchants.skipped_keys:
        return None

    merchant = merchants.resolved_by_merchant_name_key[key]
    stats.reused_merchant_ids.add(merchant.id)
    return merchant


@dataclass
class StampedMerchants:
    """The shared merchants an import stamps on a row that states no merchant

    Stamping one counts as neither created nor reused, because the summary reports what the file's
    own values matched and a stamped merchant matched nothing. A file whose merchant column happens to
    read "Unknown" is a different thing: that value matched the shared merchant on its own name, and
    the summary counts it as reused like any other match

    Attributes:
        transfer: Stamped on a transfer-kind row that resolved to no merchant, which is what the app
            puts on the balance adjustments it writes for itself when an account is created by hand
        other: Stamped on every other row that resolved to none, meaning one whose merchant cell
            is blank and one whose merchant the user answered skip
    """

    transfer: Merchant
    other: Merchant

    def get_for_category(self, category: Category) -> Merchant:
        """Return the merchant a row stating no merchant is stamped with

        Args:
            category: Category the row is filed under

        Returns:
            The shared merchant for the row
        """
        return self.transfer if category.kind == CategoryKind.TRANSFER else self.other


def get_stamped_merchants(merchants: ImportMerchants) -> StampedMerchants:
    """Return the shared merchants stamped on rows that state no merchant

    Args:
        merchants: Merchant lookup for this import, read for the merchants that ship with the app
            rather than for what its merchant names resolved to

    Returns:
        The shared merchants for this import

    Raises:
        HTTPException: Raised with 500 when either merchant is not seeded
    """
    return StampedMerchants(
        transfer=_require_system_merchant(merchants, SELF_MERCHANT_NAME),
        other=_require_system_merchant(merchants, UNKNOWN_MERCHANT_NAME),
    )


def _require_system_merchant(merchants: ImportMerchants, name: str) -> Merchant:
    """Return one merchant that ships with the app, refusing the import when it is absent

    Read from the merchants that ship with the app rather than from what the file's merchant names
    resolved to, so a name reading "Unknown" answered by hand cannot decide what a row stating no
    merchant is stamped with. A personal merchant is not accepted in place of a shared one either way,
    so a database that never ran the seeding fails here rather than quietly stamping one user's own
    merchant on their rows

    Args:
        merchants: Merchant lookup for this import, whose loaded merchants carry their keys
        name: Name of the system merchant wanted

    Returns:
        The system merchant

    Raises:
        HTTPException: Raised with 500 when the merchant is absent
    """
    key = merchants.keys_by_name.get(name)
    merchant = merchants.system_by_key.get(key) if key is not None else None
    if merchant is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"{name} merchant is not configured",
        )
    return merchant
