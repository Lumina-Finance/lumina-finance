"""Base budget listing helpers"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import BaseBudget, BudgetPermission
from app.models.group import GroupMember
from app.models.user import User
from app.schemas.budget import BaseBudgetResponse
from app.services.allowance.currency import attach_read_only_reasons
from app.services.budgets.response_helpers import build_base_budget_response, load_tracked_categories


async def get_visible_base_budget_responses(db: AsyncSession, user: User) -> list[BaseBudgetResponse]:
    """Return base budget responses visible to a user

    Args:
        db: Active database session
        user: Authenticated user requesting base budgets

    Returns:
        Base budget responses visible through ownership, group admin membership, or explicit permission
    """
    user_id = user.id
    query = (
        select(BaseBudget)
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
        .order_by(BaseBudget.name)
    )

    # Execute the base budget access query and collapse duplicates from group and permission joins
    result = await db.execute(query)
    base_budgets = result.scalars().unique().all()

    tracked_categories_by_base_budget = await load_tracked_categories(db, [base_budget.id for base_budget in base_budgets])
    await attach_read_only_reasons(db, user, base_budgets)
    return [build_base_budget_response(base_budget, tracked_categories_by_base_budget.get(base_budget.id, [])) for base_budget in base_budgets]
