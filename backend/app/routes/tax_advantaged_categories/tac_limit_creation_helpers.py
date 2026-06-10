"""TAC limit creation helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedCategoryLimit
from app.routes.tax_advantaged_categories.tac_category_helpers import get_owned_tax_advantaged_category_or_404
from app.routes.tax_advantaged_categories.tac_limit_helpers import build_tac_limit, validate_tac_limit_year_available
from app.schemas.tax_advantaged_category import CreateTaxAdvantagedCategoryLimitRequest
from app.services.cache_state import mark_cache_changed_for_scope


async def create_tac_limit_for_owned_tax_advantaged_category(
    db: AsyncSession,
    tax_advantaged_category_id: uuid.UUID,
    owner_id: uuid.UUID,
    data: CreateTaxAdvantagedCategoryLimitRequest,
) -> TaxAdvantagedCategoryLimit:
    """Create a yearly TAC limit after checking category ownership

    Args:
        db: Active database session
        tax_advantaged_category_id: Tax-advantaged category identifier that owns the limit row
        owner_id: Authenticated owner identifier
        data: Yearly limit creation payload

    Returns:
        Created yearly TAC limit

    Raises:
        HTTPException: Tax-advantaged category is inaccessible or the year already has a limit row
    """
    tax_advantaged_category = await get_owned_tax_advantaged_category_or_404(db, tax_advantaged_category_id, owner_id)
    await validate_tac_limit_year_available(db, tax_advantaged_category_id, data.year)

    limit_row = build_tac_limit(tax_advantaged_category_id, data)
    db.add(limit_row)

    # Mark the tax-advantaged category scope stale before committing the new yearly limit
    await mark_cache_changed_for_scope(db, user_id=tax_advantaged_category.category_owner_user_id, group_id=tax_advantaged_category.group_id)
    await db.commit()
    await db.refresh(limit_row)
    return limit_row
