"""TAC category detail helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedCategory
from app.routes.tax_advantaged_categories.tac_category_helpers import get_owned_tax_advantaged_category_or_404
from app.services.tax_advantaged_categories import attach_tax_advantaged_category_metrics, get_category_owner_timezones


async def get_tax_advantaged_category_with_metrics_for_owner(
    db: AsyncSession,
    tax_advantaged_category_id: uuid.UUID,
    owner_id: uuid.UUID,
) -> TaxAdvantagedCategory:
    """Return an owned tax-advantaged category with current-year metrics

    Args:
        db: Active database session
        tax_advantaged_category_id: Tax-advantaged category identifier to fetch
        owner_id: Authenticated owner identifier

    Returns:
        Owned tax-advantaged category with current-year metrics attached

    Raises:
        HTTPException: Tax-advantaged category does not exist or belongs to another user, or the owner's
            stored timezone cannot be read
    """
    tax_advantaged_category = await get_owned_tax_advantaged_category_or_404(db, tax_advantaged_category_id, owner_id)
    owner_timezones = await get_category_owner_timezones(db, {tax_advantaged_category.category_owner_user_id})
    await attach_tax_advantaged_category_metrics(db, [tax_advantaged_category], owner_timezones)
    return tax_advantaged_category
