"""Budget listing services"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import BaseBudget, Budget, BudgetPermission
from app.models.group import GroupMember
from app.models.user import User
from app.schemas.budget import BudgetResponse
from app.services.allowance.currency import attach_read_only_reasons
from app.services.budgets.response_helpers import build_budget_response, load_tracked_categories


async def get_visible_budget_responses(db: AsyncSession, user: User) -> list[BudgetResponse]:
    """Return the latest budget instance of each base budget visible to a user

    Args:
        db: Active database session
        user: Authenticated user requesting budget instances

    Returns:
        One budget instance response per base budget visible through ownership, group admin
        membership, or explicit permission, being the instance with the greatest period start
    """
    user_id = user.id
    # A budget's full history grows without bound, so the list carries only each base's latest instance
    latest_start = select(Budget.base_budget_id, func.max(Budget.period_start).label("period_start")).group_by(Budget.base_budget_id).subquery()

    # Fetch each base budget's latest instance when the user can see it through ownership, group admin access, or a permission row
    result = await db.execute(
        select(Budget, BaseBudget)
        .join(BaseBudget, Budget.base_budget_id == BaseBudget.id)
        .join(
            latest_start,
            (latest_start.c.base_budget_id == Budget.base_budget_id) & (latest_start.c.period_start == Budget.period_start),
        )
        .outerjoin(GroupMember, BaseBudget.group_id == GroupMember.group_id)
        .outerjoin(
            BudgetPermission,
            (BudgetPermission.base_budget_id == BaseBudget.id) & (BudgetPermission.user_id == user_id),
        )
        .where(
            (BaseBudget.owner_id == user_id)
            | ((GroupMember.user_id == user_id) & (GroupMember.is_admin.is_(True)))
            | (BudgetPermission.user_id == user_id),
        )
        .order_by(Budget.period_end.desc(), BaseBudget.name),
    )

    # The group and permission joins can match the same budget more than once, so collapse duplicates before building responses
    budget_rows = result.unique().all()

    # Fetch active tracked categories for all returned base budgets in one batch instead of one query per response
    tracked_categories_by_base_budget = await load_tracked_categories(
        db,
        list({base_budget.id for _, base_budget in budget_rows}),
    )
    await attach_read_only_reasons(db, user, [base_budget for _, base_budget in budget_rows])
    return [
        build_budget_response(
            budget,
            base_budget,
            tracked_categories_by_base_budget.get(base_budget.id, []),
        )
        for budget, base_budget in budget_rows
    ]


async def get_budgets_for_base_budget(db: AsyncSession, base_budget_id: uuid.UUID) -> list[Budget]:
    """Return budget instances for a base budget ordered by period start

    Args:
        db: Active database session
        base_budget_id: Base budget identifier whose instances are loaded

    Returns:
        Budget instances ordered by period start ascending
    """
    # Fetch every budget instance under the base budget so utilization covers each period in chronological order
    result = await db.execute(
        select(Budget).where(Budget.base_budget_id == base_budget_id).order_by(Budget.period_start.asc()),
    )
    budgets = list(result.scalars().all())
    return budgets
