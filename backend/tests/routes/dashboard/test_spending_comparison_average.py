from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.dashboard._helpers import (
    _create_category,
    _create_transaction,
    _FixedClock,
)
from tests.routes.support import _create_account, _create_user, _get_auth_header

# Friday 20 March 2026, so the earlier months are December, January and February
_NOW = datetime(2026, 3, 20, 16, 0, tzinfo=UTC)


async def _set_up(client, monkeypatch, now=_NOW):
    """Fix the clock and create a user with a CAD account and an expense category"""
    from app.routes import dashboard as dashboard_routes

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(now))
    headers = _get_auth_header(await _create_user(client))
    account_id = (await _create_account(client, headers)).json()["id"]
    expense_id = (await _create_category(client, headers, name="Test Groceries", kind="expense")).json()["id"]
    return headers, account_id, expense_id


async def _spend(client, headers, account_id, category_id, dt, amount, currency="CAD"):
    """Record an expense of a positive amount in minor units"""
    response = await _create_transaction(
        client,
        headers,
        account_id,
        category_id,
        dt=dt,
        amount=-amount,
        currency=currency,
    )
    assert response.status_code == 201


async def _get(client, headers, range_="MTD", average=True):
    """Fetch the spending comparison payload for a range, with the average's history unless told not to"""
    params = {"range": range_, "average": "true" if average else "false"}
    response = await client.get("/dashboard/spending-comparison", params=params, headers=headers)
    assert response.status_code == 200
    return response.json()


async def _create_income_category(client, headers):
    """Create an income category and return its id"""
    return (await _create_category(client, headers, name="Test Pay", kind="income")).json()["id"]


async def test_average_sums_three_earlier_months_by_day_ten(client, monkeypatch):
    """Months spending 300, 600 and 900 by day 10 average 600 on day 10"""
    headers, account_id, expense_id = await _set_up(client, monkeypatch)
    income_id = await _create_income_category(client, headers)

    # The history begins on 1 December, so December is a whole month
    await _create_transaction(client, headers, account_id, income_id, dt="2025-12-01", amount=1_000)
    await _spend(client, headers, account_id, expense_id, "2025-12-05", 30_000)
    await _spend(client, headers, account_id, expense_id, "2026-01-05", 60_000)
    await _spend(client, headers, account_id, expense_id, "2026-02-05", 90_000)

    data = await _get(client, headers)

    assert data["average_counts"][:28] == [3] * 28
    assert data["average_sums"][9] == 180_000
    assert data["average_sums"][9] // data["average_counts"][9] == 60_000


async def test_average_day_thirty_one_counts_only_months_with_that_day(client, monkeypatch):
    """Day 31 averages December and January, not February, and day 29 skips February too"""
    headers, account_id, expense_id = await _set_up(client, monkeypatch)
    income_id = await _create_income_category(client, headers)
    await _create_transaction(client, headers, account_id, income_id, dt="2025-12-01", amount=1_000)
    await _spend(client, headers, account_id, expense_id, "2025-12-31", 10_000)
    await _spend(client, headers, account_id, expense_id, "2026-01-31", 30_000)
    await _spend(client, headers, account_id, expense_id, "2026-02-10", 50_000)

    data = await _get(client, headers)

    assert len(data["average_sums"]) == 31
    assert data["average_counts"][27] == 3
    assert data["average_counts"][28:] == [2, 2, 2]
    assert data["average_sums"][30] == 10_000 + 30_000
    assert data["average_sums"][27] == 50_000


async def test_average_is_empty_without_a_completed_earlier_period(client, monkeypatch):
    """A user whose history sits inside the current month has no average"""
    headers, account_id, expense_id = await _set_up(client, monkeypatch)
    await _spend(client, headers, account_id, expense_id, "2026-03-02", 10_000)

    data = await _get(client, headers)

    assert data["average_sums"] == []
    assert data["average_counts"] == []


async def test_average_leaves_out_the_partial_first_month(client, monkeypatch):
    """A first transaction after the first day leaves its month out, and on the first day keeps it"""
    headers, account_id, expense_id = await _set_up(client, monkeypatch)
    await _spend(client, headers, account_id, expense_id, "2025-12-15", 99_000)
    await _spend(client, headers, account_id, expense_id, "2026-01-10", 20_000)
    await _spend(client, headers, account_id, expense_id, "2026-02-10", 20_000)

    partial = await _get(client, headers)

    assert partial["average_counts"][:28] == [2] * 28
    assert partial["average_sums"][27] == 40_000

    income_id = await _create_income_category(client, headers)
    await _create_transaction(client, headers, account_id, income_id, dt="2025-12-01", amount=1_000)

    whole = await _get(client, headers)

    assert whole["average_counts"][:28] == [3] * 28
    assert whole["average_sums"][27] == 99_000 + 20_000 + 20_000


async def test_average_leaves_out_a_month_without_spending(client, monkeypatch):
    """A quiet month between two others is in neither the sums nor the counts, as in runway"""
    headers, account_id, expense_id = await _set_up(client, monkeypatch)
    await _spend(client, headers, account_id, expense_id, "2025-12-01", 10_000)
    await _spend(client, headers, account_id, expense_id, "2026-02-01", 30_000)

    data = await _get(client, headers)

    assert data["average_periods"] == 3
    assert data["average_counts"][:28] == [2] * 28
    assert data["average_sums"][0] == 40_000
    assert data["average_sums"][27] == 40_000


async def test_average_has_nothing_to_average_when_every_month_is_empty(client, monkeypatch):
    """Whole earlier months that held no spending leave no average, while the periods still count as history"""
    headers, account_id, expense_id = await _set_up(client, monkeypatch)
    income_id = await _create_income_category(client, headers)
    await _create_transaction(client, headers, account_id, income_id, dt="2025-12-01", amount=1_000)
    await _spend(client, headers, account_id, expense_id, "2026-03-02", 20_000)

    data = await _get(client, headers)

    assert data["average_periods"] == 3
    assert data["average_sums"] == []
    assert data["average_counts"] == []


async def test_average_counts_a_month_that_spends_only_after_todays_day_number(client, monkeypatch):
    """A month whose only spending falls after day 20 counts with zero for the days before it"""
    headers, account_id, expense_id = await _set_up(client, monkeypatch)
    await _spend(client, headers, account_id, expense_id, "2026-01-01", 10_000)
    await _spend(client, headers, account_id, expense_id, "2026-02-25", 40_000)

    data = await _get(client, headers)

    assert data["average_counts"][:28] == [2] * 28
    # On day 20 January has spent 100 and February still nothing, yet both count
    assert data["average_sums"][19] == 10_000
    assert data["average_sums"][27] == 50_000


async def test_average_never_counts_the_current_month(client, monkeypatch):
    """Spending this month stays out of the average"""
    headers, account_id, expense_id = await _set_up(client, monkeypatch)
    await _spend(client, headers, account_id, expense_id, "2026-02-01", 30_000)
    await _spend(client, headers, account_id, expense_id, "2026-03-01", 70_000)

    data = await _get(client, headers)

    assert data["average_counts"][0] == 1
    assert data["average_sums"][0] == 30_000
    assert data["current"][0] == 70_000


async def test_average_ignores_transfers_for_where_history_starts(client, monkeypatch):
    """A transfer in an earlier month does not start the history or add spending"""
    headers, account_id, expense_id = await _set_up(client, monkeypatch)
    transfer_id = (await _create_category(client, headers, name="Test Transfer", kind="transfer")).json()["id"]
    await _create_transaction(client, headers, account_id, transfer_id, dt="2025-11-01", amount=-500_000)
    await _spend(client, headers, account_id, expense_id, "2026-01-01", 20_000)
    await _spend(client, headers, account_id, expense_id, "2026-02-01", 40_000)

    data = await _get(client, headers)

    assert data["average_counts"][0] == 2
    assert data["average_sums"][0] == 60_000


async def test_average_ignores_future_dated_transactions(client, monkeypatch):
    """A transaction dated after today neither starts the history nor counts"""
    headers, account_id, expense_id = await _set_up(client, monkeypatch)
    await _spend(client, headers, account_id, expense_id, "2026-04-01", 20_000)

    data = await _get(client, headers)

    assert data["average_sums"] == []


async def test_average_converts_foreign_expenses_at_each_days_rate(client, monkeypatch):
    """A USD expense in an earlier month is converted with the rate of its own day"""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {date(2026, 1, 5): Decimal("2"), date(2026, 2, 5): Decimal("3")}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)
    headers, _, expense_id = await _set_up(client, monkeypatch)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()
    usd_id = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"]
    income_id = await _create_income_category(client, headers)
    await _create_transaction(client, headers, usd_id, income_id, dt="2025-12-01", amount=1_000, currency="USD")
    await _spend(client, headers, usd_id, expense_id, "2026-01-05", 10_000, "USD")
    await _spend(client, headers, usd_id, expense_id, "2026-02-05", 10_000, "USD")

    data = await _get(client, headers)

    # December holds no spending, so two months are averaged
    assert data["average_counts"][9] == 2
    assert data["average_sums"][9] == 20_000 + 30_000
    assert data["average_fx_status"]["state"] == "complete"


async def test_average_reports_unavailable_fx_for_the_history(client, monkeypatch):
    """When no rate can be fetched the foreign history is left out and the status says so"""
    from app.services.fx import FrankfurterProvider, FxProviderUnavailableError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        raise FxProviderUnavailableError()

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)
    headers, _, expense_id = await _set_up(client, monkeypatch)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()
    usd_id = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"]
    income_id = await _create_income_category(client, headers)
    await _create_transaction(client, headers, usd_id, income_id, dt="2025-12-01", amount=1_000, currency="USD")
    await _spend(client, headers, usd_id, expense_id, "2026-01-05", 10_000, "USD")

    data = await _get(client, headers)

    # The only spending could not be converted, so no period has any and there is no average
    assert data["average_sums"] == []
    assert data["average_fx_status"]["state"] == "unavailable"
    assert data["average_fx_status"]["missing_pairs"]


async def test_a_gap_in_an_old_rate_flags_only_the_average(client, monkeypatch):
    """The card's own spending converts fine, so its status stays complete while the average is incomplete"""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        # The rate for this month exists and the one for January, inside the history, does not
        return {date(2026, 3, 5): Decimal("2"), date(2026, 3, 6): Decimal("2"), date(2026, 3, 7): Decimal("2")}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)
    headers, _, expense_id = await _set_up(client, monkeypatch)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()
    usd_id = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"]
    income_id = await _create_income_category(client, headers)
    await _create_transaction(client, headers, usd_id, income_id, dt="2025-12-01", amount=1_000, currency="USD")
    await _spend(client, headers, usd_id, expense_id, "2026-01-05", 10_000, "USD")
    await _spend(client, headers, usd_id, expense_id, "2026-03-05", 10_000, "USD")

    data = await _get(client, headers)

    assert data["fx_status"]["state"] == "complete"
    assert data["current"][-1] == 20_000
    assert data["average_fx_status"]["state"] == "incomplete"
    assert data["average_fx_status"]["missing_pairs"]


async def test_average_loads_no_history_unless_asked_for(client, monkeypatch):
    """Without the average, no earlier period is loaded or converted, yet the periods it would cover are counted"""
    from app.services.dashboard_widgets.spending_comparison import service

    async def fail_history(*args, **kwargs):
        raise AssertionError("the history was loaded")

    monkeypatch.setattr(service, "get_converted_average_history", fail_history)
    headers, account_id, expense_id = await _set_up(client, monkeypatch)
    income_id = await _create_income_category(client, headers)
    await _create_transaction(client, headers, account_id, income_id, dt="2025-12-01", amount=1_000)
    await _spend(client, headers, account_id, expense_id, "2026-01-05", 60_000)

    data = await _get(client, headers, average=False)

    assert data["average_periods"] == 3
    assert data["average_sums"] == []
    assert data["average_counts"] == []
    assert data["average_fx_status"]["state"] == "none"


@pytest.mark.parametrize(
    ("range_", "window"),
    [("WTD", 12), ("MTD", 12), ("QTD", 4), ("YTD", 3)],
)
async def test_average_covers_only_the_latest_periods_of_the_window(client, monkeypatch, range_, window):
    """Years of history count no more periods than the range's window, with the oldest left out"""
    headers, account_id, expense_id = await _set_up(client, monkeypatch, datetime(2026, 7, 15, 16, 0, tzinfo=UTC))
    income_id = await _create_income_category(client, headers)
    await _create_transaction(client, headers, account_id, income_id, dt="2018-01-01", amount=1_000)
    await _spend(client, headers, account_id, expense_id, "2018-01-02", 99_000)

    data = await _get(client, headers, range_)

    assert data["average_periods"] == window
    # The old spending sits outside every window, so the periods inside it are all empty
    assert data["average_sums"] == []
    assert data["average_counts"] == []


async def test_average_covers_fewer_periods_than_the_window_when_the_history_is_shorter(client, monkeypatch):
    """Three whole months of history average over three, not twelve"""
    headers, account_id, expense_id = await _set_up(client, monkeypatch)
    income_id = await _create_income_category(client, headers)
    await _create_transaction(client, headers, account_id, income_id, dt="2025-12-01", amount=1_000)
    await _spend(client, headers, account_id, expense_id, "2025-12-05", 30_000)
    await _spend(client, headers, account_id, expense_id, "2026-01-05", 30_000)
    await _spend(client, headers, account_id, expense_id, "2026-02-05", 30_000)

    data = await _get(client, headers)

    assert data["average_periods"] == 3
    assert data["average_counts"][0] == 3


@pytest.mark.parametrize("range_", ["WTD", "QTD", "YTD"])
async def test_average_is_offered_for_every_range(client, monkeypatch, range_):
    """Each range returns sums and counts of its own periods, cut to its own slots"""
    headers, account_id, expense_id = await _set_up(client, monkeypatch, datetime(2026, 7, 15, 16, 0, tzinfo=UTC))
    await _spend(client, headers, account_id, expense_id, "2024-01-01", 12_000)
    await _spend(client, headers, account_id, expense_id, "2025-06-02", 12_000)
    await _spend(client, headers, account_id, expense_id, "2026-05-04", 12_000)

    data = await _get(client, headers, range_)

    assert 0 < len(data["average_sums"]) <= len(data["slot_labels"])
    assert len(data["average_counts"]) == len(data["average_sums"])
    assert data["average_counts"][0] > 0
