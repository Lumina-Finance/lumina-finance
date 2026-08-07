"""Transaction import merchant lookup and creation"""
import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import func, literal_column, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.merchant import Merchant
from app.schemas.transaction import MAX_IMPORT_MERCHANT_NAME_LENGTH
from app.services.importers.shared.insertion_helpers import insert_import_records_if_absent
from app.services.importers.shared.stats import ImportStats
from app.services.merchants.defaults import SELF_MERCHANT_NAME, UNKNOWN_MERCHANT_NAME


def get_import_merchant_key(name: str) -> str:
    """Return what a merchant name is matched under during an import

    Trimmed and compared without regard to capitalisation, so an import reaches the verdict the
    merchants create and rename routes reach. Those refuse a name a system merchant already holds,
    whatever the scope, and refuse "myself" beside the seeded "Myself"

    Args:
        name: Merchant name from an import row, or from a merchant already stored

    Returns:
        The key the name is matched under
    """
    return name.strip().lower()


async def get_import_merchants_by_key(db: AsyncSession, user_id: uuid.UUID) -> dict[str, Merchant]:
    """Return the merchants an import may match, keyed by what matches them

    Args:
        db: Active database session
        user_id: Identifier for the user running the import

    Returns:
        Merchant rows keyed by matching key
    """
    # Every merchant a row could match is loaded once, so matching a row costs no query. System
    # merchants are included because their names are taken in every scope, and leaving them out is
    # what let an import create a personal Myself beside the seeded one
    result = await db.execute(
        select(Merchant)
        .where(
            Merchant.is_system.is_(True)
            | ((Merchant.owner_id == user_id) & Merchant.group_id.is_(None)),
        )
        # A database written before capitalisation stopped counting can hold two merchants sharing a
        # key, so the order settles which one wins rather than leaving it to the order rows arrive
        # in: the shared one first, then the oldest personal one
        .order_by(Merchant.is_system.desc(), Merchant.created_at, Merchant.id),
    )

    merchants_by_key: dict[str, Merchant] = {}
    for merchant in result.scalars().all():
        merchants_by_key.setdefault(get_import_merchant_key(merchant.name), merchant)
    return merchants_by_key


async def create_missing_import_merchants(
    db: AsyncSession,
    user_id: uuid.UUID,
    raw_names: Iterable[str | None],
    merchants_by_key: dict[str, Merchant],
    stats: ImportStats,
) -> None:
    """Create the personal merchants an import needs and does not already have

    Every merchant the file introduces is written in one insert, so a file carrying a hundred
    thousand new payees costs one round trip rather than one for each

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        raw_names: Raw merchant names from every row of the import, blanks and repeats included
        merchants_by_key: Merchant lookup for this import, extended with what is created
        stats: Import summary counters updated when merchants are created

    Returns:
        None

    Raises:
        HTTPException: Raised with 422 when a merchant name is too long
    """
    pending: dict[str, str] = {}

    for raw_name in raw_names:
        name = raw_name.strip() if raw_name else ""
        if not name:
            continue
        if len(name) > MAX_IMPORT_MERCHANT_NAME_LENGTH:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Merchant name is too long: {name[:28]}",
            )

        key = get_import_merchant_key(name)
        if key in merchants_by_key or key in pending:
            continue

        # The first spelling the file uses is the one stored, so a file carrying both "Amazon" and
        # "AMAZON" produces one merchant rather than two
        pending[key] = name

    if not pending:
        return

    inserted = await insert_import_records_if_absent(
        db,
        Merchant,
        [
            {"owner_id": user_id, "group_id": None, "name": name, "default_category_id": None}
            for name in pending.values()
        ],
        index_elements=[Merchant.owner_id, literal_column("lower(name)")],
        index_where=text("group_id IS NULL"),
    )

    for merchant in inserted:
        merchants_by_key[get_import_merchant_key(merchant.name)] = merchant
        stats.merchants_created += 1
        stats.created_merchant_ids.append(merchant.id)

    # A name the insert skipped was taken between this import loading its merchants and writing
    # them, by another import of the same file or by the user in another tab
    taken_keys = pending.keys() - merchants_by_key.keys()
    if taken_keys:
        await _load_import_merchants_created_elsewhere(db, user_id, taken_keys, merchants_by_key)


async def _load_import_merchants_created_elsewhere(
    db: AsyncSession,
    user_id: uuid.UUID,
    keys: set[str],
    merchants_by_key: dict[str, Merchant],
) -> None:
    """Load the merchants another request wrote while this import was running

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        keys: Matching keys the insert skipped because the name was already taken
        merchants_by_key: Merchant lookup for this import, extended with what is found

    Returns:
        None

    Raises:
        HTTPException: Raised with 500 when a name the insert skipped cannot then be found, which
            would leave the rows using it with no merchant to file them under
    """
    # Ordered as the first load orders them, so which row wins does not depend on where it was found
    result = await db.execute(
        select(Merchant)
        .where(
            Merchant.is_system.is_(True) | ((Merchant.owner_id == user_id) & Merchant.group_id.is_(None)),
            func.lower(Merchant.name).in_(keys),
        )
        .order_by(Merchant.is_system.desc(), Merchant.created_at, Merchant.id),
    )
    for merchant in result.scalars().all():
        merchants_by_key.setdefault(get_import_merchant_key(merchant.name), merchant)

    missing = keys - merchants_by_key.keys()
    if missing:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Merchant could not be created or found: {sorted(missing)[0]}",
        )


def get_import_merchant(
    raw_name: str | None,
    merchants_by_key: dict[str, Merchant],
    stats: ImportStats,
) -> Merchant | None:
    """Return the merchant one import row's payee text resolves to

    Args:
        raw_name: Raw merchant name from the import row
        merchants_by_key: Merchant lookup for this import
        stats: Import summary counters updated when a merchant is used

    Returns:
        The merchant for the row, or None when the row states no payee

    Raises:
        KeyError: Raised when the name was not put through create_missing_import_merchants first
    """
    name = raw_name.strip() if raw_name else ""
    if not name:
        return None

    merchant = merchants_by_key[get_import_merchant_key(name)]
    stats.reused_merchant_ids.add(merchant.id)
    return merchant


@dataclass
class NoPayeeMerchants:
    """The shared merchants an import stamps on a row that states no payee

    Neither is counted as created or reused, because the summary reports what the file's own values
    matched and a stamped merchant matched nothing

    Attributes:
        transfer: Stamped where the importer itself settled that there is no payee, meaning any
            transfer-kind row, which is what the app puts on the balance adjustments it writes for
            itself when an account is created by hand
        other: Stamped where the file had a payee to state and left it blank
    """

    transfer: Merchant
    other: Merchant

    def get_for_category(self, category: Category) -> Merchant:
        """Return the merchant a row stating no payee is stamped with

        Args:
            category: Category the row is filed under

        Returns:
            The shared merchant for the row
        """
        return self.transfer if category.kind == CategoryKind.TRANSFER else self.other


def get_no_payee_merchants(merchants_by_key: dict[str, Merchant]) -> NoPayeeMerchants:
    """Return the shared merchants stamped on rows that state no payee

    Args:
        merchants_by_key: Merchant lookup for this import, which already holds every system merchant

    Returns:
        The shared merchants for this import

    Raises:
        HTTPException: Raised with 500 when either merchant is not seeded
    """
    return NoPayeeMerchants(
        transfer=_require_system_merchant(merchants_by_key, SELF_MERCHANT_NAME),
        other=_require_system_merchant(merchants_by_key, UNKNOWN_MERCHANT_NAME),
    )


def _require_system_merchant(merchants_by_key: dict[str, Merchant], name: str) -> Merchant:
    """Return one merchant that ships with the app, refusing the import when it is absent

    A personal merchant of the same name is not accepted in its place, so a database that never ran
    the seeding fails here rather than quietly stamping one user's own merchant on their rows

    Args:
        merchants_by_key: Merchant lookup for this import
        name: Name of the system merchant wanted

    Returns:
        The system merchant

    Raises:
        HTTPException: Raised with 500 when the merchant is absent or is not the shared one
    """
    merchant = merchants_by_key.get(get_import_merchant_key(name))
    if merchant is None or not merchant.is_system:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"{name} merchant is not configured",
        )
    return merchant
