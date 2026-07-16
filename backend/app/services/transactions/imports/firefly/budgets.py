"""Firefly III budget import service"""

from datetime import date, timedelta

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import RecurrenceFreq
from app.models.budget import BaseBudget, Budget, BudgetTrackedCategory
from app.models.currency import Currency
from app.models.user import User
from app.schemas.data_imports import (
    FireflyBudgetImport,
    FireflyBudgetImportRequest,
    FireflyBudgetImportResponse,
    FireflyBudgetImportResult,
)
from app.services.budgets.periods import compute_period_end, validate_period_start
from app.services.budgets.tracked_categories import get_valid_tracked_category_ids
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.transactions.imports.shared.currencies import get_import_currencies_by_code
from app.utils.money import (
    DecimalAmountParseError,
    DecimalAmountPrecisionError,
    parse_decimal_amount_to_minor_units,
)

# Firefly III budgets are monthly in practice and every backdated period is
# anchored to the first of the month
BUDGET_RECURRENCE_DAY_OF_MONTH = 1


async def import_firefly_budgets(
    db: AsyncSession,
    user: User,
    data: FireflyBudgetImportRequest,
    today: date,
) -> FireflyBudgetImportResponse:
    """Create budgets from a Firefly III export with their limit history

    Each budget becomes a monthly base budget whose period instances run from
    the backdated start through today, and every instance carries the limit
    amount that was in force for its month rather than one figure across the
    whole history

    Args:
        db: Active database session
        user: Authenticated user running the import
        data: Budgets derived from the export by the frontend
        today: Current date in the user's timezone

    Returns:
        Summary of the created budgets and their materialized periods

    Raises:
        HTTPException: Raised with 422 when a currency, category, period
            start, or limit amount is invalid
    """
    currency_codes = {budget.currency.upper() for budget in data.budgets}
    currencies_by_code = await get_import_currencies_by_code(db, currency_codes)

    results = []
    for budget in data.budgets:
        results.append(await _create_imported_budget(db, user, budget, currencies_by_code, today))

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
    today: date,
) -> FireflyBudgetImportResult:
    """Create one base budget with tracked categories and period instances

    Args:
        db: Active database session
        user: Authenticated user running the import
        budget: Budget definition derived from the export
        currencies_by_code: Currency rows keyed by currency code
        today: Current date in the user's timezone

    Returns:
        Created budget summary

    Raises:
        HTTPException: Raised with 422 when the period start, categories, or
            limit amounts are invalid
    """
    alignment_error = validate_period_start(
        budget.period_start,
        RecurrenceFreq.MONTHLY,
        dom=BUDGET_RECURRENCE_DAY_OF_MONTH,
    )
    if alignment_error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"{budget.name}: {alignment_error}",
        )

    category_ids = await get_valid_tracked_category_ids(db, budget.category_ids, user.id, None)
    limit_amounts = _parse_limit_amounts(budget, currencies_by_code[budget.currency.upper()])

    base_budget = BaseBudget(
        owner_id=user.id,
        group_id=None,
        name=budget.name.strip(),
        currency=budget.currency.upper(),
        recurrence_freq=RecurrenceFreq.MONTHLY,
        instance_length=1,
        recurrence_dom=BUDGET_RECURRENCE_DAY_OF_MONTH,
        recurs=True,
    )
    db.add(base_budget)
    await db.flush()

    for category_id in category_ids:
        db.add(BudgetTrackedCategory(
            base_budget_id=base_budget.id,
            category_id=category_id,
            added_at=budget.period_start,
        ))

    instance_count = 0
    period_start = budget.period_start
    while period_start <= today:
        period_end = compute_period_end(
            period_start,
            RecurrenceFreq.MONTHLY,
            1,
            dom=BUDGET_RECURRENCE_DAY_OF_MONTH,
        )
        db.add(Budget(
            base_budget_id=base_budget.id,
            period_start=period_start,
            period_end=period_end,
            overall_limit=_limit_for_period(limit_amounts, period_start),
        ))
        instance_count += 1
        period_start = period_end + timedelta(days=1)

    return FireflyBudgetImportResult(
        name=base_budget.name,
        base_budget_id=base_budget.id,
        instance_count=instance_count,
    )


def _parse_limit_amounts(budget: FireflyBudgetImport, currency: Currency) -> list[tuple[date, int]]:
    """Parse a budget's limit history into dated minor-unit amounts

    Args:
        budget: Budget definition derived from the export
        currency: Currency the amounts are validated against

    Returns:
        Limit amounts sorted by start date

    Raises:
        HTTPException: Raised with 422 when an amount is malformed, not
            positive, or two limits share a start date
    """
    starts = [limit.start for limit in budget.limits]
    if len(starts) != len(set(starts)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"{budget.name}: two budget limits share a start date",
        )

    limit_amounts: list[tuple[date, int]] = []
    for limit in budget.limits:
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
        limit_amounts.append((limit.start, amount))

    return sorted(limit_amounts)


def _limit_for_period(limit_amounts: list[tuple[date, int]], period_start: date) -> int:
    """Return the limit amount in force for one period

    Amounts carry forward until the next limit begins, and periods before the
    first limit fall back to the earliest amount so a backdated start earlier
    than the limit history still gets a sensible cap

    Args:
        limit_amounts: Limit amounts sorted by start date
        period_start: First day of the period being materialized

    Returns:
        Limit amount in minor units
    """
    in_force = [amount for start, amount in limit_amounts if start <= period_start]
    return in_force[-1] if in_force else limit_amounts[0][1]
