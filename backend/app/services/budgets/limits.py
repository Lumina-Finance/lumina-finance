"""Limits on how many budgets a person keeps, how many categories a budget tracks and how many periods it holds"""

import uuid
from datetime import date
from itertools import islice

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import RecurrenceFreq
from app.models.budget import BaseBudget, Budget
from app.schemas.budget import MAX_BASE_BUDGETS, MAX_BUDGET_CATEGORIES, MAX_BUDGET_PERIODS
from app.services.budgets.periods import iter_period_starts_through

# The refusals for a series that would hold more periods than a budget keeps, at setup on the start
# date and when a one-off budget is switched to recurring
SETUP_PAST_PERIOD_LIMIT_MESSAGE = f"A budget can go back at most {MAX_BUDGET_PERIODS:,} periods. Please choose a later start date"
REPEAT_PAST_PERIOD_LIMIT_MESSAGE = f"This budget can't repeat: a budget can go back at most {MAX_BUDGET_PERIODS:,} periods"


async def ensure_room_for_base_budgets(db: AsyncSession, user_id: uuid.UUID, adding: int) -> None:
    """Raise when adding budgets would take a person past the most they keep

    Archived budgets count and group budgets do not. Someone already past the limit keeps
    everything and adds nothing

    Args:
        db: Active database session
        user_id: Authenticated user identifier
        adding: Number of budgets about to be added

    Raises:
        HTTPException: Raised with 422 when the person would keep more than the limit
    """
    owned_query = select(func.count()).select_from(BaseBudget).where(BaseBudget.owner_id == user_id, BaseBudget.group_id.is_(None))
    owned = (await db.execute(owned_query)).scalar_one()
    if owned + adding > MAX_BASE_BUDGETS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"You can keep up to {MAX_BASE_BUDGETS} budgets",
        )


def ensure_category_count_within_limit(category_count: int) -> None:
    """Raise when a budget would track more than the most categories it may

    Args:
        category_count: Number of distinct categories the budget would track

    Raises:
        HTTPException: Raised with 422 when the count is past the limit
    """
    if category_count > MAX_BUDGET_CATEGORIES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"A budget can track up to {MAX_BUDGET_CATEGORIES} categories",
        )


def is_period_limited(group_id: uuid.UUID | None) -> bool:
    """Whether a budget is held to the most periods one keeps, which only a person's own budgets are

    A group's budget keeps every period, since removing one would change what each member sees
    """
    return group_id is None


def ensure_series_within_period_limit(
    period_start: date,
    today: date,
    freq: RecurrenceFreq,
    instance_length: int,
    *,
    dom: int | None,
    month: int | None,
    detail: str,
) -> None:
    """Raise when a recurring series from period_start to today holds more periods than a budget keeps

    Raises:
        HTTPException: Raised with 422 and the given detail when the series is past the limit
    """
    series = iter_period_starts_through(period_start, today, freq, instance_length, dom=dom, month=month)
    if sum(1 for _ in islice(series, MAX_BUDGET_PERIODS + 1)) > MAX_BUDGET_PERIODS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


async def ensure_one_off_budget_can_repeat(db: AsyncSession, base_budget: BaseBudget, today: date) -> None:
    """Raise when a one-off budget switched to recurring would fill in more periods than a budget keeps

    The Budgets page fills in every period from the latest one to today, so a series that long would
    remove the period the person set up. A group's budget keeps every period, so it can always repeat

    Raises:
        HTTPException: Raised with 422 when the periods from the latest one to today pass the limit
    """
    if not is_period_limited(base_budget.group_id):
        return

    latest_start_query = select(func.max(Budget.period_start)).where(Budget.base_budget_id == base_budget.id)
    latest_start = (await db.execute(latest_start_query)).scalar_one()
    if latest_start is None:
        return

    ensure_series_within_period_limit(
        latest_start,
        today,
        base_budget.recurrence_freq,
        base_budget.instance_length,
        dom=base_budget.recurrence_dom,
        month=base_budget.recurrence_month,
        detail=REPEAT_PAST_PERIOD_LIMIT_MESSAGE,
    )


async def lock_base_budget_periods(db: AsyncSession, base_budget_id: uuid.UUID) -> None:
    """Hold the base budget's row until commit, so periods added at once count and remove in turn

    The row is read again rather than taken from the session, whose copy may predate the lock
    """
    lock_query = select(BaseBudget).where(BaseBudget.id == base_budget_id).with_for_update().execution_options(populate_existing=True)
    await db.execute(lock_query)


async def remove_oldest_periods_for_new_one(db: AsyncSession, base_budget: BaseBudget) -> None:
    """Remove a budget's oldest periods so it keeps at most the limit once a new period is added

    Call it with the base budget locked, just before the new period is added. A budget holding more
    than the limit from before the limit existed is brought down to it at its next period
    """
    if not is_period_limited(base_budget.group_id):
        return

    count_query = select(func.count()).select_from(Budget).where(Budget.base_budget_id == base_budget.id)
    surplus = (await db.execute(count_query)).scalar_one() - MAX_BUDGET_PERIODS + 1
    if surplus <= 0:
        return

    oldest_query = (
        select(Budget.id)
        .where(Budget.base_budget_id == base_budget.id)
        .order_by(Budget.period_start.asc(), Budget.created_at.asc())
        .limit(surplus)
    )
    await db.execute(delete(Budget).where(Budget.id.in_(oldest_query)))
