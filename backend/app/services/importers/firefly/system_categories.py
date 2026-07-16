"""System category lookups for the Firefly III importer"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.services.importers.firefly.constants import (
    SYSTEM_BALANCE_ADJUSTMENT_CATEGORY_NAME,
    SYSTEM_TRANSFER_CATEGORY_NAME,
)


async def get_firefly_system_categories(db: AsyncSession) -> tuple[Category, Category]:
    """Return the transfer and balance adjustment system categories

    Args:
        db: Active database session

    Returns:
        Transfer category and balance adjustment category

    Raises:
        HTTPException: Raised with 500 when the system categories are missing
    """
    result = await db.execute(
        select(Category).where(
            Category.is_system.is_(True),
            Category.name.in_([SYSTEM_TRANSFER_CATEGORY_NAME, SYSTEM_BALANCE_ADJUSTMENT_CATEGORY_NAME]),
        ),
    )
    categories_by_name = {category.name: category for category in result.scalars()}

    transfer = categories_by_name.get(SYSTEM_TRANSFER_CATEGORY_NAME)
    balance_adjustment = categories_by_name.get(SYSTEM_BALANCE_ADJUSTMENT_CATEGORY_NAME)
    if transfer is None or balance_adjustment is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="System transfer categories are not seeded",
        )
    return transfer, balance_adjustment
