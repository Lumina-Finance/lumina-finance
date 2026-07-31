"""Shared response-building helpers for budget and base-budget routes"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import BaseBudget, Budget, BudgetTrackedCategory
from app.models.category import Category
from app.schemas.budget import BaseBudgetResponse, BudgetResponse


async def load_tracked_categories(
    db: AsyncSession, base_budget_ids: list[uuid.UUID],
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Return active tracked category IDs keyed by base budget ID

    Args:
        db: Active database session
        base_budget_ids: Base budget identifiers to inspect

    Returns:
        Active tracked category identifiers keyed by base budget identifier, each list ordered by
        category name
    """
    if not base_budget_ids:
        return {}

    # Fetch active tracked category links for the requested base budgets in one batch, ordered by
    # category name so every consumer of the list reads the same order between requests
    rows = (
        await db.execute(
            select(BudgetTrackedCategory.base_budget_id, BudgetTrackedCategory.category_id)
            .join(Category, Category.id == BudgetTrackedCategory.category_id)
            .where(
                BudgetTrackedCategory.base_budget_id.in_(base_budget_ids),
                BudgetTrackedCategory.removed_at.is_(None),
            )
            .order_by(Category.name, BudgetTrackedCategory.category_id),
        )
    ).all()
    result: dict[uuid.UUID, list[uuid.UUID]] = {}
    for base_id, cat_id in rows:
        result.setdefault(base_id, []).append(cat_id)
    return result


def build_base_budget_response(
    base_budget: BaseBudget, category_ids: list[uuid.UUID],
) -> BaseBudgetResponse:
    """Return a base budget response from a model and preloaded category IDs

    Args:
        base_budget: Base budget row to serialize
        category_ids: Active tracked category identifiers

    Returns:
        Base budget response with tracked category IDs
    """
    response = BaseBudgetResponse.model_validate(base_budget)
    response.category_ids = category_ids
    return response


def build_budget_response(
    budget: Budget, base_budget: BaseBudget, category_ids: list[uuid.UUID],
) -> BudgetResponse:
    """Return a budget response from models and preloaded category IDs

    Args:
        budget: Budget instance row to serialize
        base_budget: Parent base budget row to embed
        category_ids: Active tracked category identifiers for the parent base budget

    Returns:
        Budget response with embedded base budget details
    """
    return BudgetResponse(
        id=budget.id,
        base_budget_id=budget.base_budget_id,
        period_start=budget.period_start,
        period_end=budget.period_end,
        overall_limit=budget.overall_limit,
        created_at=budget.created_at,
        base_budget=build_base_budget_response(base_budget, category_ids),
    )


async def get_budget_response(
    db: AsyncSession, budget: Budget, base_budget: BaseBudget,
) -> BudgetResponse:
    """Return a budget instance response

    Args:
        db: Active database session
        budget: Budget instance row
        base_budget: Parent base budget row

    Returns:
        Budget instance response with tracked category IDs from the parent base budget
    """
    # Fetch active tracked categories for this base budget before building the embedded response
    tracked_categories_by_base_budget = await load_tracked_categories(db, [base_budget.id])
    return build_budget_response(budget, base_budget, tracked_categories_by_base_budget.get(base_budget.id, []))
