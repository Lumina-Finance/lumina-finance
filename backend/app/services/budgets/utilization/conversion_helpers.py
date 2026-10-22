"""Budget utilization conversion helpers"""

import uuid
from datetime import date
from typing import Any

from app.services.fx import FxConverter


async def prefetch_budget_rates(converter: FxConverter, spend_rows: list[Any]) -> None:
    """Prefetch FX rates needed for budget spend rows

    Args:
        converter: Converter that will cache the fetched rates
        spend_rows: Aggregated spend rows with account and budget currencies
    """
    date_ranges_by_currency_pair: dict[tuple[str, str], tuple[date, date]] = {}
    for row in spend_rows:
        base = row.account_currency
        quote = row.budget_currency
        if base == quote:
            continue

        start_date, end_date = date_ranges_by_currency_pair.get((base, quote), (row.date, row.date))
        date_ranges_by_currency_pair[(base, quote)] = (min(start_date, row.date), max(end_date, row.date))

    for (base, quote), (start_date, end_date) in sorted(date_ranges_by_currency_pair.items()):
        await converter.prefetch_rates(
            base=base,
            quote=quote,
            start_date=start_date,
            end_date=end_date,
        )


def get_spend_rows_by_budget(spend_rows: list[Any]) -> dict[uuid.UUID, list[Any]]:
    """Return spend rows keyed by budget instance ID

    Args:
        spend_rows: Aggregated spend rows to group

    Returns:
        Spend rows keyed by budget instance identifier
    """
    spend_rows_by_budget: dict[uuid.UUID, list[Any]] = {}
    for row in spend_rows:
        spend_rows_by_budget.setdefault(row.id, []).append(row)
    return spend_rows_by_budget
