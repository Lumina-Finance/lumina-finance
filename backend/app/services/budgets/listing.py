"""Budget listing services"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import BaseBudget, Budget, BudgetPermission
from app.models.group import GroupMember
from app.schemas.budget import BudgetResponse
from app.services.budgets.response_helpers import build_budget_response, load_tracked_categories


async def get_visible_budget_responses(db: AsyncSession, user_id: uuid.UUID) -> list[BudgetResponse]:
    """Return budget instance responses visible to a user

    Args:
        db: Active database session
        user_id: Authenticated user identifier

    Returns:
        Budget instance responses visible through ownership, group admin membership, or explicit permission
    """
    # Fetch every budget instance the user can see through ownership, group admin access, or a permission row
    result = await db.execute(
        select(Budget, BaseBudget)
        .join(BaseBudget, Budget.base_budget_id == BaseBudget.id)
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
    return [
        build_budget_response(
            budget,
            base_budget,
            tracked_categories_by_base_budget.get(base_budget.id, []),
        )
        for budget, base_budget in budget_rows
    ]
