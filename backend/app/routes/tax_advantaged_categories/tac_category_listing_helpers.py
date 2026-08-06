"""TAC category listing helpers"""

import uuid
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedCategory
from app.routes.tax_advantaged_categories.tac_category_helpers import get_tax_advantaged_categories_for_owner
from app.services.tax_advantaged_categories import attach_tax_advantaged_category_metrics, get_category_owner_timezones


async def get_tax_advantaged_categories_with_metrics_for_owner(
    db: AsyncSession,
    owner_id: uuid.UUID,
) -> Sequence[TaxAdvantagedCategory]:
    """Return tax-advantaged categories with current-year metrics for an owner

    Args:
        db: Active database session
        owner_id: Authenticated owner identifier

    Returns:
        Tax-advantaged categories with current-year metrics attached

    Raises:
        HTTPException: An owner row cannot be read, or its stored timezone is not a zone the app recognizes
    """
    tax_advantaged_categories = await get_tax_advantaged_categories_for_owner(db, owner_id)
    owner_timezones = await get_category_owner_timezones(
        db,
        {tax_advantaged_category.category_owner_user_id for tax_advantaged_category in tax_advantaged_categories},
    )
    await attach_tax_advantaged_category_metrics(db, tax_advantaged_categories, owner_timezones)
    return tax_advantaged_categories
