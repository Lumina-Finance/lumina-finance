"""TAC limit deletion helpers"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.routes.tax_advantaged_plans.tac_limit_helpers import get_tac_limit_or_404
from app.routes.tax_advantaged_plans.tac_plan_helpers import get_owned_tax_advantaged_plan_or_404
from app.services.cache_state import mark_cache_changed_for_scope


async def delete_tac_limit_for_owned_plan(
    db: AsyncSession,
    plan_id: uuid.UUID,
    year: int,
    owner_id: uuid.UUID,
) -> None:
    """Delete a yearly TAC limit after checking plan ownership

    Args:
        db: Active database session
        plan_id: Plan identifier that owns the limit row
        year: Year to delete
        owner_id: Authenticated owner identifier

    Raises:
        HTTPException: Plan or limit row is inaccessible or missing
    """
    plan = await get_owned_tax_advantaged_plan_or_404(db, plan_id, owner_id)
    limit_row = await get_tac_limit_or_404(db, plan_id, year)

    # Mark the plan scope stale before deleting the yearly limit
    await mark_cache_changed_for_scope(db, user_id=plan.plan_owner_user_id, group_id=plan.group_id)
    await db.delete(limit_row)
    await db.commit()
