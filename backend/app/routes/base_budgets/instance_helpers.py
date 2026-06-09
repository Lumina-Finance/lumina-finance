"""Base budget instance creation helpers"""
from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import BaseBudget, Budget
from app.services.budget_periods import compute_period_end


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
