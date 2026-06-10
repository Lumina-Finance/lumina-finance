from datetime import UTC, date, datetime
from decimal import Decimal

from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.dashboard._helpers import (
    _create_category,
    _create_transaction,
    _FixedClock,
)
from tests.routes.support import _create_account, _create_user, _get_auth_header


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
