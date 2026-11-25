"""Base budget response helpers"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import BaseBudget
from app.models.user import User
from app.schemas.budget import BaseBudgetResponse
from app.services.allowance.currency import attach_read_only_reasons
from app.services.budgets.response_helpers import build_base_budget_response, load_tracked_categories


async def get_base_budget_response(db: AsyncSession, user: User, base_budget: BaseBudget) -> BaseBudgetResponse:
    """Return a response model for one base budget

    Args:
        db: Active database session
        user: Authenticated user receiving the response
        base_budget: Base budget row to serialize

    Returns:
        Base budget response with tracked categories
    """
    tracked_categories_by_base_budget = await load_tracked_categories(db, [base_budget.id])
    await attach_read_only_reasons(db, user, [base_budget])
    return build_base_budget_response(base_budget, tracked_categories_by_base_budget.get(base_budget.id, []))
