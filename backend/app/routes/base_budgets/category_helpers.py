"""Base budget tracked category helpers"""
import uuid
from datetime import date

import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import BudgetTrackedCategory
from app.services.budgets.tracked_categories import get_valid_tracked_category_ids


async def update_tracked_category_links(
    db: AsyncSession,
    base_budget_id: uuid.UUID,
    category_ids: list[uuid.UUID],
    user_id: uuid.UUID,
    group_id: uuid.UUID | None,
    changed_at: date,
) -> None:
    """Update active tracked category links for a base budget

    Args:
        db: Active database session
        base_budget_id: Base budget identifier receiving link changes
        category_ids: Requested tracked category identifiers
        user_id: Authenticated user identifier
        group_id: Optional group scope for the base budget
        changed_at: Date to store when links are added or removed

    Raises:
        HTTPException: A category is missing or outside the base budget scope
    """
    valid_category_ids = set(await get_valid_tracked_category_ids(db, category_ids, user_id, group_id))

    # Fetch currently active tracked categories so changes can be reconciled without deleting history
    current_result = await db.execute(
        select(BudgetTrackedCategory.category_id).where(
            BudgetTrackedCategory.base_budget_id == base_budget_id,
            BudgetTrackedCategory.removed_at.is_(None),
        ),
    )
    active_category_ids = set(current_result.scalars().all())

    # Preserve historical rows by marking removed links instead of deleting them
    removed_category_ids = active_category_ids - valid_category_ids
    if removed_category_ids:
        await db.execute(
            sa.update(BudgetTrackedCategory)
            .where(
                BudgetTrackedCategory.base_budget_id == base_budget_id,
                BudgetTrackedCategory.category_id.in_(removed_category_ids),
                BudgetTrackedCategory.removed_at.is_(None),
            )
            .values(removed_at=changed_at),
        )

    # Add only genuinely new links so repeated requests stay idempotent
    added_category_ids = valid_category_ids - active_category_ids
    for category_id in added_category_ids:
        db.add(
            BudgetTrackedCategory(
                base_budget_id=base_budget_id,
                category_id=category_id,
                added_at=changed_at,
            ),
        )
