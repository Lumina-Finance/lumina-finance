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
