"""TAC limit deletion helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.routes.tax_advantaged_categories.tac_category_helpers import get_owned_tax_advantaged_category_or_404
from app.routes.tax_advantaged_categories.tac_limit_helpers import get_tac_limit_or_404
from app.services.cache_state import mark_cache_changed_for_scope


async def delete_tac_limit_for_owned_tax_advantaged_category(
    db: AsyncSession,
    tax_advantaged_category_id: uuid.UUID,
    year: int,
    owner_id: uuid.UUID,
) -> None:
    """Delete a yearly TAC limit after checking category ownership

    Args:
        db: Active database session
        tax_advantaged_category_id: Tax-advantaged category identifier that owns the limit row
        year: Year to delete
        owner_id: Authenticated owner identifier

    Raises:
        HTTPException: Tax-advantaged category or limit row is inaccessible or missing
    """
    tax_advantaged_category = await get_owned_tax_advantaged_category_or_404(db, tax_advantaged_category_id, owner_id)
    limit_row = await get_tac_limit_or_404(db, tax_advantaged_category_id, year)

    # Mark the tax-advantaged category scope stale before deleting the yearly limit
    await mark_cache_changed_for_scope(db, user_id=tax_advantaged_category.category_owner_user_id, group_id=tax_advantaged_category.group_id)
    await db.delete(limit_row)
    await db.commit()
