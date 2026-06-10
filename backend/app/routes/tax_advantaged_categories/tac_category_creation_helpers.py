"""TAC category creation helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedCategory
from app.routes.tax_advantaged_categories.tac_category_helpers import (
    build_tac_category,
    validate_tax_advantaged_category_currency,
    validate_tax_advantaged_category_group_scope,
    validate_tax_advantaged_category_tax_treatment,
)
from app.schemas.tax_advantaged_category import CreateTaxAdvantagedCategoryRequest
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.tax_advantaged_categories import attach_tax_advantaged_category_metrics


async def create_tax_advantaged_category_with_metrics(
    db: AsyncSession,
    owner_id: uuid.UUID,
    data: CreateTaxAdvantagedCategoryRequest,
) -> TaxAdvantagedCategory:
    """Create a tax-advantaged category with current-year metrics attached

    Args:
        db: Active database session
        owner_id: Authenticated owner identifier
        data: Tax-advantaged category creation payload

    Returns:
        Created tax-advantaged category with current-year metrics attached

    Raises:
        HTTPException: Tax treatment, group scope, or currency is invalid
    """
    validate_tax_advantaged_category_tax_treatment(data.tax_treatment)
    await validate_tax_advantaged_category_group_scope(db, data.group_id, owner_id)
    await validate_tax_advantaged_category_currency(db, data.currency)

    tax_advantaged_category = build_tac_category(owner_id, data)
    db.add(tax_advantaged_category)

    # Mark the tax-advantaged category scope stale before committing the new category
    await mark_cache_changed_for_scope(db, user_id=tax_advantaged_category.category_owner_user_id, group_id=tax_advantaged_category.group_id)
    await db.commit()
    await db.refresh(tax_advantaged_category)
    await attach_tax_advantaged_category_metrics(db, [tax_advantaged_category])
    return tax_advantaged_category
