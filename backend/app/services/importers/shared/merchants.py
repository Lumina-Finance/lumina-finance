"""Transaction import merchant lookup and creation"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.merchant import Merchant
from app.services.importers.shared.stats import ImportStats


async def get_personal_import_merchants_by_name(db: AsyncSession, user_id: uuid.UUID) -> dict[str, Merchant]:
    """Return personal merchant rows keyed by merchant name

    Args:
        db: Active database session
        user_id: Identifier for the user running the import

    Returns:
        Personal merchant rows keyed by merchant name
    """
    # Load existing personal merchants once so repeated import rows can reuse them by name
    result = await db.execute(select(Merchant).where(Merchant.owner_id == user_id, Merchant.group_id.is_(None)))
    return {merchant.name: merchant for merchant in result.scalars().all()}


async def get_or_create_import_merchant(
    db: AsyncSession,
    user_id: uuid.UUID,
    raw_name: str | None,
    merchants_by_name: dict[str, Merchant],
    stats: ImportStats,
) -> Merchant | None:
    """Return an existing merchant by name or create a personal merchant

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        raw_name: Raw merchant name from an import row
        merchants_by_name: Request-local merchant lookup keyed by merchant name
        stats: Import summary counters updated when a merchant is reused or created

    Returns:
        Existing or newly created merchant row, or None when the name is blank

    Raises:
        HTTPException: Raised with 422 when the merchant name is too long
    """
    name = raw_name.strip() if raw_name else ""
    if not name:
        return None
    if len(name) > 256:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Merchant name is too long: {name[:28]}")

    return await _get_or_create_import_merchant_by_name(db, user_id, name, merchants_by_name, stats)


async def _get_or_create_import_merchant_by_name(
    db: AsyncSession,
    user_id: uuid.UUID,
    name: str,
    merchants_by_name: dict[str, Merchant],
    stats: ImportStats,
) -> Merchant:
    """Return one existing merchant by name or create a personal import merchant

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        name: Trimmed merchant name from an import row
        merchants_by_name: Request-local merchant lookup keyed by merchant name
        stats: Import summary counters updated when a merchant is reused or created

    Returns:
        Existing or newly created merchant row for the import row
    """
    existing_merchant = merchants_by_name.get(name)
    if existing_merchant is not None:
        stats.reused_merchant_ids.add(existing_merchant.id)
        return existing_merchant

    merchant = Merchant(owner_id=user_id, group_id=None, name=name, default_category_id=None)
    db.add(merchant)
    await db.flush()
    merchants_by_name[name] = merchant
    stats.merchants_created += 1
    stats.created_merchant_ids.append(merchant.id)
    return merchant
