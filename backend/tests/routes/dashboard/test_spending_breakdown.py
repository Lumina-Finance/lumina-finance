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
