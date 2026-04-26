from datetime import UTC, datetime

from tests.routes.conftest import _create_account, _create_user, _get_auth_header


class _FixedClock:
    def __init__(self, instant):
        self.instant = instant

    def now(self, tz=None):
        return self.instant.astimezone(tz) if tz else self.instant


async def _create_category(client, headers, **overrides):
    payload = {"name": "Test Groceries", "kind": "expense", **overrides}
    return await client.post("/categories", json=payload, headers=headers)


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
    assert resp.json()["expense"][0]["amount"] == 4100


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

    resp = await client.get("/dashboard", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["savings_rate_history"][-1] == {
        "month": "2026-03-01",
        "income": 500_000,
        "expenses": 200_000,
    }
