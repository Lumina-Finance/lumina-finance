"""TAC category listing helpers"""

from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedCategory
from app.models.user import User
from app.routes.tax_advantaged_categories.tac_category_helpers import get_tax_advantaged_categories_for_owner
from app.services.allowance.currency import attach_read_only_reasons
from app.services.tax_advantaged_categories import attach_tax_advantaged_category_metrics, get_category_owner_timezones


async def get_tax_advantaged_categories_with_metrics_for_owner(
    db: AsyncSession,
    user: User,
) -> Sequence[TaxAdvantagedCategory]:
    """Return tax-advantaged categories with current-year metrics for an owner

    Args:
        db: Active database session
        user: Authenticated owner

    Returns:
        Tax-advantaged categories with current-year metrics attached

    Raises:
        HTTPException: An owner row cannot be read, or its stored timezone is not a zone the app recognizes
    """
    tax_advantaged_categories = await get_tax_advantaged_categories_for_owner(db, user.id)
    owner_timezones = await get_category_owner_timezones(
        db,
        {tax_advantaged_category.category_owner_user_id for tax_advantaged_category in tax_advantaged_categories},
    )
    await attach_tax_advantaged_category_metrics(db, tax_advantaged_categories, owner_timezones)
    await attach_read_only_reasons(db, user, tax_advantaged_categories)
    return tax_advantaged_categories
