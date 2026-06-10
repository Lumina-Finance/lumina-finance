from datetime import UTC, date, datetime
from uuid import UUID

from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.dashboard._helpers import (
    _create_category,
    _create_merchant,
    _create_transaction,
    _FixedClock,
)
from tests.routes.support import _create_account, _create_user, _get_auth_header


async def test_dashboard_spending_savings_and_activity_include_archived_accounts(client, monkeypatch):
    """Dashboard transaction aggregates and recent activity include archived accounts."""
    from app.routes import dashboard as dashboard_routes

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = UUID(signup_resp.json()["user"]["id"])
    visible_account_id = (await _create_account(client, headers, name="Visible Cash")).json()["id"]
    archived_account_id = (await _create_account(client, headers, name="Archived Cash", is_archived=True)).json()["id"]
    income_id = (await _create_category(client, headers, name="Test Salary", kind="income")).json()["id"]
    expense_id = (await _create_category(client, headers, name="Test Groceries", kind="expense")).json()["id"]
    merchant_id = (await _create_merchant(client, headers, name="Visible Store")).json()["id"]

    visible_income = await _create_transaction(client, headers, visible_account_id, income_id, dt="2026-03-15", amount=500_000)
    visible_expense = await _create_transaction(
        client, headers, visible_account_id, expense_id, dt="2026-03-16", amount=-200_000, merchant_id=merchant_id,
    )
    async with TestSession() as session:
        archived_income = Transaction(
            created_by_user_id=user_id,
            account_id=UUID(archived_account_id),
            category_id=UUID(income_id),
            dt=date(2026, 3, 17),
            amount=700_000,
            currency="CAD",
        )
        archived_expense = Transaction(
            created_by_user_id=user_id,
            account_id=UUID(archived_account_id),
            category_id=UUID(expense_id),
            dt=date(2026, 3, 18),
            amount=-300_000,
            currency="CAD",
        )
        session.add_all([archived_income, archived_expense])
        await session.flush()
        archived_income_id = str(archived_income.id)
        archived_expense_id = str(archived_expense.id)
        await session.commit()

    recent_activity_resp = await client.get("/dashboard/recent-activity", headers=headers)
    savings_rate_resp = await client.get("/dashboard/savings-rate", headers=headers)
    breakdown_resp = await client.get("/dashboard/spending-breakdown", params={"range": "MTD"}, headers=headers)
    comparison_resp = await client.get("/dashboard/spending-comparison", params={"range": "MTD"}, headers=headers)

    assert recent_activity_resp.status_code == 200
    recent_activity = recent_activity_resp.json()
    assert savings_rate_resp.status_code == 200
    assert savings_rate_resp.json()["savings_rate_history"][-1] == {
        "month": "2026-03-01",
        "income": 1_200_000,
        "expenses": 500_000,
    }
    recent_ids = {txn["id"] for txn in recent_activity["recent_transactions"]}
    assert recent_ids == {
        visible_income.json()["id"],
        visible_expense.json()["id"],
        archived_income_id,
        archived_expense_id,
    }
    recent_by_id = {txn["id"]: txn for txn in recent_activity["recent_transactions"]}
    assert recent_by_id[visible_expense.json()["id"]]["merchant_name"] == "Visible Store"

    assert breakdown_resp.status_code == 200
    breakdown_data = breakdown_resp.json()
    assert breakdown_data["expense"][0]["amount"] == 500_000
    assert breakdown_data["fx_status"] == {"state": "none", "missing_pairs": []}
    assert comparison_resp.status_code == 200
    comparison_data = comparison_resp.json()
    assert comparison_data["current"][-1] == 500_000
    assert comparison_data["fx_status"] == {"state": "none", "missing_pairs": []}
