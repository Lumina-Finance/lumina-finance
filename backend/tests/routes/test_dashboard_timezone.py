from datetime import UTC, date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import update

from app.models.account import AccountBalanceSnapshot
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


async def test_dashboard_excludes_hidden_accounts_from_net_worth_and_credit(client, monkeypatch):
    """Dashboard balance aggregates use visible accounts only."""
    from app.routes import dashboard as dashboard_routes

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    visible_asset = (await _create_account(client, headers, name="Visible Cash")).json()
    hidden_asset = (await _create_account(client, headers, name="Hidden Cash", is_hidden=True)).json()
    visible_credit = (await _create_account(
        client, headers,
        account_kind="revolving",
        account_type="credit_card",
        name="Visible Card",
        credit_limit=200_000,
    )).json()
    hidden_credit = (await _create_account(
        client, headers,
        account_kind="revolving",
        account_type="credit_card",
        name="Hidden Card",
        credit_limit=900_000,
        is_hidden=True,
    )).json()

    async with TestSession() as session:
        session.add_all([
            AccountBalanceSnapshot(account_id=UUID(visible_asset["id"]), dt=date(2026, 3, 20), balance=100_000),
            AccountBalanceSnapshot(account_id=UUID(hidden_asset["id"]), dt=date(2026, 3, 20), balance=500_000),
            AccountBalanceSnapshot(account_id=UUID(visible_credit["id"]), dt=date(2026, 3, 20), balance=30_000),
            AccountBalanceSnapshot(account_id=UUID(hidden_credit["id"]), dt=date(2026, 3, 20), balance=70_000),
        ])
        for account, balance in [
            (visible_asset, 100_000),
            (hidden_asset, 500_000),
            (visible_credit, 30_000),
            (hidden_credit, 70_000),
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

    resp = await client.get("/dashboard", params={"window_days": 3}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current_net_worth"] == 70_000
    assert data["net_worth_history"][-1] == 70_000
    assert data["credit_limit_total"] == 200_000
    assert data["credit_used"] == 30_000


async def test_dashboard_spending_savings_and_activity_exclude_hidden_accounts(client, monkeypatch):
    """Dashboard transaction aggregates and recent activity use visible accounts only."""
    from app.routes import dashboard as dashboard_routes

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    visible_account_id = (await _create_account(client, headers, name="Visible Cash")).json()["id"]
    hidden_account_id = (await _create_account(client, headers, name="Hidden Cash", is_hidden=True)).json()["id"]
    income_id = (await _create_category(client, headers, name="Test Salary", kind="income")).json()["id"]
    expense_id = (await _create_category(client, headers, name="Test Groceries", kind="expense")).json()["id"]
    merchant_id = (await _create_merchant(client, headers, name="Visible Store")).json()["id"]

    visible_income = await _create_transaction(client, headers, visible_account_id, income_id, dt="2026-03-15", amount=500_000)
    visible_expense = await _create_transaction(
        client, headers, visible_account_id, expense_id, dt="2026-03-16", amount=-200_000, merchant_id=merchant_id,
    )
    await _create_transaction(client, headers, hidden_account_id, income_id, dt="2026-03-17", amount=700_000)
    await _create_transaction(client, headers, hidden_account_id, expense_id, dt="2026-03-18", amount=-300_000)

    dashboard_resp = await client.get("/dashboard", headers=headers)
    breakdown_resp = await client.get("/dashboard/spending-breakdown", params={"range": "MTD"}, headers=headers)
    comparison_resp = await client.get("/dashboard/spending-comparison", params={"range": "MTD"}, headers=headers)

    assert dashboard_resp.status_code == 200
    dashboard = dashboard_resp.json()
    assert dashboard["savings_rate_history"][-1] == {
        "month": "2026-03-01",
        "income": 500_000,
        "expenses": 200_000,
    }
    recent_ids = {txn["id"] for txn in dashboard["recent_transactions"]}
    assert recent_ids == {visible_income.json()["id"], visible_expense.json()["id"]}
    recent_by_id = {txn["id"]: txn for txn in dashboard["recent_transactions"]}
    assert recent_by_id[visible_expense.json()["id"]]["merchant_name"] == "Visible Store"

    assert breakdown_resp.status_code == 200
    assert breakdown_resp.json()["expense"][0]["amount"] == 200_000
    assert comparison_resp.status_code == 200
    assert comparison_resp.json()["current"][-1] == 200_000
