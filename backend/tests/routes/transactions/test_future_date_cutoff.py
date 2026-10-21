"""Route tests for where the future-date cutoff falls and how a transaction crosses it"""

from datetime import UTC, date, datetime, timedelta

import pytest

from tests.routes.support.clock_helpers import PROFILE_TODAY, PROFILE_TOMORROW, freeze_profile_clock
from tests.routes.transactions._helpers import _create_category, _create_transaction, _setup_user_with_deps

# Each case is an instant, the profile zone it is read in, and the local date it falls on. The two
# instants either side of a daylight saving change sit one minute apart around local midnight, where
# a zone treated as a fixed offset from UTC puts the cutoff a day out
CUTOFF_CASES = [
    pytest.param("Asia/Tokyo", datetime(2026, 6, 9, 15, 30, tzinfo=UTC), date(2026, 6, 10), id="ahead-of-utc"),
    pytest.param("Pacific/Honolulu", datetime(2026, 6, 10, 9, 30, tzinfo=UTC), date(2026, 6, 9), id="behind-utc"),
    pytest.param("America/Toronto", datetime(2026, 3, 8, 4, 59, tzinfo=UTC), date(2026, 3, 7), id="spring-forward-before-midnight"),
    pytest.param("America/Toronto", datetime(2026, 3, 8, 5, 0, tzinfo=UTC), date(2026, 3, 8), id="spring-forward-at-midnight"),
    pytest.param("America/Toronto", datetime(2026, 11, 2, 4, 59, tzinfo=UTC), date(2026, 11, 1), id="fall-back-before-midnight"),
    pytest.param("America/Toronto", datetime(2026, 11, 2, 5, 0, tzinfo=UTC), date(2026, 11, 2), id="fall-back-at-midnight"),
]


@pytest.mark.parametrize(("zone", "instant", "today"), CUTOFF_CASES)
async def test_account_balance_stops_at_midnight_in_the_profile_zone(client, freeze_now, zone, instant, today):
    """Only the days up to the date the profile's zone shows count, whatever the server clock says"""
    freeze_profile_clock(freeze_now, instant)
    headers, account_id, _ = await _setup_user_with_deps(client)
    assert (await client.patch("/me", json={"tz": zone}, headers=headers)).status_code == 200
    income_id = (await _create_category(client, headers, name="Test Salary", kind="income")).json()["id"]

    for offset, amount in ((-1, 1_000), (0, 10_000), (1, 100_000)):
        day = (today + timedelta(days=offset)).isoformat()
        assert (await _create_transaction(client, headers, account_id, income_id, dt=day, amount=amount)).status_code == 201

    account = await client.get(f"/accounts/{account_id}", headers=headers)

    assert account.status_code == 200
    assert account.json()["current_balance"] == 11_000


async def test_transaction_counts_once_in_every_total_when_its_date_arrives(client, freeze_now):
    """Crossing local midnight adds the transaction to each total exactly once, so the totals still agree"""
    freeze_profile_clock(freeze_now, datetime(2026, 6, 10, 3, 59, tzinfo=UTC))
    headers, account_id, _ = await _setup_user_with_deps(client)
    income_id = (await _create_category(client, headers, name="Test Salary", kind="income")).json()["id"]
    await _create_transaction(client, headers, account_id, income_id, dt=PROFILE_TOMORROW.isoformat(), amount=40_000)

    async def read_totals() -> dict:
        """Read the same transaction's effect through each calculation that excludes the future"""
        account = await client.get(f"/accounts/{account_id}", headers=headers)
        account_cash_flow = await client.get(f"/accounts/{account_id}/cash-flow", params={"months": 1}, headers=headers)
        insights_cash_flow = await client.get(
            "/insights/cash-flow",
            params={"from_date": "2026-06-09", "to_date": "2026-06-10"},
            headers=headers,
        )
        net_worth = await client.get("/dashboard/net-worth", params={"window_days": 1}, headers=headers)
        return {
            "balance": account.json()["current_balance"],
            "account_income": account_cash_flow.json()[0]["income"],
            "insights_income": sum(point[2] for point in insights_cash_flow.json()["points"]),
            "net_worth": net_worth.json()["current_net_worth"],
        }

    before = await read_totals()
    freeze_profile_clock(freeze_now, datetime(2026, 6, 10, 4, 0, tzinfo=UTC))
    after = await read_totals()

    assert before == {"balance": 0, "account_income": 0, "insights_income": 0, "net_worth": 0}
    assert after == {"balance": 40_000, "account_income": 40_000, "insights_income": 40_000, "net_worth": 40_000}


@pytest.mark.parametrize(
    ("kind", "amount", "side"),
    [
        pytest.param("income", 5_000, "income", id="income"),
        pytest.param("transfer", -5_000, "expenses", id="transfer"),
    ],
)
async def test_moving_a_transaction_across_the_cutoff_updates_balance_and_cash_flow(client, freeze_now, kind, amount, side):
    """Moving income or a transfer to a later date takes it out of the totals, and moving it back puts it in"""
    freeze_profile_clock(freeze_now)
    headers, account_id, _ = await _setup_user_with_deps(client)
    category_id = (await _create_category(client, headers, name=f"Test {kind}", kind=kind)).json()["id"]
    overrides = {"counterparty_account_scope": "outside"} if kind == "transfer" else {}
    created = await _create_transaction(client, headers, account_id, category_id, dt=PROFILE_TOMORROW.isoformat(), amount=amount, **overrides)
    assert created.status_code == 201

    async def read_totals() -> tuple[int, int]:
        """Read the account balance and the month's cash flow on the side the transaction falls on"""
        account = await client.get(f"/accounts/{account_id}", headers=headers)
        cash_flow = await client.get(f"/accounts/{account_id}/cash-flow", params={"months": 1}, headers=headers)
        return account.json()["current_balance"], cash_flow.json()[0][side]

    still_future = await read_totals()
    transaction_url = f"/transactions/{created.json()['id']}"
    assert (await client.patch(transaction_url, json={"dt": PROFILE_TODAY.isoformat()}, headers=headers)).status_code == 200
    counted = await read_totals()
    assert (await client.patch(transaction_url, json={"dt": PROFILE_TOMORROW.isoformat()}, headers=headers)).status_code == 200
    moved_out_again = await read_totals()

    assert still_future == (0, 0)
    assert counted == (amount, abs(amount))
    assert moved_out_again == (0, 0)
