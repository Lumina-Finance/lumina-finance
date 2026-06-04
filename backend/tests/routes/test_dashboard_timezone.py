from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import update

from app.models.account import AccountBalanceSnapshot
from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.conftest import _create_account, _create_user, _get_auth_header


class _FixedClock:
    def __init__(self, instant):
        self.instant = instant

    def now(self, tz=None):
        return self.instant.astimezone(tz) if tz else self.instant


def _owner_local_creation_day(account):
    return datetime.fromisoformat(account["created_at"]).astimezone(ZoneInfo("America/Toronto")).date()


async def _create_category(client, headers, **overrides):
    payload = {"name": "Test Groceries", "kind": "expense", **overrides}
    return await client.post("/categories", json=payload, headers=headers)


async def _create_merchant(client, headers, **overrides):
    payload = {"name": "Test Merchant", **overrides}
    return await client.post("/merchants", json=payload, headers=headers)


async def _create_transaction(client, headers, account_id, category_id, **overrides):
    payload = {
        "account_id": account_id,
        "category_id": category_id,
        "dt": "2025-12-31",
        "amount": -5000,
        "currency": "CAD",
        **overrides,
    }
    return await client.post("/transactions", json=payload, headers=headers)


async def test_dashboard_spending_breakdown_uses_viewer_timezone_at_utc_boundary(client, monkeypatch):
    """At Jan 1 01:00 UTC, a Toronto user's dashboard MTD is still December."""
    from app.routes import dashboard as dashboard_routes

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 1, 1, 1, 0, tzinfo=UTC)))

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = (await _create_account(client, headers)).json()["id"]
    category_id = (await _create_category(client, headers)).json()["id"]

    await _create_transaction(client, headers, account_id, category_id, dt="2025-12-31", amount=-4100)
    await _create_transaction(client, headers, account_id, category_id, dt="2026-01-01", amount=-9999)

    resp = await client.get("/dashboard/spending-breakdown", params={"range": "MTD"}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["expense"][0]["amount"] == 4100
    assert data["expense_total"] == 4100
    assert data["income_total"] == 0


async def test_dashboard_spending_breakdown_counts_category_crossovers_by_sign(client, monkeypatch):
    """Income losses become spending rows; over-refunded expenses become income rows."""
    from app.routes import dashboard as dashboard_routes

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 4, 20, 16, 0, tzinfo=UTC)))

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = (await _create_account(client, headers, name="Main Cash")).json()["id"]
    salary_id = (await _create_category(client, headers, name="Test Salary", kind="income")).json()["id"]
    capital_loss_id = (await _create_category(client, headers, name="Test Capital Gains", kind="income")).json()["id"]
    groceries_id = (await _create_category(client, headers, name="Test Groceries Net", kind="expense")).json()["id"]
    over_refund_id = (await _create_category(client, headers, name="Test Over-refunded", kind="expense")).json()["id"]

    await _create_transaction(client, headers, account_id, salary_id, dt="2026-04-02", amount=300_000)
    await _create_transaction(client, headers, account_id, capital_loss_id, dt="2026-04-03", amount=-80_000)
    await _create_transaction(client, headers, account_id, groceries_id, dt="2026-04-04", amount=-100_000)
    await _create_transaction(client, headers, account_id, groceries_id, dt="2026-04-05", amount=40_000)
    await _create_transaction(client, headers, account_id, over_refund_id, dt="2026-04-06", amount=20_000)

    resp = await client.get("/dashboard/spending-breakdown", params={"range": "MTD"}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["expense"] == [
        {
            "category_id": capital_loss_id,
            "name": "Test Capital Gains",
            "category_kind": "income",
            "amount": 80_000,
        },
        {
            "category_id": groceries_id,
            "name": "Test Groceries Net",
            "category_kind": "expense",
            "amount": 60_000,
        },
    ]
    assert data["income"] == [
        {
            "category_id": salary_id,
            "name": "Test Salary",
            "category_kind": "income",
            "amount": 300_000,
        },
        {
            "category_id": over_refund_id,
            "name": "Test Over-refunded",
            "category_kind": "expense",
            "amount": 20_000,
        },
    ]
    assert data["expense_total"] == 120_000
    assert data["income_total"] == 240_000


async def test_dashboard_spending_breakdown_uses_other_for_tiny_slices(client, monkeypatch):
    """The compact dashboard donut groups hidden category slices into Other."""
    from app.routes import dashboard as dashboard_routes

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 5, 20, 16, 0, tzinfo=UTC)))

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = (await _create_account(client, headers, name="Main Cash")).json()["id"]
    categories = [
        (await _create_category(client, headers, name=f"Test Category {index}", kind="expense")).json()
        for index in range(1, 8)
    ]

    for index, category in enumerate(categories, start=1):
        await _create_transaction(
            client,
            headers,
            account_id,
            category["id"],
            dt=f"2026-05-{index:02d}",
            amount=-(10_000 * index),
        )

    resp = await client.get("/dashboard/spending-breakdown", params={"range": "MTD"}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["expense"][:-1] == [
        {
            "category_id": categories[index - 1]["id"],
            "name": f"Test Category {index}",
            "category_kind": "expense",
            "amount": 10_000 * index,
        }
        for index in range(7, 1, -1)
    ]
    assert data["expense"][-1]["name"] == "Other"
    assert data["expense"][-1]["category_kind"] == "expense"
    assert data["expense"][-1]["amount"] == 10_000
    assert data["expense_total"] == 280_000
    assert data["income_total"] == 0


async def test_dashboard_spending_breakdown_keeps_hidden_flipped_categories_out_of_other(client, monkeypatch):
    """Small crossover rows stay explicit so their badge context is visible."""
    from app.routes import dashboard as dashboard_routes

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 6, 20, 16, 0, tzinfo=UTC)))

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = (await _create_account(client, headers, name="Main Cash")).json()["id"]
    expense_categories = [
        (await _create_category(client, headers, name=f"Test Visible Expense {index}", kind="expense")).json()
        for index in range(1, 7)
    ]
    small_expense_id = (
        await _create_category(client, headers, name="Test Small Expense", kind="expense")
    ).json()["id"]
    income_loss_id = (
        await _create_category(client, headers, name="Test Hidden Income Loss", kind="income")
    ).json()["id"]
    income_categories = [
        (await _create_category(client, headers, name=f"Test Visible Income {index}", kind="income")).json()
        for index in range(1, 7)
    ]
    small_income_id = (
        await _create_category(client, headers, name="Test Small Income", kind="income")
    ).json()["id"]
    expense_refund_id = (
        await _create_category(client, headers, name="Test Hidden Expense Refund", kind="expense")
    ).json()["id"]

    for index, category in enumerate(expense_categories, start=1):
        await _create_transaction(
            client,
            headers,
            account_id,
            category["id"],
            dt=f"2026-06-{index:02d}",
            amount=-(100_000 - index * 10_000),
        )
    await _create_transaction(client, headers, account_id, small_expense_id, dt="2026-06-08", amount=-1_000)
    await _create_transaction(client, headers, account_id, income_loss_id, dt="2026-06-09", amount=-500)

    for index, category in enumerate(income_categories, start=1):
        await _create_transaction(
            client,
            headers,
            account_id,
            category["id"],
            dt=f"2026-06-{index + 10:02d}",
            amount=100_000 - index * 10_000,
        )
    await _create_transaction(client, headers, account_id, small_income_id, dt="2026-06-18", amount=1_000)
    await _create_transaction(client, headers, account_id, expense_refund_id, dt="2026-06-19", amount=500)

    resp = await client.get("/dashboard/spending-breakdown", params={"range": "MTD"}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert [entry["name"] for entry in data["expense"]] == [
        "Test Visible Expense 1",
        "Test Visible Expense 2",
        "Test Visible Expense 3",
        "Test Visible Expense 4",
        "Test Visible Expense 5",
        "Test Visible Expense 6",
        "Test Hidden Income Loss",
        "Other",
    ]
    assert data["expense"][-2] == {
        "category_id": income_loss_id,
        "name": "Test Hidden Income Loss",
        "category_kind": "income",
        "amount": 500,
    }
    assert data["expense"][-1]["category_kind"] == "expense"
    assert data["expense"][-1]["amount"] == 1_000
    assert [entry["name"] for entry in data["income"]] == [
        "Test Visible Income 1",
        "Test Visible Income 2",
        "Test Visible Income 3",
        "Test Visible Income 4",
        "Test Visible Income 5",
        "Test Visible Income 6",
        "Test Hidden Expense Refund",
        "Other",
    ]
    assert data["income"][-2] == {
        "category_id": expense_refund_id,
        "name": "Test Hidden Expense Refund",
        "category_kind": "expense",
        "amount": 500,
    }
    assert data["income"][-1]["category_kind"] == "income"
    assert data["income"][-1]["amount"] == 1_000
    assert data["expense_total"] == 391_000
    assert data["income_total"] == 391_000


async def test_dashboard_spending_breakdown_converts_foreign_currency_accounts(client, monkeypatch):
    """Spending breakdown converts foreign-currency activity with each transaction day's rate."""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider

    calls = []

    async def fake_get_rates(self, base, quote, start_date, end_date):
        calls.append((base, quote, start_date, end_date))
        return {
            date(2026, 3, 13): Decimal("1.25"),
            date(2026, 3, 14): Decimal("1.75"),
        }

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    cad_account_id = (await _create_account(client, headers, name="CAD Cash")).json()["id"]
    usd_account_id = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"]
    income_id = (await _create_category(client, headers, name="Test Salary", kind="income")).json()["id"]
    expense_id = (await _create_category(client, headers, name="Test Groceries", kind="expense")).json()["id"]

    await _create_transaction(client, headers, cad_account_id, expense_id, dt="2026-03-13", amount=-10_000)
    await _create_transaction(client, headers, cad_account_id, income_id, dt="2026-03-13", amount=50_000)
    await _create_transaction(
        client,
        headers,
        usd_account_id,
        expense_id,
        dt="2026-03-13",
        amount=-10_000,
        currency="USD",
    )
    await _create_transaction(
        client,
        headers,
        usd_account_id,
        expense_id,
        dt="2026-03-14",
        amount=-10_000,
        currency="USD",
    )
    await _create_transaction(
        client,
        headers,
        usd_account_id,
        income_id,
        dt="2026-03-13",
        amount=10_000,
        currency="USD",
    )

    resp = await client.get("/dashboard/spending-breakdown", params={"range": "MTD"}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["expense"] == [
        {
            "category_id": expense_id,
            "name": "Test Groceries",
            "category_kind": "expense",
            "amount": 40_000,
        },
    ]
    assert data["income"] == [
        {
            "category_id": income_id,
            "name": "Test Salary",
            "category_kind": "income",
            "amount": 62_500,
        },
    ]
    assert data["expense_total"] == 40_000
    assert data["income_total"] == 62_500
    assert data["fx_status"] == {"state": "complete", "missing_pairs": []}
    assert calls == [("USD", "CAD", date(2026, 3, 1), date(2026, 3, 20))]


async def test_dashboard_spending_breakdown_reports_incomplete_fx_with_missing_pairs(client, monkeypatch):
    """Spending breakdown skips unconverted foreign rows and reports the missing pair."""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        if base == "USD":
            return {date(2026, 3, 13): Decimal("1.5")}
        raise FxRateNotFoundError()

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add_all([
            Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
            Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2),
        ])
        await session.commit()

    usd_account_id = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"]
    abc_account_id = (await _create_account(client, headers, name="ABC Cash", currency="ABC")).json()["id"]
    expense_id = (await _create_category(client, headers, name="Test Groceries", kind="expense")).json()["id"]

    await _create_transaction(
        client,
        headers,
        usd_account_id,
        expense_id,
        dt="2026-03-13",
        amount=-20_000,
        currency="USD",
    )
    await _create_transaction(
        client,
        headers,
        abc_account_id,
        expense_id,
        dt="2026-03-13",
        amount=-90_000,
        currency="ABC",
    )

    resp = await client.get("/dashboard/spending-breakdown", params={"range": "MTD"}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["expense_total"] == 30_000
    assert data["fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [
            {
                "base": "ABC",
                "quote": "CAD",
            },
        ],
    }


async def test_dashboard_spending_breakdown_reports_unavailable_fx(client, monkeypatch):
    """Spending breakdown reports unavailable FX when every provider lookup fails."""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider, FxProviderUnavailableError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        raise FxProviderUnavailableError()

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    usd_account_id = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"]
    expense_id = (await _create_category(client, headers, name="Test Groceries", kind="expense")).json()["id"]

    await _create_transaction(
        client,
        headers,
        usd_account_id,
        expense_id,
        dt="2026-03-13",
        amount=-20_000,
        currency="USD",
    )

    resp = await client.get("/dashboard/spending-breakdown", params={"range": "MTD"}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["expense"] == []
    assert data["expense_total"] == 0
    assert data["fx_status"] == {
        "state": "unavailable",
        "missing_pairs": [
            {
                "base": "USD",
                "quote": "CAD",
            },
        ],
    }


async def test_dashboard_savings_rate_excludes_transfers(client, monkeypatch):
    """Savings rate totals include only income and expense categories."""
    from app.routes import dashboard as dashboard_routes

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = (await _create_account(client, headers)).json()["id"]
    income_id = (await _create_category(client, headers, name="Test Salary", kind="income")).json()["id"]
    expense_id = (await _create_category(client, headers, name="Test Groceries", kind="expense")).json()["id"]
    transfer_id = (await _create_category(client, headers, name="Test Transfer", kind="transfer")).json()["id"]

    await _create_transaction(client, headers, account_id, income_id, dt="2026-03-15", amount=500_000)
    await _create_transaction(client, headers, account_id, expense_id, dt="2026-03-16", amount=-200_000)
    await _create_transaction(client, headers, account_id, transfer_id, dt="2026-03-17", amount=-100_000)
    await _create_transaction(client, headers, account_id, transfer_id, dt="2026-03-18", amount=75_000)

    resp = await client.get("/dashboard/savings-rate", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["savings_rate_history"][-1] == {
        "month": "2026-03-01",
        "income": 500_000,
        "expenses": 200_000,
    }
    assert data["fx_status"] == {"state": "none", "missing_pairs": []}


async def test_dashboard_savings_rate_routes_flipped_categories_by_monthly_net(client, monkeypatch):
    """Savings rate nets each monthly category before assigning income or expense."""
    from app.routes import dashboard as dashboard_routes

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 4, 20, 16, 0, tzinfo=UTC)))

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = (await _create_account(client, headers, name="Main Cash")).json()["id"]
    salary_id = (await _create_category(client, headers, name="Test Salary", kind="income")).json()["id"]
    capital_loss_id = (await _create_category(client, headers, name="Test Capital Gains", kind="income")).json()["id"]
    groceries_id = (await _create_category(client, headers, name="Test Groceries Net", kind="expense")).json()["id"]
    over_refund_id = (await _create_category(client, headers, name="Test Over-refunded", kind="expense")).json()["id"]
    transfer_id = (await _create_category(client, headers, name="Test Transfer", kind="transfer")).json()["id"]

    await _create_transaction(client, headers, account_id, salary_id, dt="2026-04-02", amount=360_000)
    await _create_transaction(client, headers, account_id, salary_id, dt="2026-04-03", amount=-60_000)
    await _create_transaction(client, headers, account_id, capital_loss_id, dt="2026-04-04", amount=20_000)
    await _create_transaction(client, headers, account_id, capital_loss_id, dt="2026-04-05", amount=-100_000)
    await _create_transaction(client, headers, account_id, groceries_id, dt="2026-04-06", amount=-100_000)
    await _create_transaction(client, headers, account_id, groceries_id, dt="2026-04-07", amount=40_000)
    await _create_transaction(client, headers, account_id, over_refund_id, dt="2026-04-08", amount=-30_000)
    await _create_transaction(client, headers, account_id, over_refund_id, dt="2026-04-09", amount=50_000)
    await _create_transaction(client, headers, account_id, transfer_id, dt="2026-04-10", amount=999_999)
    await _create_transaction(client, headers, account_id, transfer_id, dt="2026-04-11", amount=-999_999)

    resp = await client.get("/dashboard/savings-rate", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["savings_rate_history"][-1] == {
        "month": "2026-04-01",
        "income": 320_000,
        "expenses": 140_000,
    }


async def test_dashboard_savings_rate_converts_foreign_currency_accounts(client, monkeypatch):
    """Savings rate includes foreign-currency account activity converted to the user's base currency."""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider

    calls = []

    async def fake_get_rates(self, base, quote, start_date, end_date):
        calls.append((base, quote, start_date, end_date))
        return {
            date(2026, 3, 15): Decimal("1.5"),
            date(2026, 3, 16): Decimal("1.5"),
        }

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    cad_account_id = (await _create_account(client, headers, name="CAD Cash")).json()["id"]
    usd_account_id = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"]
    income_id = (await _create_category(client, headers, name="Test Salary", kind="income")).json()["id"]
    expense_id = (await _create_category(client, headers, name="Test Groceries", kind="expense")).json()["id"]

    await _create_transaction(client, headers, cad_account_id, income_id, dt="2026-03-15", amount=100_000)
    await _create_transaction(client, headers, cad_account_id, expense_id, dt="2026-03-16", amount=-40_000)
    await _create_transaction(
        client,
        headers,
        usd_account_id,
        income_id,
        dt="2026-03-15",
        amount=20_000,
        currency="USD",
    )
    await _create_transaction(
        client,
        headers,
        usd_account_id,
        expense_id,
        dt="2026-03-16",
        amount=-10_000,
        currency="USD",
    )

    resp = await client.get("/dashboard/savings-rate", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["savings_rate_history"][-1] == {
        "month": "2026-03-01",
        "income": 130_000,
        "expenses": 55_000,
    }
    assert data["fx_status"] == {"state": "complete", "missing_pairs": []}
    assert calls == [("USD", "CAD", date(2025, 9, 1), date(2026, 3, 31))]


async def test_dashboard_savings_rate_reports_incomplete_fx_with_missing_pairs(client, monkeypatch):
    """Savings rate skips unconverted foreign account activity and reports the missing pair."""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        if base == "USD":
            return {date(2026, 3, 15): Decimal("1.5")}
        raise FxRateNotFoundError()

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add_all([
            Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
            Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2),
        ])
        await session.commit()

    cad_account_id = (await _create_account(client, headers, name="CAD Cash")).json()["id"]
    usd_account_id = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"]
    abc_account_id = (await _create_account(client, headers, name="ABC Cash", currency="ABC")).json()["id"]
    income_id = (await _create_category(client, headers, name="Test Salary", kind="income")).json()["id"]

    await _create_transaction(client, headers, cad_account_id, income_id, dt="2026-03-15", amount=100_000)
    await _create_transaction(
        client,
        headers,
        usd_account_id,
        income_id,
        dt="2026-03-15",
        amount=20_000,
        currency="USD",
    )
    await _create_transaction(
        client,
        headers,
        abc_account_id,
        income_id,
        dt="2026-03-15",
        amount=90_000,
        currency="ABC",
    )

    resp = await client.get("/dashboard/savings-rate", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["savings_rate_history"][-1] == {
        "month": "2026-03-01",
        "income": 130_000,
        "expenses": 0,
    }
    assert data["fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [
            {
                "base": "ABC",
                "quote": "CAD",
            },
        ],
    }


async def test_dashboard_savings_rate_reports_unavailable_fx(client, monkeypatch):
    """Savings rate reports unavailable FX when every provider lookup fails."""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider, FxProviderUnavailableError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        raise FxProviderUnavailableError()

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    usd_account_id = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"]
    income_id = (await _create_category(client, headers, name="Test Salary", kind="income")).json()["id"]

    await _create_transaction(
        client,
        headers,
        usd_account_id,
        income_id,
        dt="2026-03-15",
        amount=20_000,
        currency="USD",
    )

    resp = await client.get("/dashboard/savings-rate", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["savings_rate_history"][-1] == {
        "month": "2026-03-01",
        "income": 0,
        "expenses": 0,
    }
    assert data["fx_status"] == {
        "state": "unavailable",
        "missing_pairs": [
            {
                "base": "USD",
                "quote": "CAD",
            },
        ],
    }


async def test_dashboard_spending_comparison_converts_foreign_currency_accounts(client, monkeypatch):
    """Spending comparison converts foreign-currency expenses with each transaction day's rate."""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider

    calls = []

    async def fake_get_rates(self, base, quote, start_date, end_date):
        calls.append((base, quote, start_date, end_date))
        return {
            date(2026, 2, 15): Decimal("3"),
            date(2026, 3, 15): Decimal("1.5"),
            date(2026, 3, 16): Decimal("2"),
        }

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    cad_account_id = (await _create_account(client, headers, name="CAD Cash")).json()["id"]
    usd_account_id = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"]
    expense_id = (await _create_category(client, headers, name="Test Groceries", kind="expense")).json()["id"]

    await _create_transaction(client, headers, cad_account_id, expense_id, dt="2026-03-15", amount=-10_000)
    await _create_transaction(
        client,
        headers,
        usd_account_id,
        expense_id,
        dt="2026-03-15",
        amount=-20_000,
        currency="USD",
    )
    await _create_transaction(
        client,
        headers,
        usd_account_id,
        expense_id,
        dt="2026-03-16",
        amount=-10_000,
        currency="USD",
    )
    await _create_transaction(
        client,
        headers,
        usd_account_id,
        expense_id,
        dt="2026-02-15",
        amount=-10_000,
        currency="USD",
    )

    resp = await client.get("/dashboard/spending-comparison", params={"range": "MTD"}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current"][14] == 40_000
    assert data["current"][15] == 60_000
    assert data["current"][-1] == 60_000
    assert data["previous"][14] == 30_000
    assert data["previous"][-1] == 30_000
    assert data["fx_status"] == {"state": "complete", "missing_pairs": []}
    assert calls == [
        ("USD", "CAD", date(2026, 3, 1), date(2026, 3, 20)),
        ("USD", "CAD", date(2026, 2, 1), date(2026, 2, 28)),
    ]


async def test_dashboard_spending_comparison_reports_incomplete_fx_with_missing_pairs(client, monkeypatch):
    """Spending comparison skips unconverted foreign expense rows and reports the missing pair."""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        if base == "USD":
            return {date(2026, 3, 15): Decimal("1.5")}
        raise FxRateNotFoundError()

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add_all([
            Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
            Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2),
        ])
        await session.commit()

    usd_account_id = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"]
    abc_account_id = (await _create_account(client, headers, name="ABC Cash", currency="ABC")).json()["id"]
    expense_id = (await _create_category(client, headers, name="Test Groceries", kind="expense")).json()["id"]

    await _create_transaction(
        client,
        headers,
        usd_account_id,
        expense_id,
        dt="2026-03-15",
        amount=-20_000,
        currency="USD",
    )
    await _create_transaction(
        client,
        headers,
        abc_account_id,
        expense_id,
        dt="2026-03-15",
        amount=-90_000,
        currency="ABC",
    )

    resp = await client.get("/dashboard/spending-comparison", params={"range": "MTD"}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current"][-1] == 30_000
    assert data["fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [
            {
                "base": "ABC",
                "quote": "CAD",
            },
        ],
    }


async def test_dashboard_spending_comparison_reports_unavailable_fx(client, monkeypatch):
    """Spending comparison reports unavailable FX when every provider lookup fails."""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider, FxProviderUnavailableError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        raise FxProviderUnavailableError()

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    usd_account_id = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"]
    expense_id = (await _create_category(client, headers, name="Test Groceries", kind="expense")).json()["id"]

    await _create_transaction(
        client,
        headers,
        usd_account_id,
        expense_id,
        dt="2026-03-15",
        amount=-20_000,
        currency="USD",
    )

    resp = await client.get("/dashboard/spending-comparison", params={"range": "MTD"}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current"][-1] == 0
    assert data["fx_status"] == {
        "state": "unavailable",
        "missing_pairs": [
            {
                "base": "USD",
                "quote": "CAD",
            },
        ],
    }


async def test_dashboard_excludes_archived_accounts_from_net_worth_and_credit(client, monkeypatch):
    """Dashboard balance aggregates use non-archived accounts only."""
    from app.routes import dashboard as dashboard_routes

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    visible_asset = (await _create_account(client, headers, name="Visible Cash")).json()
    archived_asset = (await _create_account(client, headers, name="Archived Cash", is_archived=True)).json()
    visible_credit = (await _create_account(
        client, headers,
        account_kind="revolving",
        account_type="credit_card",
        name="Visible Card",
        credit_limit=200_000,
    )).json()
    archived_credit = (await _create_account(
        client, headers,
        account_kind="revolving",
        account_type="credit_card",
        name="Archived Card",
        credit_limit=900_000,
        is_archived=True,
    )).json()

    async with TestSession() as session:
        session.add_all([
            AccountBalanceSnapshot(account_id=UUID(visible_asset["id"]), dt=date(2026, 3, 20), balance=100_000),
            AccountBalanceSnapshot(account_id=UUID(archived_asset["id"]), dt=date(2026, 3, 20), balance=500_000),
            AccountBalanceSnapshot(account_id=UUID(visible_credit["id"]), dt=date(2026, 3, 20), balance=-30_000),
            AccountBalanceSnapshot(account_id=UUID(archived_credit["id"]), dt=date(2026, 3, 20), balance=-70_000),
        ])
        for account, balance in [
            (visible_asset, 100_000),
            (archived_asset, 500_000),
            (visible_credit, -30_000),
            (archived_credit, -70_000),
        ]:
            await session.execute(
                update(AccountBalanceSnapshot)
                .where(
                    AccountBalanceSnapshot.account_id == UUID(account["id"]),
                    AccountBalanceSnapshot.dt == _owner_local_creation_day(account),
                )
                .values(balance=balance),
            )
        await session.commit()

    resp = await client.get("/dashboard/net-worth", params={"window_days": 3}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current_net_worth"] == 70_000
    assert data["net_worth_history"][-1] == 70_000
    assert data["fx_status"] == {"state": "none", "missing_pairs": []}

    credit_resp = await client.get("/dashboard/credit", headers=headers)

    assert credit_resp.status_code == 200
    credit_data = credit_resp.json()
    assert credit_data["credit_limit_total"] == 200_000
    assert credit_data["credit_used"] == 30_000
    assert credit_data["fx_status"] == {"state": "none", "missing_pairs": []}


async def test_dashboard_net_worth_converts_foreign_currency_accounts(client, monkeypatch):
    """Net worth includes visible foreign-currency accounts converted to the user's base currency."""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider

    calls = []

    async def fake_get_rates(self, base, quote, start_date, end_date):
        calls.append((base, quote, start_date, end_date))
        return {date(2026, 3, 20): Decimal("1.5")}

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    cad_account = (await _create_account(client, headers, name="CAD Cash")).json()
    usd_account = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()

    async with TestSession() as session:
        session.add_all([
            AccountBalanceSnapshot(account_id=UUID(cad_account["id"]), dt=date(2026, 3, 20), balance=100_00),
            AccountBalanceSnapshot(account_id=UUID(usd_account["id"]), dt=date(2026, 3, 20), balance=200_00),
        ])
        await session.commit()

    resp = await client.get("/dashboard/net-worth", params={"window_days": 2}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current_net_worth"] == 400_00
    assert data["net_worth_history"] == [0, 400_00]
    assert data["fx_status"] == {"state": "complete", "missing_pairs": []}
    assert calls == [("USD", "CAD", date(2026, 3, 19), date(2026, 3, 20))]


async def test_dashboard_net_worth_reports_incomplete_fx_with_missing_pairs(client, monkeypatch):
    """Net worth skips unconverted foreign accounts and reports the missing pair."""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        if base == "USD":
            return {date(2026, 3, 20): Decimal("1.5")}
        raise FxRateNotFoundError()

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add_all([
            Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
            Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2),
        ])
        await session.commit()

    cad_account = (await _create_account(client, headers, name="CAD Cash")).json()
    usd_account = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()
    abc_account = (await _create_account(client, headers, name="ABC Cash", currency="ABC")).json()

    async with TestSession() as session:
        session.add_all([
            AccountBalanceSnapshot(account_id=UUID(cad_account["id"]), dt=date(2026, 3, 20), balance=100_00),
            AccountBalanceSnapshot(account_id=UUID(usd_account["id"]), dt=date(2026, 3, 20), balance=200_00),
            AccountBalanceSnapshot(account_id=UUID(abc_account["id"]), dt=date(2026, 3, 20), balance=900_00),
        ])
        await session.commit()

    resp = await client.get("/dashboard/net-worth", params={"window_days": 1}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current_net_worth"] == 400_00
    assert data["fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [
            {
                "base": "ABC",
                "quote": "CAD",
            },
        ],
    }


async def test_dashboard_net_worth_reports_unavailable_fx(client, monkeypatch):
    """Net worth reports unavailable FX when every provider lookup fails."""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider, FxProviderUnavailableError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        raise FxProviderUnavailableError()

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    usd_account = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()

    async with TestSession() as session:
        session.add(AccountBalanceSnapshot(account_id=UUID(usd_account["id"]), dt=date(2026, 3, 20), balance=200_00))
        await session.commit()

    resp = await client.get("/dashboard/net-worth", params={"window_days": 1}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current_net_worth"] == 0
    assert data["fx_status"] == {
        "state": "unavailable",
        "missing_pairs": [
            {
                "base": "USD",
                "quote": "CAD",
            },
        ],
    }


async def test_dashboard_credit_converts_foreign_currency_accounts(client, monkeypatch):
    """Credit usage includes foreign-currency cards converted to the user's base currency."""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider

    calls = []

    async def fake_get_rates(self, base, quote, start_date, end_date):
        calls.append((base, quote, start_date, end_date))
        return {date(2026, 3, 20): Decimal("1.5")}

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    cad_card = (await _create_account(
        client,
        headers,
        account_kind="revolving",
        account_type="credit_card",
        name="CAD Card",
        credit_limit=100_000,
    )).json()
    usd_card = (await _create_account(
        client,
        headers,
        account_kind="revolving",
        account_type="credit_card",
        name="USD Card",
        currency="USD",
        credit_limit=20_000,
    )).json()

    async with TestSession() as session:
        for account, balance in [(cad_card, -30_000), (usd_card, -5_000)]:
            await session.execute(
                update(AccountBalanceSnapshot)
                .where(
                    AccountBalanceSnapshot.account_id == UUID(account["id"]),
                    AccountBalanceSnapshot.dt == _owner_local_creation_day(account),
                )
                .values(balance=balance),
            )
        await session.commit()

    resp = await client.get("/dashboard/credit", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["credit_limit_total"] == 130_000
    assert data["credit_used"] == 37_500
    assert data["fx_status"] == {"state": "complete", "missing_pairs": []}
    assert calls == [("USD", "CAD", date(2026, 3, 20), date(2026, 3, 20))]


async def test_dashboard_credit_reports_incomplete_fx_with_missing_pairs(client, monkeypatch):
    """Credit usage skips unconverted foreign cards and reports the missing pair."""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        if base == "USD":
            return {date(2026, 3, 20): Decimal("1.5")}
        raise FxRateNotFoundError()

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add_all([
            Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
            Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2),
        ])
        await session.commit()

    cad_card = (await _create_account(
        client,
        headers,
        account_kind="revolving",
        account_type="credit_card",
        name="CAD Card",
        credit_limit=100_000,
    )).json()
    usd_card = (await _create_account(
        client,
        headers,
        account_kind="revolving",
        account_type="credit_card",
        name="USD Card",
        currency="USD",
        credit_limit=20_000,
    )).json()
    abc_card = (await _create_account(
        client,
        headers,
        account_kind="revolving",
        account_type="credit_card",
        name="ABC Card",
        currency="ABC",
        credit_limit=90_000,
    )).json()

    async with TestSession() as session:
        for account, balance in [(cad_card, -30_000), (usd_card, -5_000), (abc_card, -10_000)]:
            await session.execute(
                update(AccountBalanceSnapshot)
                .where(
                    AccountBalanceSnapshot.account_id == UUID(account["id"]),
                    AccountBalanceSnapshot.dt == _owner_local_creation_day(account),
                )
                .values(balance=balance),
            )
        await session.commit()

    resp = await client.get("/dashboard/credit", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["credit_limit_total"] == 130_000
    assert data["credit_used"] == 37_500
    assert data["fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [
            {
                "base": "ABC",
                "quote": "CAD",
            },
        ],
    }


async def test_dashboard_credit_reports_unavailable_fx(client, monkeypatch):
    """Credit usage reports unavailable FX when every provider lookup fails."""
    from app.routes import dashboard as dashboard_routes
    from app.services.fx import FrankfurterProvider, FxProviderUnavailableError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        raise FxProviderUnavailableError()

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    usd_card = (await _create_account(
        client,
        headers,
        account_kind="revolving",
        account_type="credit_card",
        name="USD Card",
        currency="USD",
        credit_limit=20_000,
    )).json()

    async with TestSession() as session:
        await session.execute(
            update(AccountBalanceSnapshot)
            .where(
                AccountBalanceSnapshot.account_id == UUID(usd_card["id"]),
                AccountBalanceSnapshot.dt == _owner_local_creation_day(usd_card),
            )
            .values(balance=-5_000),
        )
        await session.commit()

    resp = await client.get("/dashboard/credit", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["credit_limit_total"] == 0
    assert data["credit_used"] == 0
    assert data["fx_status"] == {
        "state": "unavailable",
        "missing_pairs": [
            {
                "base": "USD",
                "quote": "CAD",
            },
        ],
    }


async def test_dashboard_credit_used_ignores_positive_card_balances(client, monkeypatch):
    """Stored credit on a card does not count as used credit."""
    from app.routes import dashboard as dashboard_routes

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    credit_card = (await _create_account(
        client, headers,
        account_kind="revolving",
        account_type="credit_card",
        name="Credit Balance Card",
        credit_limit=1_500_000,
    )).json()

    async with TestSession() as session:
        session.add_all([
            AccountBalanceSnapshot(account_id=UUID(credit_card["id"]), dt=date(2026, 3, 20), balance=42_604),
        ])
        await session.execute(
            update(AccountBalanceSnapshot)
            .where(
                AccountBalanceSnapshot.account_id == UUID(credit_card["id"]),
                AccountBalanceSnapshot.dt == _owner_local_creation_day(credit_card),
            )
            .values(balance=42_604),
        )
        await session.commit()

    resp = await client.get("/dashboard/credit", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["credit_limit_total"] == 1_500_000
    assert data["credit_used"] == 0
    assert data["fx_status"] == {"state": "none", "missing_pairs": []}


async def test_dashboard_spending_savings_and_activity_exclude_archived_accounts(client, monkeypatch):
    """Dashboard transaction aggregates and recent activity use non-archived accounts only."""
    from app.routes import dashboard as dashboard_routes

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    visible_account_id = (await _create_account(client, headers, name="Visible Cash")).json()["id"]
    archived_account_id = (await _create_account(client, headers, name="Archived Cash", is_archived=True)).json()["id"]
    income_id = (await _create_category(client, headers, name="Test Salary", kind="income")).json()["id"]
    expense_id = (await _create_category(client, headers, name="Test Groceries", kind="expense")).json()["id"]
    merchant_id = (await _create_merchant(client, headers, name="Visible Store")).json()["id"]

    visible_income = await _create_transaction(client, headers, visible_account_id, income_id, dt="2026-03-15", amount=500_000)
    visible_expense = await _create_transaction(
        client, headers, visible_account_id, expense_id, dt="2026-03-16", amount=-200_000, merchant_id=merchant_id,
    )
    await _create_transaction(client, headers, archived_account_id, income_id, dt="2026-03-17", amount=700_000)
    await _create_transaction(client, headers, archived_account_id, expense_id, dt="2026-03-18", amount=-300_000)

    recent_activity_resp = await client.get("/dashboard/recent-activity", headers=headers)
    savings_rate_resp = await client.get("/dashboard/savings-rate", headers=headers)
    breakdown_resp = await client.get("/dashboard/spending-breakdown", params={"range": "MTD"}, headers=headers)
    comparison_resp = await client.get("/dashboard/spending-comparison", params={"range": "MTD"}, headers=headers)

    assert recent_activity_resp.status_code == 200
    recent_activity = recent_activity_resp.json()
    assert savings_rate_resp.status_code == 200
    assert savings_rate_resp.json()["savings_rate_history"][-1] == {
        "month": "2026-03-01",
        "income": 500_000,
        "expenses": 200_000,
    }
    recent_ids = {txn["id"] for txn in recent_activity["recent_transactions"]}
    assert recent_ids == {visible_income.json()["id"], visible_expense.json()["id"]}
    recent_by_id = {txn["id"]: txn for txn in recent_activity["recent_transactions"]}
    assert recent_by_id[visible_expense.json()["id"]]["merchant_name"] == "Visible Store"

    assert breakdown_resp.status_code == 200
    breakdown_data = breakdown_resp.json()
    assert breakdown_data["expense"][0]["amount"] == 200_000
    assert breakdown_data["fx_status"] == {"state": "none", "missing_pairs": []}
    assert comparison_resp.status_code == 200
    comparison_data = comparison_resp.json()
    assert comparison_data["current"][-1] == 200_000
    assert comparison_data["fx_status"] == {"state": "none", "missing_pairs": []}
