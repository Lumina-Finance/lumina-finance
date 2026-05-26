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
            AccountBalanceSnapshot(account_id=UUID(visible_credit["id"]), dt=date(2026, 3, 20), balance=-30_000),
            AccountBalanceSnapshot(account_id=UUID(hidden_credit["id"]), dt=date(2026, 3, 20), balance=-70_000),
        ])
        for account, balance in [
            (visible_asset, 100_000),
            (hidden_asset, 500_000),
            (visible_credit, -30_000),
            (hidden_credit, -70_000),
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

    credit_resp = await client.get("/dashboard/credit", headers=headers)

    assert credit_resp.status_code == 200
    credit_data = credit_resp.json()
    assert credit_data["credit_limit_total"] == 200_000
    assert credit_data["credit_used"] == 30_000


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
    assert breakdown_resp.json()["expense"][0]["amount"] == 200_000
    assert comparison_resp.status_code == 200
    assert comparison_resp.json()["current"][-1] == 200_000
