"""TAC category update helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import TaxAdvantagedCategory
from app.routes.tax_advantaged_categories.tac_category_helpers import (
    apply_tac_category_updates,
    get_owned_tax_advantaged_category_or_404,
    validate_tac_category_updates,
)
from app.schemas.tax_advantaged_category import UpdateTaxAdvantagedCategoryRequest
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.tax_advantaged_categories import attach_tax_advantaged_category_metrics, get_category_owner_timezones


async def update_tax_advantaged_category_with_metrics(
    db: AsyncSession,
    tax_advantaged_category_id: uuid.UUID,
    owner_id: uuid.UUID,
    data: UpdateTaxAdvantagedCategoryRequest,
) -> TaxAdvantagedCategory:
    """Update an owned tax-advantaged category with current-year metrics

    Args:
        db: Active database session
        tax_advantaged_category_id: Tax-advantaged category identifier to update
        owner_id: Authenticated owner identifier
        data: Partial tax-advantaged category update payload

    Returns:
        Updated tax-advantaged category with current-year metrics attached

    Raises:
        HTTPException: Tax-advantaged category is inaccessible, a supplied field is invalid, or the
            owner's stored timezone cannot be read
    """
    tax_advantaged_category = await get_owned_tax_advantaged_category_or_404(db, tax_advantaged_category_id, owner_id)
    previous_group_id = tax_advantaged_category.group_id
    updates = data.model_dump(exclude_unset=True)
    if updates:
        await validate_tac_category_updates(db, updates, owner_id)

    # Resolved before the category is changed, since the response metrics are read after the commit
    # and a refusal there would leave the category updated and the request failed
    owner_timezones = await get_category_owner_timezones(db, {tax_advantaged_category.category_owner_user_id})

    if not updates:
        await attach_tax_advantaged_category_metrics(db, [tax_advantaged_category], owner_timezones)
        return tax_advantaged_category

    apply_tac_category_updates(tax_advantaged_category, updates)

    # Mark the previous scope stale because updates can affect tax-advantaged category metrics there
    await mark_cache_changed_for_scope(db, user_id=tax_advantaged_category.category_owner_user_id, group_id=previous_group_id)

    # Mark the new scope stale when the tax-advantaged category moves into a different group
    if tax_advantaged_category.group_id != previous_group_id:
        await mark_cache_changed_for_scope(
            db,
            user_id=tax_advantaged_category.category_owner_user_id,
            group_id=tax_advantaged_category.group_id,
        )

    await db.commit()
    await db.refresh(tax_advantaged_category)
    await attach_tax_advantaged_category_metrics(db, [tax_advantaged_category], owner_timezones)
    return tax_advantaged_category
