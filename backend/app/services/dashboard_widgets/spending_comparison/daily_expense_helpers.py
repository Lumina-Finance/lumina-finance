"""Spending comparison daily expense helpers"""

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.schemas.fx import FxStatus
from app.services.dashboard_widgets.spending_comparison.daily_expense_query_helpers import (
    SpendingComparisonDailyExpenseTotal,
    query_spending_comparison_daily_expense_totals,
)
from app.services.dashboard_widgets.spending_comparison.range_helpers import DateSlotRange
from app.services.fx import FxConverter
from app.services.fx.currency_exponent_helpers import get_currency_exponents


@dataclass(frozen=True, slots=True)
class ConvertedSpendingComparisonDailyExpenses:
    """Converted spending comparison daily expenses and FX status

    Attributes:
        current_daily_expenses: Converted daily expenses for the current period
        previous_daily_expenses: Converted daily expenses for the previous period
        fx_status: Status from currency conversion attempts
    """

    current_daily_expenses: dict[date, int]
    previous_daily_expenses: dict[date, int]
    fx_status: FxStatus


async def get_converted_spending_comparison_daily_expenses(
    db: AsyncSession,
    accounts_by_id: dict[uuid.UUID, Account],
    base_currency: str,
    current_ranges: list[DateSlotRange],
    previous_ranges: list[DateSlotRange],
) -> ConvertedSpendingComparisonDailyExpenses:
    """Return converted daily expenses and FX status for spending comparison

    Args:
        db: Active database session
        accounts_by_id: Account rows keyed by account ID
        base_currency: User base currency used for dashboard totals
        current_ranges: Date slots for the current comparison period
        previous_ranges: Date slots for the previous comparison period

    Returns:
        Converted current and previous daily expenses plus FX conversion status
    """
    converter = FxConverter(
        currency_exponents=await get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts_by_id.values())},
        ),
    )
    current_daily_expenses = await _get_daily_expenses_for_slot_ranges(
        db,
        accounts_by_id,
        base_currency,
        current_ranges,
        converter,
    )
    previous_daily_expenses = await _get_daily_expenses_for_slot_ranges(
        db,
        accounts_by_id,
        base_currency,
        previous_ranges,
        converter,
    )
    converted_daily_expenses = ConvertedSpendingComparisonDailyExpenses(
        current_daily_expenses=current_daily_expenses,
        previous_daily_expenses=previous_daily_expenses,
        fx_status=converter.get_status(),
    )
    return converted_daily_expenses


async def _get_daily_expenses_for_slot_ranges(
    db: AsyncSession,
    accounts_by_id: dict[uuid.UUID, Account],
    base_currency: str,
    slot_ranges: list[DateSlotRange],
    converter: FxConverter,
) -> dict[date, int]:
    """Return converted daily expenses spanning a set of slot ranges

    Args:
        db: Active database session
        accounts_by_id: Account rows keyed by account ID
        base_currency: User base currency used for dashboard totals
        slot_ranges: Date slots that define the full query window
        converter: Request-scoped FX converter

    Returns:
        Converted daily expenses keyed by transaction date
    """
    if not slot_ranges:
        daily_expenses: dict[date, int] = {}
        return daily_expenses

    start = slot_ranges[0][0]
    end = slot_ranges[-1][1]
    daily_expenses = await _get_converted_daily_expenses(
        db,
        accounts_by_id,
        base_currency,
        start,
        end,
        converter,
    )
    return daily_expenses


async def _get_converted_daily_expenses(
    db: AsyncSession,
    accounts_by_id: dict[uuid.UUID, Account],
    base_currency: str,
    start: date,
    end: date,
    converter: FxConverter,
) -> dict[date, int]:
    """Return converted positive daily expenses for a date range

    Args:
        db: Active database session
        accounts_by_id: Account rows keyed by account ID
        base_currency: User base currency used for dashboard totals
        start: Inclusive start date
        end: Inclusive end date
        converter: Request-scoped FX converter

    Returns:
        Converted positive expense totals keyed by transaction date
    """
    account_ids = list(accounts_by_id)
    daily_expense_totals = await query_spending_comparison_daily_expense_totals(
        db,
        account_ids,
        start,
        end,
    )
    await _prefetch_conversion_rates(
        converter,
        daily_expense_totals,
        accounts_by_id,
        base_currency,
        start,
        end,
    )

    daily_expenses: dict[date, int] = {}

    # Transaction.amount uses the account currency, while Transaction.currency is receipt metadata
    for daily_expense_total in daily_expense_totals:
        converted_total = await converter.convert_minor_units(
            daily_expense_total.amount,
            base=accounts_by_id[daily_expense_total.account_id].currency,
            quote=base_currency,
            rate_date=daily_expense_total.transaction_date,
        )
        if converted_total is None:
            continue

        daily_expenses[daily_expense_total.transaction_date] = (
            daily_expenses.get(daily_expense_total.transaction_date, 0) - converted_total
        )
    return daily_expenses


async def _prefetch_conversion_rates(
    converter: FxConverter,
    daily_expense_totals: list[SpendingComparisonDailyExpenseTotal],
    accounts_by_id: dict[uuid.UUID, Account],
    base_currency: str,
    start: date,
    end: date,
) -> None:
    """Prefetch FX rates needed by daily expense rows

    Args:
        converter: Request-scoped FX converter
        daily_expense_totals: Grouped daily expense totals
        accounts_by_id: Account rows keyed by account ID
        base_currency: User base currency used for dashboard totals
        start: Inclusive rate start date
        end: Inclusive rate end date
    """
    expense_currencies = {
        accounts_by_id[daily_expense_total.account_id].currency
        for daily_expense_total in daily_expense_totals
        if accounts_by_id[daily_expense_total.account_id].currency != base_currency
    }
    for currency in sorted(expense_currencies):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=start,
            end_date=end,
        )
