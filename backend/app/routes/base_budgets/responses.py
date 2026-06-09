"""Base budget response helpers"""
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import BaseBudget, Budget
from app.schemas.budget import BaseBudgetResponse, BudgetResponse
from app.services.budget_responses import build_base_budget_response, build_budget_response, load_tracked_categories


async def get_base_budget_response(db: AsyncSession, base_budget: BaseBudget) -> BaseBudgetResponse:
    """Return a response model for one base budget

    Args:
        db: Active database session
        base_budget: Base budget row to serialize

    Returns:
        Base budget response with tracked categories
    """
    tracked_categories_by_base_budget = await load_tracked_categories(db, [base_budget.id])
    return build_base_budget_response(base_budget, tracked_categories_by_base_budget.get(base_budget.id, []))


async def get_budget_instance_response(db: AsyncSession, budget: Budget, base_budget: BaseBudget) -> BudgetResponse:
    """Return a response model for one budget instance

    Args:
        db: Active database session
        budget: Budget instance row to serialize
        base_budget: Parent base budget row

    Returns:
        Budget instance response with parent base budget details
    """
    tracked_categories_by_base_budget = await load_tracked_categories(db, [base_budget.id])
    return build_budget_response(budget, base_budget, tracked_categories_by_base_budget.get(base_budget.id, []))
