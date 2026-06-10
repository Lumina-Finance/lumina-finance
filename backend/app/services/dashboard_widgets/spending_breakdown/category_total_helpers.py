"""Spending breakdown category total helpers"""

import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.schemas.fx import FxStatus
from app.services.dashboard_widgets.spending_breakdown.category_total_query_helpers import (
    SpendingBreakdownCategoryDailyTotal,
    query_spending_breakdown_category_daily_totals,
)
from app.services.dashboard_widgets.spending_breakdown.response_helpers import (
    SpendingBreakdownCategoryTotal,
    SpendingBreakdownCategoryTotalsById,
)
from app.services.fx import FxConverter
from app.services.fx.currency_exponent_helpers import get_currency_exponents


@dataclass(frozen=True, slots=True)
class ConvertedSpendingBreakdownCategoryTotals:
    """Converted spending breakdown category totals and FX status

    Attributes:
        category_totals: Converted totals keyed by category ID
        fx_status: Status from currency conversion attempts
    """

    category_totals: SpendingBreakdownCategoryTotalsById
    fx_status: FxStatus


async def get_converted_spending_breakdown_category_totals(
    db: AsyncSession,
    accounts_by_id: dict[uuid.UUID, Account],
    base_currency: str,
    start: date,
    end: date,
) -> ConvertedSpendingBreakdownCategoryTotals:
    """Return converted category totals and FX status for a spending breakdown

    Args:
        db: Active database session
        accounts_by_id: Account rows keyed by account ID
        base_currency: User base currency used for dashboard totals
        start: Inclusive start date
        end: Inclusive end date

    Returns:
        Converted category totals plus FX conversion status
    """
    account_ids = list(accounts_by_id)
    category_daily_totals = await query_spending_breakdown_category_daily_totals(db, account_ids, start, end)
    converter = FxConverter(
        currency_exponents=await get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts_by_id.values())},
        ),
    )
    await _prefetch_conversion_rates(
        converter,
        category_daily_totals,
        accounts_by_id,
        base_currency,
        start,
        end,
    )
    category_totals = await _convert_category_totals(
        category_daily_totals,
        accounts_by_id,
        base_currency,
        converter,
    )
    converted_category_totals = ConvertedSpendingBreakdownCategoryTotals(
        category_totals=category_totals,
        fx_status=converter.get_status(),
    )
    return converted_category_totals


async def _prefetch_conversion_rates(
    converter: FxConverter,
    category_daily_totals: list[SpendingBreakdownCategoryDailyTotal],
    accounts_by_id: dict[uuid.UUID, Account],
    base_currency: str,
    start: date,
    end: date,
) -> None:
    """Prefetch FX rates needed by category daily totals

    Args:
        converter: Request-scoped FX converter
        category_daily_totals: Grouped category daily totals
        accounts_by_id: Account rows keyed by account ID
        base_currency: User base currency used for dashboard totals
        start: Inclusive rate start date
        end: Inclusive rate end date
    """
    row_currencies = {accounts_by_id[row.account_id].currency for row in category_daily_totals}
    for currency in sorted(row_currencies - {base_currency}):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=start,
            end_date=end,
        )


async def _convert_category_totals(
    category_daily_totals: list[SpendingBreakdownCategoryDailyTotal],
    accounts_by_id: dict[uuid.UUID, Account],
    base_currency: str,
    converter: FxConverter,
) -> SpendingBreakdownCategoryTotalsById:
    """Convert grouped row totals into base-currency category totals

    Args:
        category_daily_totals: Grouped category daily totals
        accounts_by_id: Account rows keyed by account ID
        base_currency: User base currency used for dashboard totals
        converter: Request-scoped FX converter

    Returns:
        Category totals keyed by category ID
    """
    category_totals: SpendingBreakdownCategoryTotalsById = {}

    # Convert account-currency rows before merging totals by category
    for row in category_daily_totals:
        converted_amount = await converter.convert_minor_units(
            row.amount,
            base=accounts_by_id[row.account_id].currency,
            quote=base_currency,
            rate_date=row.transaction_date,
        )
        if converted_amount is None:
            continue

        current_category_total = category_totals.get(row.category_id)
        current_amount = current_category_total.amount if current_category_total else 0
        category_total = SpendingBreakdownCategoryTotal(
            name=row.category_name,
            kind=row.category_kind,
            amount=current_amount + converted_amount,
        )
        category_totals[row.category_id] = category_total
    return category_totals
