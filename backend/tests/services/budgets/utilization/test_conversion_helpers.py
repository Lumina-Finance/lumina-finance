import uuid
from dataclasses import dataclass
from datetime import date

from app.services.budgets.utilization.conversion_helpers import (
    get_spend_rows_by_budget,
    prefetch_budget_rates,
)

BUDGET_A_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
BUDGET_B_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")


@dataclass(frozen=True, slots=True)
class _SpendRow:
    """Minimal spend row used by budget utilization conversion helper tests"""

    id: uuid.UUID
    account_currency: str
    budget_currency: str
    date: date


class _FakeConverter:
    """Fake FX converter that records prefetch calls"""

    def __init__(self):
        """Initialize an empty prefetch call log"""
        self.calls: list[tuple[str, str, date, date]] = []

    async def prefetch_rates(self, *, base: str, quote: str, start_date: date, end_date: date) -> None:
        """Record a prefetch call without hitting an FX provider"""
        self.calls.append((base, quote, start_date, end_date))


async def test_prefetch_budget_rates_groups_date_windows_by_currency_pair():
    """Budget rate prefetching requests one date window per account-budget currency pair"""
    converter = _FakeConverter()
    spend_rows = [
        _SpendRow(BUDGET_A_ID, "USD", "CAD", date(2026, 3, 15)),
        _SpendRow(BUDGET_A_ID, "USD", "CAD", date(2026, 3, 5)),
        _SpendRow(BUDGET_B_ID, "EUR", "CAD", date(2026, 3, 10)),
        _SpendRow(BUDGET_B_ID, "CAD", "CAD", date(2026, 3, 20)),
    ]

    await prefetch_budget_rates(converter, spend_rows)

    assert converter.calls == [
        ("EUR", "CAD", date(2026, 3, 10), date(2026, 3, 10)),
        ("USD", "CAD", date(2026, 3, 5), date(2026, 3, 15)),
    ]


def test_get_spend_rows_by_budget_groups_rows_by_budget_instance():
    """Budget spend rows are grouped by budget instance id without reordering rows"""
    first_row = _SpendRow(BUDGET_A_ID, "CAD", "CAD", date(2026, 3, 1))
    second_row = _SpendRow(BUDGET_B_ID, "USD", "CAD", date(2026, 3, 2))
    third_row = _SpendRow(BUDGET_A_ID, "USD", "CAD", date(2026, 3, 3))

    spend_rows_by_budget = get_spend_rows_by_budget([first_row, second_row, third_row])

    assert spend_rows_by_budget == {
        BUDGET_A_ID: [first_row, third_row],
        BUDGET_B_ID: [second_row],
    }
