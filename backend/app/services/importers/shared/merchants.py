"""Transaction import merchant lookup and creation"""
import uuid
from collections.abc import Iterable

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.merchant import Merchant
from app.schemas.transaction import MAX_IMPORT_MERCHANT_NAME_LENGTH
from app.services.importers.shared.stats import ImportStats


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
    pending: dict[str, Merchant] = {}

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
        pending[key] = Merchant(owner_id=user_id, group_id=None, name=name, default_category_id=None)

    if not pending:
        return

    db.add_all(list(pending.values()))
    await db.flush()
    for key, merchant in pending.items():
        merchants_by_key[key] = merchant
        stats.merchants_created += 1
        stats.created_merchant_ids.append(merchant.id)


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
        The merchant for the row, or None when the row gives no payee

    Raises:
        KeyError: Raised when the name was not put through create_missing_import_merchants first
    """
    name = raw_name.strip() if raw_name else ""
    if not name:
        return None

    merchant = merchants_by_key[get_import_merchant_key(name)]
    stats.reused_merchant_ids.add(merchant.id)
    return merchant
