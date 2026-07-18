"""Firefly III budget import service"""

import calendar
from datetime import date, timedelta
from itertools import pairwise

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import RecurrenceFreq
from app.models.budget import BaseBudget, Budget, BudgetTrackedCategory
from app.models.currency import Currency
from app.models.user import User
from app.schemas.firefly_import import (
    FireflyBudgetImport,
    FireflyBudgetImportRequest,
    FireflyBudgetImportResponse,
    FireflyBudgetImportResult,
)
from app.services.budgets.periods import compute_period_end, validate_period_start
from app.services.budgets.tracked_categories import get_valid_tracked_category_ids
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.importers.shared.currencies import get_import_currencies_by_code
from app.utils.money import (
    DecimalAmountParseError,
    DecimalAmountPrecisionError,
    parse_decimal_amount_to_minor_units,
)

# Cadence stored when the latest limit period fits none of Lumina's shapes.
# It only drives the next-instance suggestion, because every imported period
# keeps its exported dates regardless of the cadence
FALLBACK_RECURRENCE_DOM = 1

# Highest configurable day-of-month anchor, which a period starting on the
# last day of a short month could be the capped form of
MAX_RECURRENCE_DOM = 31

MONTHS_PER_YEAR = 12


async def import_firefly_budgets(
    db: AsyncSession,
    user: User,
    data: FireflyBudgetImportRequest,
) -> FireflyBudgetImportResponse:
    """Create budgets from a Firefly III export with their limit history

    Each limit period becomes one budget period carrying its exported dates
    and amount, and the base budget's cadence is read off the latest limit
    period so the budget continues on the shape it was last run at

    Args:
        db: Active database session
        user: Authenticated user running the import
        data: Budgets derived from the export by the frontend

    Returns:
        Summary of the created budgets and their periods

    Raises:
        HTTPException: Raised with 422 when a currency, category, limit
            amount, or limit period is invalid
    """
    currency_codes = {budget.currency.upper() for budget in data.budgets}
    currencies_by_code = await get_import_currencies_by_code(db, currency_codes)

    results = []
    for budget in data.budgets:
        results.append(await _create_imported_budget(db, user, budget, currencies_by_code))

    await mark_cache_changed_for_scope(db, user_id=user.id, group_id=None)

    # One commit keeps the whole batch atomic, so a failing budget never
    # leaves a partial import behind
    await db.commit()

    return FireflyBudgetImportResponse(budgets_created=len(results), results=results)


async def _create_imported_budget(
    db: AsyncSession,
    user: User,
    budget: FireflyBudgetImport,
    currencies_by_code: dict[str, Currency],
) -> FireflyBudgetImportResult:
    """Create one base budget with tracked categories and its exact periods

    Args:
        db: Active database session
        user: Authenticated user running the import
        budget: Budget definition derived from the export
        currencies_by_code: Currency rows keyed by currency code

    Returns:
        Created budget summary

    Raises:
        HTTPException: Raised with 422 when the categories, limit amounts, or
            limit periods are invalid
    """
    category_ids = await get_valid_tracked_category_ids(db, budget.category_ids, user.id, None)
    limit_periods = _parse_limit_periods(budget, currencies_by_code[budget.currency.upper()])

    base_budget = BaseBudget(
        owner_id=user.id,
        group_id=None,
        name=budget.name.strip(),
        currency=budget.currency.upper(),
        is_archived=budget.is_archived,
        **_cadence_from_latest_period(limit_periods),
    )
    db.add(base_budget)
    await db.flush()

    # Categories join at the first period start so the earliest period
    # already sees them when utilization reconstructs the tracked set
    for category_id in category_ids:
        db.add(BudgetTrackedCategory(
            base_budget_id=base_budget.id,
            category_id=category_id,
            added_at=limit_periods[0][0],
        ))

    for period_start, period_end, overall_limit in limit_periods:
        db.add(Budget(
            base_budget_id=base_budget.id,
            period_start=period_start,
            period_end=period_end,
            overall_limit=overall_limit,
        ))

    return FireflyBudgetImportResult(
        name=base_budget.name,
        base_budget_id=base_budget.id,
        instance_count=len(limit_periods),
    )


def _parse_limit_periods(
    budget: FireflyBudgetImport,
    currency: Currency,
) -> list[tuple[date, date, int]]:
    """Parse a budget's limit history into dated minor-unit periods

    Args:
        budget: Budget definition derived from the export
        currency: Currency the amounts are validated against

    Returns:
        Limit periods as start, end, and amount, sorted by start date

    Raises:
        HTTPException: Raised with 422 when an amount is malformed or not
            positive, a period ends before it starts, or two periods overlap
    """
    periods: list[tuple[date, date, int]] = []
    for limit in budget.limits:
        if limit.end < limit.start:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{budget.name}: a limit period ends before it starts",
            )
        try:
            amount = parse_decimal_amount_to_minor_units(
                limit.amount,
                currency_code=currency.id,
                minor_unit_exponent=currency.minor_unit_exponent,
            )
        except (DecimalAmountParseError, DecimalAmountPrecisionError) as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{budget.name}: invalid limit amount \"{limit.amount}\"",
            ) from exc
        if amount <= 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{budget.name}: limit amounts must be positive",
            )
        periods.append((limit.start, limit.end, amount))

    periods.sort()
    for (_, previous_end, _), (next_start, _, _) in pairwise(periods):
        if next_start <= previous_end:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{budget.name}: two limit periods overlap",
            )
    return periods


def _cadence_from_latest_period(limit_periods: list[tuple[date, date, int]]) -> dict:
    """Return the base budget cadence fields read off the latest limit period

    The latest period decides how the budget continues because it is the
    shape the budget was last run at. A period fitting no Lumina cadence
    falls back to a non-recurring monthly shape, which never touches the
    imported periods themselves

    Args:
        limit_periods: Limit periods sorted by start date

    Returns:
        Keyword arguments for the recurrence fields of a base budget
    """
    latest_start, latest_end, _ = limit_periods[-1]
    cadence = _classify_period_cadence(latest_start, latest_end)
    if cadence is None:
        return {
            "recurrence_freq": RecurrenceFreq.MONTHLY,
            "instance_length": 1,
            "recurrence_weekday": None,
            "recurrence_dom": FALLBACK_RECURRENCE_DOM,
            "recurrence_month": None,
            "recurs": False,
        }
    return {**cadence, "recurs": True}


def _classify_period_cadence(start: date, end: date) -> dict | None:
    """Return the cadence fields one limit period fits, or None when none do

    Whole calendar months anchored on the start's day of month map to a
    monthly cadence, spans of twelve months map to a yearly one, and spans of
    whole weeks map to a weekly cadence. Month shapes are tried first so a
    28-day February reads as one month rather than four weeks

    Args:
        start: Inclusive first day of the period
        end: Inclusive last day of the period

    Returns:
        Recurrence fields without the recurs flag, or None
    """
    following_start = end + timedelta(days=1)
    month_span = (following_start.year - start.year) * MONTHS_PER_YEAR
    month_span += following_start.month - start.month

    if month_span > 0:
        yearly = month_span % MONTHS_PER_YEAR == 0
        freq = RecurrenceFreq.YEARLY if yearly else RecurrenceFreq.MONTHLY
        length = month_span // MONTHS_PER_YEAR if yearly else month_span
        month = start.month if yearly else None
        for dom in _candidate_anchor_days(start):
            aligned = validate_period_start(start, freq, dom=dom, month=month) is None
            if aligned and compute_period_end(start, freq, length, dom=dom, month=month) == end:
                return {
                    "recurrence_freq": freq,
                    "instance_length": length,
                    "recurrence_weekday": None,
                    "recurrence_dom": dom,
                    "recurrence_month": month,
                }

    days = (end - start).days + 1
    if days % 7 == 0:
        return {
            "recurrence_freq": RecurrenceFreq.WEEKLY,
            "instance_length": days // 7,
            "recurrence_weekday": start.weekday(),
            "recurrence_dom": None,
            "recurrence_month": None,
        }
    return None


def _candidate_anchor_days(start: date) -> list[int]:
    """Return the day-of-month anchors a period start could be pinned to

    A start on the last day of a short month could be the capped form of any
    larger configured anchor, so every candidate through the highest anchor
    is tried

    Args:
        start: Inclusive first day of the period

    Returns:
        Candidate day-of-month anchors in ascending order
    """
    last_day = calendar.monthrange(start.year, start.month)[1]
    if start.day == last_day:
        return list(range(start.day, MAX_RECURRENCE_DOM + 1))
    return [start.day]
