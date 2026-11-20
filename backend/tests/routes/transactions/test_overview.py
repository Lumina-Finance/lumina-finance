import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest

import app.services.transactions.overview as overview_service
from app.models.currency import Currency
from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.transactions._helpers import (
    _create_account,
    _create_category,
    _create_transaction,
    _get_system_category_id,
    _seed_jpy_currency,
    _seed_usd_currency,
    _setup_user_with_deps,
)

# --- GET /transactions/overview ---


async def test_future_transaction_is_visible_but_enters_calculations_only_on_its_date(client):
    """A future row stays editable while balances and totals stop at the viewer's today."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    cache_status = await client.get("/me/cache-status", headers=headers)
    today = date.fromisoformat(cache_status.json()["current_date"])
    tomorrow = today + timedelta(days=1)

    await _create_transaction(client, headers, account_id, category_id, dt=today.isoformat(), amount=-1000)
    future = await _create_transaction(client, headers, account_id, category_id, dt=tomorrow.isoformat(), amount=-3000)
    assert future.status_code == 201

    listing = await client.get("/transactions", headers=headers)
    account = await client.get(f"/accounts/{account_id}", headers=headers)
    snapshots = await client.get(f"/accounts/{account_id}/snapshots", headers=headers)
    overview = await client.get("/transactions/overview", headers=headers)
    net_worth = await client.get(
        "/insights/net-worth",
        params={"from_date": today.isoformat(), "to_date": tomorrow.isoformat()},
        headers=headers,
    )
    assert {row["dt"] for row in listing.json()} == {today.isoformat(), tomorrow.isoformat()}
    assert account.json()["current_balance"] == -1000
    assert snapshots.json()[-1]["dt"] == today.isoformat()
    assert snapshots.json()[-1]["balance"] == -1000
    assert overview.json()["total_outflow"] == -1000
    assert [point[2][0] for point in net_worth.json()["points"]] == [-1000, -1000]

    moved = await client.patch(f"/transactions/{future.json()['id']}", json={"dt": today.isoformat()}, headers=headers)
    assert moved.status_code == 200
    account = await client.get(f"/accounts/{account_id}", headers=headers)
    overview = await client.get("/transactions/overview", headers=headers)
    assert account.json()["current_balance"] == -4000
    assert overview.json()["total_outflow"] == -4000


async def test_transactions_overview_includes_archived_accounts_unscoped(client):
    """Default transaction overview includes archived-account activity."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    archived_account_id = (await _create_account(client, headers, name="Archived")).json()["id"]

    await _create_transaction(client, headers, account_id, category_id, amount=10_000)
    await _create_transaction(client, headers, account_id, category_id, amount=-4_000)
    await _create_transaction(client, headers, archived_account_id, category_id, amount=90_000)
    await _create_transaction(client, headers, archived_account_id, category_id, amount=-30_000)
    archive_resp = await client.patch(f"/accounts/{archived_account_id}", json={"is_archived": True}, headers=headers)
    assert archive_resp.status_code == 200

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["total_inflow"] == 100_000
    assert data["total_outflow"] == -34_000
    assert data["net_flow_fx_status"] == {"state": "none", "missing_pairs": []}


async def test_transactions_overview_net_flow_excludes_balance_adjustments(client):
    """Balance Adjustment is a reconciliation row, not net cash flow."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    balance_adjustment_id = await _get_system_category_id(client, headers, "Balance Adjustment")
    transfer_id = (await _create_category(client, headers, name="Account Move", kind="transfer")).json()["id"]

    await _create_transaction(client, headers, account_id, category_id, amount=10_000)
    await _create_transaction(client, headers, account_id, category_id, amount=-4_000)
    await _create_transaction(
        client,
        headers,
        account_id,
        transfer_id,
        amount=2_500,
        counterparty_account_scope="outside",
    )
    await _create_transaction(
        client,
        headers,
        account_id,
        transfer_id,
        amount=-1_500,
        counterparty_account_scope="outside",
    )
    await _create_transaction(client, headers, account_id, balance_adjustment_id, amount=99_999)
    await _create_transaction(client, headers, account_id, balance_adjustment_id, amount=-88_888)

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["total_inflow"] == 12_500
    assert data["total_outflow"] == -5_500
    assert data["daily_cash_flow"] == [
        {"date": "2026-03-15", "end_date": "2026-03-15", "inflow": 12_500, "outflow": -5_500},
    ]
    assert [row["amount"] for row in data["outliers"]] == [-4_000]


async def test_transactions_overview_net_flow_converts_foreign_accounts(client, monkeypatch):
    """Net flow totals are converted by transaction date into the user's base currency."""
    from app.services.fx import FrankfurterProvider

    calls = []

    async def fake_get_rates(self, base, quote, start_date, end_date):
        calls.append((base, quote, start_date, end_date))
        return {
            date(2026, 3, 14): Decimal("1.4"),
            date(2026, 3, 15): Decimal("1.5"),
        }

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    await _seed_usd_currency()
    headers, cad_account_id, category_id = await _setup_user_with_deps(client)
    usd_account_id = (
        await _create_account(
            client,
            headers,
            name="USD Chequing",
            currency="USD",
        )
    ).json()["id"]

    await _create_transaction(client, headers, cad_account_id, category_id, amount=2_000, dt="2026-03-14")
    await _create_transaction(client, headers, cad_account_id, category_id, amount=-1_000, dt="2026-03-14")
    await _create_transaction(
        client,
        headers,
        usd_account_id,
        category_id,
        amount=10_000,
        currency="USD",
        dt="2026-03-14",
    )
    await _create_transaction(
        client,
        headers,
        usd_account_id,
        category_id,
        amount=-5_000,
        currency="USD",
        dt="2026-03-15",
    )

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["total_inflow"] == 16_000
    assert data["total_outflow"] == -8_500
    assert data["net_flow_fx_status"] == {"state": "complete", "missing_pairs": []}
    assert data["net_flow_fx_status"] == data["daily_cash_flow_fx_status"]
    assert data["total_inflow"] == sum(day["inflow"] for day in data["daily_cash_flow"])
    assert data["total_outflow"] == sum(day["outflow"] for day in data["daily_cash_flow"])
    assert ("USD", "CAD", date(2026, 3, 7), date(2026, 3, 15)) in calls


async def test_transactions_overview_net_flow_reports_incomplete_fx(client, monkeypatch):
    """Net flow skips unconverted currencies and reports missing pairs."""
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        if base == "USD":
            return {date(2026, 3, 14): Decimal("1.5")}
        raise FxRateNotFoundError()

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    async with TestSession() as session:
        session.add_all(
            [
                Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
                Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2),
            ]
        )
        await session.commit()

    headers, _, category_id = await _setup_user_with_deps(client)
    usd_account_id = (
        await _create_account(
            client,
            headers,
            name="USD Chequing",
            currency="USD",
        )
    ).json()["id"]
    abc_account_id = (
        await _create_account(
            client,
            headers,
            name="ABC Chequing",
            currency="ABC",
        )
    ).json()["id"]

    await _create_transaction(
        client,
        headers,
        usd_account_id,
        category_id,
        amount=10_000,
        currency="USD",
        dt="2026-03-14",
    )
    await _create_transaction(
        client,
        headers,
        abc_account_id,
        category_id,
        amount=90_000,
        currency="ABC",
        dt="2026-03-14",
    )

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["total_inflow"] == 15_000
    assert data["total_outflow"] == 0
    assert data["net_flow_fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
    }
    assert data["net_flow_fx_status"] == data["daily_cash_flow_fx_status"]
    assert data["total_inflow"] == sum(day["inflow"] for day in data["daily_cash_flow"])
    assert data["total_outflow"] == sum(day["outflow"] for day in data["daily_cash_flow"])


async def test_transactions_overview_daily_cash_flow_converts_foreign_accounts(client, monkeypatch):
    """Daily cash flow is converted by transaction date into the user's base currency."""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {
            date(2026, 3, 14): Decimal("1.4"),
            date(2026, 3, 15): Decimal("1.5"),
        }

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    await _seed_usd_currency()
    headers, cad_account_id, category_id = await _setup_user_with_deps(client)
    usd_account_id = (
        await _create_account(
            client,
            headers,
            name="USD Chequing",
            currency="USD",
        )
    ).json()["id"]

    await _create_transaction(client, headers, cad_account_id, category_id, amount=2_000, dt="2026-03-14")
    await _create_transaction(client, headers, cad_account_id, category_id, amount=-1_000, dt="2026-03-14")
    await _create_transaction(
        client,
        headers,
        usd_account_id,
        category_id,
        amount=10_000,
        currency="USD",
        dt="2026-03-14",
    )
    await _create_transaction(
        client,
        headers,
        usd_account_id,
        category_id,
        amount=-5_000,
        currency="USD",
        dt="2026-03-15",
    )

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["daily_cash_flow"] == [
        {"date": "2026-03-14", "end_date": "2026-03-14", "inflow": 16_000, "outflow": -1_000},
        {"date": "2026-03-15", "end_date": "2026-03-15", "inflow": 0, "outflow": -7_500},
    ]
    assert data["daily_cash_flow_fx_status"] == {"state": "complete", "missing_pairs": []}


async def test_transactions_overview_daily_cash_flow_reports_incomplete_fx(client, monkeypatch):
    """Daily cash flow skips unconverted rows and reports missing pairs."""
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        if base == "USD":
            return {date(2026, 3, 14): Decimal("1.5")}
        raise FxRateNotFoundError()

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    async with TestSession() as session:
        session.add_all(
            [
                Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
                Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2),
            ]
        )
        await session.commit()

    headers, _, category_id = await _setup_user_with_deps(client)
    usd_account_id = (
        await _create_account(
            client,
            headers,
            name="USD Chequing",
            currency="USD",
        )
    ).json()["id"]
    abc_account_id = (
        await _create_account(
            client,
            headers,
            name="ABC Chequing",
            currency="ABC",
        )
    ).json()["id"]

    await _create_transaction(
        client,
        headers,
        usd_account_id,
        category_id,
        amount=10_000,
        currency="USD",
        dt="2026-03-14",
    )
    await _create_transaction(
        client,
        headers,
        abc_account_id,
        category_id,
        amount=-90_000,
        currency="ABC",
        dt="2026-03-15",
    )

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["daily_cash_flow"] == [
        {"date": "2026-03-14", "end_date": "2026-03-14", "inflow": 15_000, "outflow": 0},
    ]
    assert data["daily_cash_flow_fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
    }


async def test_transactions_overview_cash_flow_uses_daily_buckets_through_31_day_ranges(client):
    """Overview cash flow ranges up to 31 days stay daily."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    await _create_transaction(client, headers, account_id, category_id, amount=100_000, dt="2026-06-01")
    await _create_transaction(client, headers, account_id, category_id, amount=50_000, dt="2026-07-01")

    resp = await client.get(
        "/transactions/overview",
        params={"from_date": "2026-06-01", "to_date": "2026-07-01"},
        headers=headers,
    )

    assert resp.status_code == 200
    points = resp.json()["daily_cash_flow"]
    assert len(points) == 31
    assert points[0] == {"date": "2026-06-01", "end_date": "2026-06-01", "inflow": 100_000, "outflow": 0}
    assert points[-1] == {"date": "2026-07-01", "end_date": "2026-07-01", "inflow": 50_000, "outflow": 0}


async def test_transactions_overview_cash_flow_uses_weekly_buckets_through_183_day_ranges(client):
    """Overview cash flow ranges up to 183 days stay weekly."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    await _create_transaction(client, headers, account_id, category_id, amount=100_000, dt="2026-01-01")
    await _create_transaction(client, headers, account_id, category_id, amount=-20_000, dt="2026-07-02")

    resp = await client.get(
        "/transactions/overview",
        params={"from_date": "2026-01-01", "to_date": "2026-07-02"},
        headers=headers,
    )

    assert resp.status_code == 200
    points = resp.json()["daily_cash_flow"]
    assert len(points) == 27
    assert points[0] == {"date": "2026-01-01", "end_date": "2026-01-04", "inflow": 100_000, "outflow": 0}
    assert points[-1] == {"date": "2026-06-29", "end_date": "2026-07-02", "inflow": 0, "outflow": -20_000}


async def test_transactions_overview_cash_flow_uses_monthly_buckets_for_long_ranges(client):
    """Overview cash flow ranges over 183 days are grouped monthly."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    await _create_transaction(client, headers, account_id, category_id, amount=100_000, dt="2026-01-15")
    await _create_transaction(client, headers, account_id, category_id, amount=-40_000, dt="2026-02-01")
    await _create_transaction(client, headers, account_id, category_id, amount=80_000, dt="2026-05-20")

    resp = await client.get(
        "/transactions/overview",
        params={"from_date": "2026-01-15", "to_date": "2026-08-01"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["daily_cash_flow"] == [
        {"date": "2026-01-15", "end_date": "2026-01-31", "inflow": 100_000, "outflow": 0},
        {"date": "2026-02-01", "end_date": "2026-02-28", "inflow": 0, "outflow": -40_000},
        {"date": "2026-03-01", "end_date": "2026-03-31", "inflow": 0, "outflow": 0},
        {"date": "2026-04-01", "end_date": "2026-04-30", "inflow": 0, "outflow": 0},
        {"date": "2026-05-01", "end_date": "2026-05-31", "inflow": 80_000, "outflow": 0},
        {"date": "2026-06-01", "end_date": "2026-06-30", "inflow": 0, "outflow": 0},
        {"date": "2026-07-01", "end_date": "2026-07-31", "inflow": 0, "outflow": 0},
        {"date": "2026-08-01", "end_date": "2026-08-01", "inflow": 0, "outflow": 0},
    ]


async def test_transactions_overview_explicit_archived_account_is_allowed(client):
    """Explicit account_id keeps archived account detail inspectable."""
    headers, _, category_id = await _setup_user_with_deps(client)
    archived_account_id = (await _create_account(client, headers, name="Archived")).json()["id"]

    await _create_transaction(client, headers, archived_account_id, category_id, amount=90_000)
    await _create_transaction(client, headers, archived_account_id, category_id, amount=-30_000)
    archive_resp = await client.patch(f"/accounts/{archived_account_id}", json={"is_archived": True}, headers=headers)
    assert archive_resp.status_code == 200

    resp = await client.get(f"/transactions/overview?account_id={archived_account_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["total_inflow"] == 90_000
    assert data["total_outflow"] == -30_000


async def test_transactions_overview_top_categories_cover_expense_categories_only(client):
    """Top categories net refunds inside expense categories and leave income categories out."""
    headers, account_id, expense_category_id = await _setup_user_with_deps(client)
    transfer_category_id = (await _create_category(client, headers, name="Main Transfer", kind="transfer")).json()["id"]
    income_category_id = (await _create_category(client, headers, name="Main Income", kind="income")).json()["id"]
    over_refund_category_id = (await _create_category(client, headers, name="Over Refund", kind="expense")).json()["id"]

    await _create_transaction(
        client,
        headers,
        account_id,
        transfer_category_id,
        amount=-20_000,
        counterparty_account_scope="outside",
    )
    await _create_transaction(client, headers, account_id, income_category_id, amount=-15_000)
    await _create_transaction(client, headers, account_id, expense_category_id, amount=-4_000)
    await _create_transaction(client, headers, account_id, expense_category_id, amount=-3_000)
    await _create_transaction(client, headers, account_id, expense_category_id, amount=2_000)
    await _create_transaction(client, headers, account_id, over_refund_category_id, amount=-1_000)
    await _create_transaction(client, headers, account_id, over_refund_category_id, amount=1_500)

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert [(row["category_id"], row["total"]) for row in data["top_categories"]] == [
        (expense_category_id, -5_000),
    ]
    assert data["top_categories_fx_status"] == {"state": "none", "missing_pairs": []}


async def test_transactions_overview_top_categories_drop_a_category_refunded_to_zero(client):
    """A category whose refunds exactly cancel its spending is not spending for the period."""
    headers, account_id, expense_category_id = await _setup_user_with_deps(client)
    cancelled_category_id = (await _create_category(client, headers, name="Cancelled Expense")).json()["id"]

    await _create_transaction(client, headers, account_id, cancelled_category_id, amount=-6_000)
    await _create_transaction(client, headers, account_id, cancelled_category_id, amount=6_000)
    await _create_transaction(client, headers, account_id, expense_category_id, amount=-3_000)

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert [(row["category_id"], row["total"]) for row in data["top_categories"]] == [
        (expense_category_id, -3_000),
    ]


async def test_transactions_overview_refund_nets_against_its_category_and_counts_as_inflow(client):
    """A refund reduces its own category's spend while still arriving as money in."""
    headers, account_id, expense_category_id = await _setup_user_with_deps(client)

    await _create_transaction(client, headers, account_id, expense_category_id, amount=-10_000)
    await _create_transaction(client, headers, account_id, expense_category_id, amount=4_500)

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert [(row["category_id"], row["total"]) for row in data["top_categories"]] == [
        (expense_category_id, -5_500),
    ]
    assert data["total_inflow"] == 4_500
    assert data["total_outflow"] == -10_000


async def test_transactions_overview_refund_after_its_period_leaves_no_top_category(client):
    """A period holding only the refund reports inflow and no spending category."""
    headers, account_id, expense_category_id = await _setup_user_with_deps(client)

    await _create_transaction(client, headers, account_id, expense_category_id, amount=-10_000, dt="2026-03-15")
    await _create_transaction(client, headers, account_id, expense_category_id, amount=4_500, dt="2026-04-20")

    resp = await client.get(
        "/transactions/overview",
        params={"from_date": "2026-04-01", "to_date": "2026-04-30"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["top_categories"] == []
    assert data["outliers"] == []
    assert data["total_inflow"] == 4_500
    assert data["total_outflow"] == 0


async def test_transactions_overview_income_loss_ranks_as_outlier_without_being_a_top_category(client):
    """An income reversal is one of the largest outflows without counting as spending."""
    headers, account_id, expense_category_id = await _setup_user_with_deps(client)
    income_category_id = (await _create_category(client, headers, name="Main Income", kind="income")).json()["id"]

    await _create_transaction(client, headers, account_id, income_category_id, amount=-12_000)
    await _create_transaction(client, headers, account_id, expense_category_id, amount=-3_000)

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert [(row["category_id"], row["total"]) for row in data["top_categories"]] == [
        (expense_category_id, -3_000),
    ]
    assert [row["amount"] for row in data["outliers"]] == [-12_000, -3_000]
    assert data["total_outflow"] == -15_000


async def test_transactions_overview_unconvertible_income_row_leaves_top_categories_clean(client, monkeypatch):
    """A missing rate that only an income row needed no longer marks top categories incomplete."""
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        raise FxRateNotFoundError()

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    async with TestSession() as session:
        session.add(Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2))
        await session.commit()

    headers, cad_account_id, category_id = await _setup_user_with_deps(client)
    income_category_id = (await _create_category(client, headers, name="Main Income", kind="income")).json()["id"]
    abc_account_id = (
        await _create_account(
            client,
            headers,
            name="ABC Chequing",
            currency="ABC",
        )
    ).json()["id"]

    await _create_transaction(client, headers, cad_account_id, category_id, amount=-5_000)
    await _create_transaction(
        client,
        headers,
        abc_account_id,
        income_category_id,
        amount=-12_000,
        currency="ABC",
    )

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert [(row["category_id"], row["total"]) for row in data["top_categories"]] == [
        (category_id, -5_000),
    ]
    assert data["top_categories_fx_status"] == {"state": "none", "missing_pairs": []}
    assert [row["amount"] for row in data["outliers"]] == [-5_000]
    assert data["outliers_fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
    }


async def test_transactions_overview_panels_report_fx_status_for_their_own_conversions(client, monkeypatch):
    """An unconvertible refund marks top categories incomplete and leaves outliers untouched."""
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        raise FxRateNotFoundError()

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    async with TestSession() as session:
        session.add(Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2))
        await session.commit()

    headers, cad_account_id, category_id = await _setup_user_with_deps(client)
    abc_account_id = (
        await _create_account(
            client,
            headers,
            name="ABC Chequing",
            currency="ABC",
        )
    ).json()["id"]

    await _create_transaction(client, headers, cad_account_id, category_id, amount=-5_000)
    await _create_transaction(
        client,
        headers,
        abc_account_id,
        category_id,
        amount=90_000,
        currency="ABC",
    )

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert [(row["category_id"], row["total"]) for row in data["top_categories"]] == [
        (category_id, -5_000),
    ]
    assert data["top_categories_fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
    }
    assert [row["amount"] for row in data["outliers"]] == [-5_000]
    assert data["outliers_fx_status"] == {"state": "none", "missing_pairs": []}


async def test_transactions_overview_top_categories_convert_and_rank_foreign_accounts(client, monkeypatch):
    """Top categories are ranked by converted base-currency net expense totals."""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {date(2026, 3, 15): Decimal("1.5")}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    await _seed_usd_currency()
    headers, cad_account_id, cad_category_id = await _setup_user_with_deps(client)
    usd_account_id = (
        await _create_account(
            client,
            headers,
            name="USD Chequing",
            currency="USD",
        )
    ).json()["id"]
    usd_category_id = (await _create_category(client, headers, name="USD Expenses")).json()["id"]

    await _create_transaction(client, headers, cad_account_id, cad_category_id, amount=-8_500)
    await _create_transaction(
        client,
        headers,
        usd_account_id,
        usd_category_id,
        amount=-6_000,
        currency="USD",
    )

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert [(row["category_id"], row["total"]) for row in data["top_categories"]] == [
        (usd_category_id, -9_000),
        (cad_category_id, -8_500),
    ]
    assert data["top_categories_fx_status"] == {"state": "complete", "missing_pairs": []}


async def test_transactions_overview_top_categories_report_incomplete_fx(client, monkeypatch):
    """Top categories skip unconverted rows and report missing pairs."""
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        if base == "USD":
            return {date(2026, 3, 15): Decimal("1.5")}
        raise FxRateNotFoundError()

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    async with TestSession() as session:
        session.add_all(
            [
                Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
                Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2),
            ]
        )
        await session.commit()

    headers, _, category_id = await _setup_user_with_deps(client)
    usd_account_id = (
        await _create_account(
            client,
            headers,
            name="USD Chequing",
            currency="USD",
        )
    ).json()["id"]
    abc_account_id = (
        await _create_account(
            client,
            headers,
            name="ABC Chequing",
            currency="ABC",
        )
    ).json()["id"]

    await _create_transaction(
        client,
        headers,
        usd_account_id,
        category_id,
        amount=-10_000,
        currency="USD",
    )
    await _create_transaction(
        client,
        headers,
        abc_account_id,
        category_id,
        amount=-90_000,
        currency="ABC",
    )

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert [(row["category_id"], row["total"]) for row in data["top_categories"]] == [
        (category_id, -15_000),
    ]
    assert data["top_categories_fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
    }


async def test_transactions_overview_outliers_rank_by_each_transactions_own_outflow(client):
    """Most expensive transactions rank by outflow alone, so a refunded purchase still ranks."""
    headers, account_id, expense_category_id = await _setup_user_with_deps(client)
    transfer_category_id = (await _create_category(client, headers, name="Main Transfer", kind="transfer")).json()["id"]
    income_category_id = (await _create_category(client, headers, name="Main Income", kind="income")).json()["id"]
    refunded_category_id = (await _create_category(client, headers, name="Refunded Expense", kind="expense")).json()["id"]
    over_refund_category_id = (await _create_category(client, headers, name="Over-refunded Expense", kind="expense")).json()["id"]

    await _create_transaction(
        client,
        headers,
        account_id,
        transfer_category_id,
        amount=-20_000,
        counterparty_account_scope="outside",
    )
    await _create_transaction(client, headers, account_id, income_category_id, amount=-15_000)
    await _create_transaction(client, headers, account_id, refunded_category_id, amount=-10_000)
    await _create_transaction(client, headers, account_id, refunded_category_id, amount=4_000)
    await _create_transaction(client, headers, account_id, over_refund_category_id, amount=-9_000)
    await _create_transaction(client, headers, account_id, over_refund_category_id, amount=9_500)
    await _create_transaction(client, headers, account_id, expense_category_id, amount=-4_000)
    await _create_transaction(client, headers, account_id, expense_category_id, amount=-3_000)

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert [row["amount"] for row in data["outliers"]] == [-15_000, -10_000, -9_000]
    assert data["outliers_fx_status"] == {"state": "none", "missing_pairs": []}


async def test_transactions_overview_outliers_break_amount_ties_by_recency(client):
    """Equal outflows resolve to the most recent, so the panel holds still across reloads."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    # Seeded oldest first, which is the order an unfixed query hands back
    tied_dates = [date(2026, 3, 12), date(2026, 3, 13), date(2026, 3, 14), date(2026, 3, 15)]
    for tied_date in tied_dates:
        await _create_transaction(
            client,
            headers,
            account_id,
            category_id,
            dt=tied_date.isoformat(),
            amount=-10_000,
        )

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert [row["dt"] for row in data["outliers"]] == ["2026-03-15", "2026-03-14", "2026-03-13"]


async def test_transactions_overview_outliers_break_same_day_ties_by_id(client):
    """Outflows tied on amount and date resolve by identifier, so repeated requests agree."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    for _ in range(3):
        await _create_transaction(
            client,
            headers,
            account_id,
            category_id,
            dt="2026-03-15",
            amount=-10_000,
        )

    first = await client.get("/transactions/overview", headers=headers)
    second = await client.get("/transactions/overview", headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    shown_ids = [row["id"] for row in first.json()["outliers"]]

    # Pins the rule rather than catching the old code, which identifiers being random leaves
    # free to agree with this by chance
    assert shown_ids == sorted(shown_ids)
    assert [row["id"] for row in second.json()["outliers"]] == shown_ids


async def test_transactions_overview_outliers_break_converted_ties_by_recency(client, monkeypatch):
    """Two currencies landing on one converted outflow still resolve to the most recent."""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {date(2026, 3, 14): Decimal("1.5"), date(2026, 3, 15): Decimal("1.5")}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    await _seed_usd_currency()
    headers, cad_account_id, category_id = await _setup_user_with_deps(client)
    usd_account_id = (
        await _create_account(
            client,
            headers,
            name="USD Chequing",
            currency="USD",
        )
    ).json()["id"]

    # -6,000 USD converts to -9,000 CAD, the same outflow as the CAD row, on a later date
    cad_txn = await _create_transaction(
        client,
        headers,
        cad_account_id,
        category_id,
        dt="2026-03-14",
        amount=-9_000,
    )
    usd_txn = await _create_transaction(
        client,
        headers,
        usd_account_id,
        category_id,
        dt="2026-03-15",
        amount=-6_000,
        currency="USD",
    )

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()

    # Ordering on stored amounts would put the CAD row first, since -9,000 sorts below -6,000
    assert [row["id"] for row in data["outliers"]] == [usd_txn.json()["id"], cad_txn.json()["id"]]
    assert data["outliers_fx_status"] == {"state": "complete", "missing_pairs": []}


async def test_transactions_overview_outliers_convert_and_rank_foreign_accounts(client, monkeypatch):
    """Most expensive transactions are ranked by converted base-currency amount."""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {date(2026, 3, 15): Decimal("1.5")}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    await _seed_usd_currency()
    headers, cad_account_id, category_id = await _setup_user_with_deps(client)
    usd_account_id = (
        await _create_account(
            client,
            headers,
            name="USD Chequing",
            currency="USD",
        )
    ).json()["id"]

    cad_txn = await _create_transaction(client, headers, cad_account_id, category_id, amount=-8_500)
    usd_txn = await _create_transaction(
        client,
        headers,
        usd_account_id,
        category_id,
        amount=-6_000,
        currency="USD",
    )

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert [(row["id"], row["amount"], row["currency"]) for row in data["outliers"]] == [
        (usd_txn.json()["id"], -6_000, "USD"),
        (cad_txn.json()["id"], -8_500, "CAD"),
    ]
    assert data["outliers_fx_status"] == {"state": "complete", "missing_pairs": []}


async def test_transactions_overview_outliers_report_incomplete_fx(client, monkeypatch):
    """Most expensive transactions skip unconverted currencies and report missing pairs."""
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        if base == "USD":
            return {date(2026, 3, 15): Decimal("1.5")}
        raise FxRateNotFoundError()

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    async with TestSession() as session:
        session.add_all(
            [
                Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
                Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2),
            ]
        )
        await session.commit()

    headers, _, category_id = await _setup_user_with_deps(client)
    usd_account_id = (
        await _create_account(
            client,
            headers,
            name="USD Chequing",
            currency="USD",
        )
    ).json()["id"]
    abc_account_id = (
        await _create_account(
            client,
            headers,
            name="ABC Chequing",
            currency="ABC",
        )
    ).json()["id"]

    usd_txn = await _create_transaction(
        client,
        headers,
        usd_account_id,
        category_id,
        amount=-10_000,
        currency="USD",
    )
    await _create_transaction(
        client,
        headers,
        abc_account_id,
        category_id,
        amount=-90_000,
        currency="ABC",
    )

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert [(row["id"], row["amount"], row["currency"]) for row in data["outliers"]] == [
        (usd_txn.json()["id"], -10_000, "USD"),
    ]
    assert data["outliers_fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
    }


async def _seed_outflows(anchor_id, account_id, *, currency, day, amounts, ids=None):
    """Insert outflows straight into the database, in the category and for the user of an API-made anchor transaction

    The route would take a request per row, which is too slow for the volumes the cap is about. Pass ids
    to fix the identifiers that break ties
    """
    amounts = list(amounts)
    async with TestSession() as session:
        anchor = await session.get(Transaction, uuid.UUID(anchor_id))
        session.add_all(
            Transaction(
                **({"id": row_id} if ids else {}),
                created_by_user_id=anchor.created_by_user_id,
                account_id=uuid.UUID(account_id),
                category_id=anchor.category_id,
                dt=day,
                amount=amount,
                currency=currency,
            )
            for amount, row_id in zip(amounts, ids or [None] * len(amounts), strict=True)
        )
        await session.commit()


async def test_transactions_overview_outliers_read_a_bounded_number_of_candidates(client, monkeypatch):
    """Rows beyond the few that can reach the panel are left in the database, whatever their number."""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {date(2026, 3, 15): Decimal("1.5")}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)
    read_counts = []
    get_candidate_rows = overview_service.get_overview_outlier_candidate_rows

    async def count_candidate_rows(*args, **kwargs):
        rows = await get_candidate_rows(*args, **kwargs)
        read_counts.append(len(rows))

        # The merchant name and notes of a row are read only once it is on the panel
        assert not {"notes", "merchant_name"} & set(rows[0]._fields)
        return rows

    monkeypatch.setattr(overview_service, "get_overview_outlier_candidate_rows", count_candidate_rows)

    await _seed_usd_currency()
    headers, cad_account_id, category_id = await _setup_user_with_deps(client)
    usd_account_id = (await _create_account(client, headers, name="USD Chequing", currency="USD")).json()["id"]
    anchor = await _create_transaction(client, headers, cad_account_id, category_id, amount=-100)
    day = date(2026, 3, 15)
    await _seed_outflows(anchor.json()["id"], cad_account_id, currency="CAD", day=day, amounts=range(-1_000, -1_200, -1))
    await _seed_outflows(anchor.json()["id"], usd_account_id, currency="USD", day=day, amounts=range(-700, -900, -1))

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert read_counts == [6], "three candidates for each of the two currencies on the one date"
    assert [(row["amount"], row["currency"]) for row in data["outliers"]] == [(-899, "USD"), (-898, "USD"), (-897, "USD")]


async def test_transactions_overview_outliers_rank_amounts_converted_at_each_dates_own_rate(client, monkeypatch):
    """A smaller amount on a day of a stronger rate outranks a larger one on a day of a weaker rate."""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {date(2026, 3, 14): Decimal("0.5"), date(2026, 3, 15): Decimal("2")}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    await _seed_usd_currency()
    headers, _, category_id = await _setup_user_with_deps(client)
    usd_account_id = (await _create_account(client, headers, name="USD Chequing", currency="USD")).json()["id"]
    for amount in (-9_000, -8_000, -7_000, -6_000):
        await _create_transaction(client, headers, usd_account_id, category_id, dt="2026-03-14", amount=amount, currency="USD")
    for amount in (-3_000, -2_900, -2_800):
        await _create_transaction(client, headers, usd_account_id, category_id, dt="2026-03-15", amount=amount, currency="USD")

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    # -3,000 USD is -6,000 CAD at 2, while the larger -9,000 USD is only -4,500 CAD at 0.5
    assert [(row["dt"], row["amount"]) for row in resp.json()["outliers"]] == [
        ("2026-03-15", -3_000),
        ("2026-03-15", -2_900),
        ("2026-03-15", -2_800),
    ]


def _yen_rates_at_half_a_cent(start_date, end_date):
    """Return a rate of half a Canadian cent a yen for every date from start to end, the rate at which neighbouring yen amounts collide"""
    return {start_date + timedelta(days=offset): Decimal("0.005") for offset in range((end_date - start_date).days + 1)}


@pytest.mark.parametrize(
    ("rows", "expected_ids"),
    [
        pytest.param(
            # A keeps the third place of the query's numbering and the largest identifier, yet B3 outranks it
            [(-1_002, 0xFF), (-1_001, 1), (-1_001, 3), (-1_001, 5)],
            [1, 3, 5],
            id="earlier-candidate-of-another-amount",
        ),
        pytest.param(
            [(-2_000, 0xA0), (-1_500, 0xA1), (-1_002, 0xFF), *[(-1_001, number) for number in range(1, 16)]],
            [0xA0, 0xA1, 1],
            id="left-out-larger-amount",
        ),
    ],
)
async def test_transactions_overview_outliers_rank_rounded_ties_across_a_cut_group_by_identifier(client, monkeypatch, rows, expected_ids):
    """Yen that convert to one Canadian outflow rank by identifier, whichever of them the query numbered first."""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return _yen_rates_at_half_a_cent(start_date, end_date)

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    await _seed_jpy_currency()
    headers, cad_account_id, category_id = await _setup_user_with_deps(client)
    jpy_account_id = (await _create_account(client, headers, name="JPY Chequing", currency="JPY")).json()["id"]
    anchor = await _create_transaction(client, headers, cad_account_id, category_id, dt="2026-03-10", amount=-100)

    # At half a Canadian cent a yen, -1,002 and -1,001 both convert to -501 cents
    await _seed_outflows(
        anchor.json()["id"],
        jpy_account_id,
        currency="JPY",
        day=date(2026, 3, 15),
        amounts=[amount for amount, _ in rows],
        ids=[uuid.UUID(int=number) for _, number in rows],
    )

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    assert [row["id"] for row in resp.json()["outliers"]] == [str(uuid.UUID(int=number)) for number in expected_ids]


async def test_transactions_overview_outliers_match_a_full_ranking_of_colliding_amounts(client, monkeypatch):
    """Rows crowded onto few amounts that convert to few outflows show what ranking every row would."""
    from app.services.fx import FrankfurterProvider
    from app.utils.money import convert_minor_units_between_currencies

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return _yen_rates_at_half_a_cent(start_date, end_date)

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    await _seed_jpy_currency()
    headers, cad_account_id, category_id = await _setup_user_with_deps(client)
    jpy_account_id = (await _create_account(client, headers, name="JPY Chequing", currency="JPY")).json()["id"]
    anchor = await _create_transaction(client, headers, cad_account_id, category_id, dt="2026-02-01", amount=-100)

    # Each round fills one date with four to fourteen rows on eleven amounts, so several rows share an amount
    # and neighbouring amounts share an outflow. The amounts and identifiers follow from the date and position
    for day_number in range(1, 13):
        day = date(2026, 3, day_number)
        rows = [
            (-(1_000 + (position * 7 + day_number * 3) % 11), uuid.uuid5(uuid.NAMESPACE_URL, f"{day}/{position}"))
            for position in range(4 + (day_number * 5) % 11)
        ]
        await _seed_outflows(
            anchor.json()["id"],
            jpy_account_id,
            currency="JPY",
            day=day,
            amounts=[amount for amount, _ in rows],
            ids=[row_id for _, row_id in rows],
        )

        resp = await client.get("/transactions/overview", params={"from_date": day.isoformat(), "to_date": day.isoformat()}, headers=headers)

        converted = sorted(
            (convert_minor_units_between_currencies(amount, rate=Decimal("0.005"), base_exponent=0, quote_exponent=2), str(row_id))
            for amount, row_id in rows
        )
        assert resp.status_code == 200
        assert [row["id"] for row in resp.json()["outliers"]] == [row_id for _, row_id in converted[:3]], f"rows of {day}: {rows}"


async def test_transactions_overview_outliers_load_notes_only_for_the_transactions_shown(client, monkeypatch):
    """Notes of the transactions that miss the panel are never read."""
    read_ids = []
    get_details = overview_service.outliers.get_overview_outlier_details

    async def record_detail_ids(db, transaction_ids):
        read_ids.append({str(transaction_id) for transaction_id in transaction_ids})
        return await get_details(db, transaction_ids)

    monkeypatch.setattr(overview_service.outliers, "get_overview_outlier_details", record_detail_ids)

    headers, account_id, category_id = await _setup_user_with_deps(client)
    for amount in (-1_000, -2_000, -3_000, -4_000, -5_000):
        await _create_transaction(client, headers, account_id, category_id, amount=amount, notes=f"Note for {amount}")

    resp = await client.get("/transactions/overview", headers=headers)

    assert resp.status_code == 200
    shown = resp.json()["outliers"]
    assert [(row["amount"], row["notes"]) for row in shown] == [
        (-5_000, "Note for -5000"),
        (-4_000, "Note for -4000"),
        (-3_000, "Note for -3000"),
    ]
    assert read_ids == [{row["id"] for row in shown}]
