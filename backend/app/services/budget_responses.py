"""Shared response-building helpers for budget and base-budget routes."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import BaseBudget, Budget, BudgetTrackedCategory
from app.schemas.budget import BaseBudgetResponse, BudgetResponse


async def load_tracked_categories(
    db: AsyncSession, base_budget_ids: list[uuid.UUID],
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Batch-load active tracked category IDs for multiple base budgets in one query."""
    if not base_budget_ids:
        return {}
    rows = (
        await db.execute(
            select(BudgetTrackedCategory.base_budget_id, BudgetTrackedCategory.category_id).where(
                BudgetTrackedCategory.base_budget_id.in_(base_budget_ids),
                BudgetTrackedCategory.removed_at.is_(None),
            ),
        )
    ).all()
    result: dict[uuid.UUID, list[uuid.UUID]] = {}
    for base_id, cat_id in rows:
        result.setdefault(base_id, []).append(cat_id)
    return result


def build_base_budget_response(
    base_budget: BaseBudget, category_ids: list[uuid.UUID],
) -> BaseBudgetResponse:
    """Build a BaseBudgetResponse from a model and pre-loaded category IDs."""
    resp = BaseBudgetResponse.model_validate(base_budget)
    resp.category_ids = category_ids
    return resp


def build_budget_response(
    budget: Budget, base_budget: BaseBudget, category_ids: list[uuid.UUID],
) -> BudgetResponse:
    """Build a BudgetResponse from models and pre-loaded category IDs."""
    return BudgetResponse(
        id=budget.id,
        base_budget_id=budget.base_budget_id,
        period_start=budget.period_start,
        period_end=budget.period_end,
        overall_limit=budget.overall_limit,
        created_at=budget.created_at,
        base_budget=build_base_budget_response(base_budget, category_ids),
    )
