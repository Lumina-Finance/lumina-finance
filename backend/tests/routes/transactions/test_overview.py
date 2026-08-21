from datetime import date
from decimal import Decimal

from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.transactions._helpers import (
    _create_account,
    _create_category,
    _create_transaction,
    _get_system_category_id,
    _seed_usd_currency,
    _setup_user_with_deps,
)

# --- GET /transactions/overview ---


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
        client, headers, account_id, transfer_id, amount=2_500, counterparty_account_scope="outside",
    )
    await _create_transaction(
        client, headers, account_id, transfer_id, amount=-1_500, counterparty_account_scope="outside",
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
    usd_account_id = (await _create_account(
        client,
        headers,
        name="USD Chequing",
        currency="USD",
    )).json()["id"]

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
    assert ("USD", "CAD", date(2026, 3, 14), date(2026, 3, 15)) in calls


async def test_transactions_overview_net_flow_reports_incomplete_fx(client, monkeypatch):
    """Net flow skips unconverted currencies and reports missing pairs."""
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        if base == "USD":
            return {date(2026, 3, 14): Decimal("1.5")}
        raise FxRateNotFoundError()

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    async with TestSession() as session:
        session.add_all([
            Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
            Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2),
        ])
        await session.commit()

    headers, _, category_id = await _setup_user_with_deps(client)
    usd_account_id = (await _create_account(
        client,
        headers,
        name="USD Chequing",
        currency="USD",
    )).json()["id"]
    abc_account_id = (await _create_account(
        client,
        headers,
        name="ABC Chequing",
        currency="ABC",
    )).json()["id"]

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
    usd_account_id = (await _create_account(
        client,
        headers,
        name="USD Chequing",
        currency="USD",
    )).json()["id"]

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
        session.add_all([
            Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
            Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2),
        ])
        await session.commit()

    headers, _, category_id = await _setup_user_with_deps(client)
    usd_account_id = (await _create_account(
        client,
        headers,
        name="USD Chequing",
        currency="USD",
    )).json()["id"]
    abc_account_id = (await _create_account(
        client,
        headers,
        name="ABC Chequing",
        currency="ABC",
    )).json()["id"]

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
        client, headers, account_id, transfer_category_id, amount=-20_000, counterparty_account_scope="outside",
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
    abc_account_id = (await _create_account(
        client,
        headers,
        name="ABC Chequing",
        currency="ABC",
    )).json()["id"]

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
    abc_account_id = (await _create_account(
        client,
        headers,
        name="ABC Chequing",
        currency="ABC",
    )).json()["id"]

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
    usd_account_id = (await _create_account(
        client,
        headers,
        name="USD Chequing",
        currency="USD",
    )).json()["id"]
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
        session.add_all([
            Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
            Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2),
        ])
        await session.commit()

    headers, _, category_id = await _setup_user_with_deps(client)
    usd_account_id = (await _create_account(
        client,
        headers,
        name="USD Chequing",
        currency="USD",
    )).json()["id"]
    abc_account_id = (await _create_account(
        client,
        headers,
        name="ABC Chequing",
        currency="ABC",
    )).json()["id"]

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
        client, headers, account_id, transfer_category_id, amount=-20_000, counterparty_account_scope="outside",
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
            client, headers, account_id, category_id,
            dt=tied_date.isoformat(), amount=-10_000,
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
            client, headers, account_id, category_id,
            dt="2026-03-15", amount=-10_000,
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
    usd_account_id = (await _create_account(
        client,
        headers,
        name="USD Chequing",
        currency="USD",
    )).json()["id"]

    # -6,000 USD converts to -9,000 CAD, the same outflow as the CAD row, on a later date
    cad_txn = await _create_transaction(
        client, headers, cad_account_id, category_id,
        dt="2026-03-14", amount=-9_000,
    )
    usd_txn = await _create_transaction(
        client, headers, usd_account_id, category_id,
        dt="2026-03-15", amount=-6_000, currency="USD",
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
    usd_account_id = (await _create_account(
        client,
        headers,
        name="USD Chequing",
        currency="USD",
    )).json()["id"]

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
        session.add_all([
            Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
            Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2),
        ])
        await session.commit()

    headers, _, category_id = await _setup_user_with_deps(client)
    usd_account_id = (await _create_account(
        client,
        headers,
        name="USD Chequing",
        currency="USD",
    )).json()["id"]
    abc_account_id = (await _create_account(
        client,
        headers,
        name="ABC Chequing",
        currency="ABC",
    )).json()["id"]

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
