"""Spending-comparison dashboard widget service"""
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.schemas.dashboard import RangeKind, SpendingComparisonResponse
from app.schemas.fx import FxStatus
from app.services.dashboard_widgets.spending_comparison_range_helpers import get_spending_comparison_slot_ranges
from app.services.fx import FxConverter


async def get_spending_comparison(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    range_: RangeKind,
    now: datetime,
) -> SpendingComparisonResponse:
    """Return current-vs-prior cumulative expense series for a range

    Args:
        db: Active database session
        accounts: Accounts included in the dashboard scope
        base_currency: User base currency used for dashboard totals
        range_: Calendar period used for current and prior comparison slots
        now: Viewer-local timestamp used to derive current-period bounds

    Returns:
        Spending comparison response with slot labels, cumulative totals, and FX status
    """
    labels, current_ranges, previous_ranges = get_spending_comparison_slot_ranges(range_, now.date())

    if not accounts:
        response = SpendingComparisonResponse(
            range=range_,
            slot_labels=labels,
            current=[0] * len(current_ranges),
            previous=[0] * len(previous_ranges),
            fx_status=FxStatus(),
        )
        return response

    accounts_by_id = {account.id: account for account in accounts}
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts)},
        ),
    )
    current_daily_spend = (
        await _query_daily_expense(
            db,
            accounts_by_id,
            base_currency,
            current_ranges[0][0],
            current_ranges[-1][1],
            converter,
        )
        if current_ranges
        else {}
    )
    previous_daily_spend = (
        await _query_daily_expense(
            db,
            accounts_by_id,
            base_currency,
            previous_ranges[0][0],
            previous_ranges[-1][1],
            converter,
        )
        if previous_ranges
        else {}
    )

    current_slot_totals = [
        _sum_days(current_daily_spend, date_range[0], date_range[1])
        for date_range in current_ranges
    ]
    previous_slot_totals = [
        _sum_days(previous_daily_spend, date_range[0], date_range[1])
        for date_range in previous_ranges
    ]

    response = SpendingComparisonResponse(
        range=range_,
        slot_labels=labels,
        current=_cumulative_totals(current_slot_totals),
        previous=_cumulative_totals(previous_slot_totals),
        fx_status=converter.get_status(),
    )
    return response


async def _query_daily_expense(
    db: AsyncSession,
    accounts_by_id: dict[uuid.UUID, Account],
    base_currency: str,
    start: date,
    end: date,
    converter: FxConverter,
) -> dict[date, int]:
    """Return positive daily expense totals for a date range

    The query groups account-currency expense totals by transaction date and
    account so conversion happens before same-date totals are merged

    Args:
        db: Active database session
        accounts_by_id: Account rows keyed by account ID
        base_currency: User base currency used for dashboard totals
        start: Inclusive start date
        end: Inclusive end date
        converter: Request-scoped FX converter

    Returns:
        Positive expense totals keyed by transaction date
    """
    account_ids = list(accounts_by_id)

    # Aggregate daily expense totals across readable accounts for one comparison window
    result = await db.execute(
        select(
            Transaction.dt,
            Transaction.account_id,
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind == CategoryKind.EXPENSE,
            Transaction.dt >= start,
            Transaction.dt <= end,
        )
        .group_by(Transaction.dt, Transaction.account_id),
    )
    rows = list(result)
    for currency in sorted({
        accounts_by_id[row.account_id].currency
        for row in rows
        if accounts_by_id[row.account_id].currency != base_currency
    }):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=start,
            end_date=end,
        )

    daily_expenses: dict[date, int] = {}

    # Transaction.amount uses the account currency, while Transaction.currency is receipt metadata
    for row in rows:
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=accounts_by_id[row.account_id].currency,
            quote=base_currency,
            rate_date=row.dt,
        )
        if converted_total is None:
            continue

        daily_expenses[row.dt] = daily_expenses.get(row.dt, 0) - converted_total
    return daily_expenses


def _sum_days(daily_values: dict[date, int], start: date, end: date) -> int:
    """Sum daily totals across an inclusive date range

    Args:
        daily_values: Daily totals keyed by date
        start: Inclusive start date
        end: Inclusive end date

    Returns:
        Sum of daily values inside the requested range
    """
    total = 0
    current_day = start
    while current_day <= end:
        total += daily_values.get(current_day, 0)
        current_day += timedelta(days=1)
    return total


def _cumulative_totals(values: list[int]) -> list[int]:
    """Return the running cumulative sum of values

    Args:
        values: Ordered values to accumulate

    Returns:
        Running cumulative totals with the same length as ``values``
    """
    running = 0
    cumulative_values: list[int] = []
    for value in values:
        running += value
        cumulative_values.append(running)
    return cumulative_values


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Load minor-unit exponents for currency codes

    Spending comparison conversion uses this metadata to interpret daily
    account totals before converting them to the user's base currency

    Args:
        db: Active database session
        currencies: Currency codes to load

    Returns:
        Mapping from currency code to minor-unit exponent
    """
    currency_codes = sorted(currencies)

    # Load exponent metadata for every currency needed by spending comparison conversions
    currency_result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currency_codes)),
    )
    return {row.id: row.minor_unit_exponent for row in currency_result}
