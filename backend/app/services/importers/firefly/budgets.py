"""Firefly III budget import service"""

import uuid
from dataclasses import dataclass
from datetime import date
from itertools import pairwise

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import RecurrenceFreq
from app.models.budget import BaseBudget, Budget, BudgetTrackedCategory
from app.models.currency import Currency
from app.models.user import User
from app.schemas.firefly_import import (
    FireflyBudgetImportResult,
    FireflyBudgetLimit,
    FireflyBudgetRecurrence,
)
from app.services.budgets.periods import compute_period_end, validate_period_start
from app.services.budgets.tracked_categories import get_allowed_tracked_category_ids
from app.services.cache_state import mark_cache_changed_for_scope
from app.utils.money import (
    DecimalAmountParseError,
    DecimalAmountPrecisionError,
    parse_decimal_amount_to_minor_units,
)

# Cadence stored when the latest limit period fits none of Lumina's shapes
# It only drives the next-instance suggestion, because every imported period
# keeps its exported dates regardless of the cadence
FALLBACK_RECURRENCE_DOM = 1

# Bound expanded IN parameters when one request contains many distinct categories
CATEGORY_QUERY_CHUNK_SIZE = 1000

# Bound pending period and tracked-category objects across the whole request
CHILD_WRITE_BUFFER_SIZE = 1000


@dataclass(frozen=True)
class FireflyBudgetImport:
    """One staged budget with its tracked categories resolved to the categories the commit wrote

    Every limit period becomes one budget period with its exported dates and
    amount, so the history arrives as it was lived rather than reshaped onto
    a single cadence. An archived budget arrives with its history frozen and
    stays out of the active list. A null recurrence means the latest period
    fits no cadence and the budget imports not recurring

    The staged draft was validated against the budget bounds when the run took it, so these values
    are not validated again
    """

    name: str
    currency: str
    category_ids: list[uuid.UUID]
    limits: list[FireflyBudgetLimit]
    recurrence: FireflyBudgetRecurrence | None
    is_archived: bool


@dataclass
class _PreparedBudget:
    """Validated input paired with its unsaved parent and child values"""

    base_budget: BaseBudget
    category_ids: list[uuid.UUID]
    limit_periods: list[tuple[date, date, int]]


async def write_firefly_budgets(
    db: AsyncSession,
    user: User,
    budgets: list[FireflyBudgetImport],
) -> list[FireflyBudgetImportResult]:
    """Create budgets from a Firefly III export with their limit history, without committing

    Each limit period becomes one budget period carrying its exported dates
    and amount. The frontend reads the base budget's cadence off the latest
    limit period, and it is stored only when that period is exactly one period
    of it, so the budget continues on the shape it was last run at

    Args:
        db: Active database session
        user: Authenticated user running the import
        budgets: Budgets derived from the export by the frontend

    Returns:
        The created budgets with the periods materialized for each

    Raises:
        HTTPException: Raised with 422 when a currency, category, limit
            amount, limit period, or cadence is invalid, naming the budget
    """
    if not budgets:
        return []

    currency_codes = {budget.currency.upper() for budget in budgets}
    currency_rows = await db.execute(select(Currency).where(Currency.id.in_(currency_codes)))
    currencies_by_code = {currency.id: currency for currency in currency_rows.scalars().all()}

    # Currencies are checked for every budget before any other check, and each error names its
    # budget so the frontend can show it on the one it concerns
    for budget in budgets:
        if budget.currency.upper() not in currencies_by_code:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{budget.name}: currency {budget.currency.upper()} is not supported",
            )

    requested_category_ids = {
        category_id
        for budget in budgets
        for category_id in budget.category_ids
    }
    allowed_category_ids: set[uuid.UUID] = set()
    category_id_list = sorted(requested_category_ids, key=lambda category_id: category_id.int)
    for offset in range(0, len(category_id_list), CATEGORY_QUERY_CHUNK_SIZE):
        allowed_category_ids.update(await get_allowed_tracked_category_ids(
            db,
            category_id_list[offset:offset + CATEGORY_QUERY_CHUNK_SIZE],
            user.id,
            None,
        ))

    prepared_budgets: list[_PreparedBudget] = []
    for budget in budgets:
        prepared_budgets.append(_prepare_imported_budget(
            user,
            budget,
            currencies_by_code,
            allowed_category_ids,
        ))

    db.add_all([prepared.base_budget for prepared in prepared_budgets])
    await db.flush()

    pending_children: list[Budget | BudgetTrackedCategory] = []
    for prepared in prepared_budgets:

        # Categories join at the first period start so the earliest period sees them
        for category_id in prepared.category_ids:
            pending_children.append(BudgetTrackedCategory(
                base_budget_id=prepared.base_budget.id,
                category_id=category_id,
                added_at=prepared.limit_periods[0][0],
            ))
            if len(pending_children) == CHILD_WRITE_BUFFER_SIZE:
                db.add_all(pending_children)
                await db.flush()
                pending_children = []

        for period_start, period_end, overall_limit in prepared.limit_periods:
            pending_children.append(Budget(
                base_budget_id=prepared.base_budget.id,
                period_start=period_start,
                period_end=period_end,
                overall_limit=overall_limit,
            ))
            if len(pending_children) == CHILD_WRITE_BUFFER_SIZE:
                db.add_all(pending_children)
                await db.flush()
                pending_children = []

    if pending_children:
        db.add_all(pending_children)

    await mark_cache_changed_for_scope(db, user_id=user.id, group_id=None)
    await db.flush()

    return [
        FireflyBudgetImportResult(
            name=prepared.base_budget.name,
            base_budget_id=prepared.base_budget.id,
            instance_count=len(prepared.limit_periods),
        )
        for prepared in prepared_budgets
    ]


def _prepare_imported_budget(
    user: User,
    budget: FireflyBudgetImport,
    currencies_by_code: dict[str, Currency],
    allowed_category_ids: set[uuid.UUID],
) -> _PreparedBudget:
    """Validate one imported budget and prepare its parent and child values

    Args:
        user: Authenticated user running the import
        budget: Budget definition derived from the export
        currencies_by_code: Currency rows keyed by currency code
        allowed_category_ids: Requested category identifiers allowed for this personal scope

    Returns:
        Validated budget values ready for batched persistence

    Raises:
        HTTPException: Raised with 422 when the categories, limit amounts,
            limit periods, or cadence are invalid
    """
    category_ids = list(set(budget.category_ids))
    if not set(category_ids).issubset(allowed_category_ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"{budget.name}: a tracked category was not found",
        )
    limit_periods = _parse_limit_periods(budget, currencies_by_code[budget.currency.upper()])

    base_budget = BaseBudget(
        owner_id=user.id,
        group_id=None,
        name=budget.name.strip(),
        currency=budget.currency.upper(),
        is_archived=budget.is_archived,
        **_cadence_fields(budget, limit_periods),
    )
    return _PreparedBudget(
        base_budget=base_budget,
        category_ids=category_ids,
        limit_periods=limit_periods,
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


def _cadence_fields(budget: FireflyBudgetImport, limit_periods: list[tuple[date, date, int]]) -> dict:
    """Return the base budget cadence fields for the cadence the frontend sent

    A sent cadence is stored only when the latest limit period is exactly one period of it, so
    the next period Lumina suggests starts the day after the imported history ends. No cadence
    means the latest period fits none, and the budget stores a non-recurring monthly shape,
    which never touches the imported periods themselves

    Args:
        budget: Budget definition derived from the export
        limit_periods: Limit periods sorted by start date

    Returns:
        Keyword arguments for the recurrence fields of a base budget

    Raises:
        HTTPException: Raised with 422 when the latest limit period is not one period of the cadence
    """
    recurrence = budget.recurrence
    if recurrence is None:
        return {
            "recurrence_freq": RecurrenceFreq.MONTHLY,
            "instance_length": 1,
            "recurrence_weekday": None,
            "recurrence_dom": FALLBACK_RECURRENCE_DOM,
            "recurrence_month": None,
            "recurs": False,
        }

    latest_start, latest_end, _ = limit_periods[-1]
    aligned = validate_period_start(
        latest_start,
        recurrence.freq,
        weekday=recurrence.weekday,
        dom=recurrence.dom,
        month=recurrence.month,
    ) is None

    # A cadence whose period would end past the last representable date cannot fit either
    try:
        period_end = compute_period_end(
            latest_start,
            recurrence.freq,
            recurrence.instance_length,
            dom=recurrence.dom,
            month=recurrence.month,
        )
    except (ValueError, OverflowError):
        period_end = None
    if not aligned or period_end != latest_end:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"{budget.name}: the cadence does not fit the latest limit period",
        )
    return {
        "recurrence_freq": recurrence.freq,
        "instance_length": recurrence.instance_length,
        "recurrence_weekday": recurrence.weekday,
        "recurrence_dom": recurrence.dom,
        "recurrence_month": recurrence.month,
        "recurs": True,
    }
