"""Base budget instance creation helpers"""
import uuid
from datetime import date, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.models.budget import BaseBudget, Budget
from app.permissions import check_base_budget_access
from app.routes.base_budgets.response_helpers import get_budget_instance_response
from app.schemas.budget import BudgetResponse, CreateBudgetRequest
from app.services.budgets.periods import compute_period_end, validate_period_start
from app.services.cache_state import mark_cache_changed_for_scope


def _get_initial_budget_period_starts(base_budget: BaseBudget, period_start: date, today: date) -> list[date]:
    """Return initial period starts for a base budget

    Args:
        base_budget: Base budget row being created
        period_start: First requested period start date
        today: Current date in the user's timezone

    Returns:
        Period start dates to materialize
    """
    period_starts = [period_start]
    if not base_budget.recurs:
        return period_starts

    next_start = period_start
    while True:
        period_end = compute_period_end(
            next_start,
            base_budget.recurrence_freq,
            base_budget.instance_length,
            dom=base_budget.recurrence_dom,
            month=base_budget.recurrence_month,
        )
        next_start = period_end + timedelta(days=1)
        if next_start > today:
            return period_starts
        period_starts.append(next_start)


def add_initial_budget_instances(
    db: AsyncSession,
    base_budget: BaseBudget,
    period_start: date | None,
    overall_limit: int | None,
    today: date,
) -> None:
    """Add initial budget instances for a newly created base budget

    Args:
        db: Active database session
        base_budget: Base budget row receiving initial instances
        period_start: Optional first requested period start date
        overall_limit: Optional limit applied to each initial instance
        today: Current date in the user's timezone
    """
    _raise_if_base_budget_archived(base_budget)

    if period_start is None or overall_limit is None:
        return

    # Materialize recurring history through the user's local current period
    for initial_period_start in _get_initial_budget_period_starts(base_budget, period_start, today):
        db.add(
            Budget(
                base_budget_id=base_budget.id,
                period_start=initial_period_start,
                period_end=compute_period_end(
                    initial_period_start,
                    base_budget.recurrence_freq,
                    base_budget.instance_length,
                    dom=base_budget.recurrence_dom,
                    month=base_budget.recurrence_month,
                ),
                overall_limit=overall_limit,
            ),
        )


async def create_budget_instance_and_get_response(
    db: AsyncSession,
    user_id: uuid.UUID,
    base_budget_id: uuid.UUID,
    data: CreateBudgetRequest,
) -> BudgetResponse:
    """Create a budget instance and return its API response

    Args:
        db: Active database session
        user_id: Authenticated user identifier
        base_budget_id: Base budget identifier receiving the budget instance
        data: Budget instance creation request body

    Returns:
        Created budget instance response

    Raises:
        HTTPException: User lacks admin access, period start is invalid, or period overlaps
    """
    base_budget = await check_base_budget_access(db, base_budget_id, user_id, PermissionLevel.ADMIN)
    _raise_if_base_budget_archived(base_budget)
    _validate_budget_instance_period_start(base_budget, data)
    period_end = compute_period_end(
        data.period_start,
        base_budget.recurrence_freq,
        base_budget.instance_length,
        dom=base_budget.recurrence_dom,
        month=base_budget.recurrence_month,
    )
    await _raise_for_overlapping_budget_instance(db, base_budget_id, data.period_start, period_end)

    budget = Budget(
        base_budget_id=base_budget_id,
        period_start=data.period_start,
        period_end=period_end,
        overall_limit=data.overall_limit,
    )
    db.add(budget)
    await mark_cache_changed_for_scope(db, user_id=base_budget.owner_id, group_id=base_budget.group_id)
    await db.commit()
    await db.refresh(budget)

    response = await get_budget_instance_response(db, budget, base_budget)
    return response


def _validate_budget_instance_period_start(base_budget: BaseBudget, data: CreateBudgetRequest) -> None:
    """Raise when a budget instance period start does not match the base budget cadence

    Args:
        base_budget: Parent base budget defining the recurrence cadence
        data: Budget instance creation request body

    Raises:
        HTTPException: Period start does not align with the parent cadence
    """
    alignment_error = validate_period_start(
        data.period_start,
        base_budget.recurrence_freq,
        weekday=base_budget.recurrence_weekday,
        dom=base_budget.recurrence_dom,
        month=base_budget.recurrence_month,
    )
    if alignment_error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=alignment_error,
        )


async def _raise_for_overlapping_budget_instance(
    db: AsyncSession,
    base_budget_id: uuid.UUID,
    period_start: date,
    period_end: date,
) -> None:
    """Raise when the requested budget instance overlaps an existing instance

    Args:
        db: Active database session
        base_budget_id: Base budget identifier receiving the budget instance
        period_start: Requested budget instance period start
        period_end: Computed budget instance period end

    Raises:
        HTTPException: Another budget instance overlaps the requested period
    """
    overlapping_budget_query = select(Budget).where(
        Budget.base_budget_id == base_budget_id,
        Budget.period_start <= period_end,
        Budget.period_end >= period_start,
    )

    # Block overlapping instances because two ranges overlap when each starts before the other ends
    overlap_result = await db.execute(overlapping_budget_query)
    if overlap_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A budget instance already exists for this period",
        )


def _raise_if_base_budget_archived(base_budget: BaseBudget) -> None:
    """Raise when a base budget is archived and cannot generate period instances

    Args:
        base_budget: Base budget whose archived state gates instance generation

    Raises:
        HTTPException: Base budget is archived
    """
    if base_budget.is_archived:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot generate budget instances for an archived base budget",
        )
