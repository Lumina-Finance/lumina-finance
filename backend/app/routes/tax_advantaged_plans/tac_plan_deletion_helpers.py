"""TAC plan deletion helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.routes.tax_advantaged_plans.tac_plan_helpers import get_owned_tax_advantaged_plan_or_404
from app.services.cache_state import mark_cache_changed_for_scope


async def delete_tax_advantaged_plan_for_owner(
    db: AsyncSession,
    plan_id: uuid.UUID,
    owner_id: uuid.UUID,
) -> None:
    """Delete an owned tax-advantaged plan

    Args:
        db: Active database session
        plan_id: Plan identifier to delete
        owner_id: Authenticated owner identifier

    Raises:
        HTTPException: Plan does not exist or belongs to another user
    """
    plan = await get_owned_tax_advantaged_plan_or_404(db, plan_id, owner_id)

    # Mark the plan scope stale before deleting the owned plan
    await mark_cache_changed_for_scope(db, user_id=plan.plan_owner_user_id, group_id=plan.group_id)
    await db.delete(plan)
    await db.commit()
