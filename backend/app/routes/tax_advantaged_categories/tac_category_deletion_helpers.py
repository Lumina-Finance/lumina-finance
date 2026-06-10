"""TAC category deletion helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.routes.tax_advantaged_categories.tac_category_helpers import get_owned_tax_advantaged_category_or_404
from app.services.cache_state import mark_cache_changed_for_scope


async def delete_tax_advantaged_category_for_owner(
    db: AsyncSession,
    tax_advantaged_category_id: uuid.UUID,
    owner_id: uuid.UUID,
) -> None:
    """Delete an owned tax-advantaged category

    Args:
        db: Active database session
        tax_advantaged_category_id: Tax-advantaged category identifier to delete
        owner_id: Authenticated owner identifier

    Raises:
        HTTPException: Tax-advantaged category does not exist or belongs to another user
    """
    tax_advantaged_category = await get_owned_tax_advantaged_category_or_404(db, tax_advantaged_category_id, owner_id)

    # Mark the tax-advantaged category scope stale before deleting the owned tax-advantaged category
    await mark_cache_changed_for_scope(db, user_id=tax_advantaged_category.category_owner_user_id, group_id=tax_advantaged_category.group_id)
    await db.delete(tax_advantaged_category)
    await db.commit()
