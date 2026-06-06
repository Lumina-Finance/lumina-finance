"""Route tests for insights period-glance endpoint."""

from datetime import date
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import update

from app.models.account import AccountBalanceSnapshot
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.conftest import _create_account, _create_user, _get_auth_header


def _category(user_id: UUID, name: str, kind: CategoryKind) -> tuple[UUID, Category]:
    """Build a personal category row for direct test setup."""
    category_id = uuid4()
    return category_id, Category(id=category_id, owner_id=user_id, name=name, kind=kind)


def _transaction(user_id: UUID, account_id: UUID, category_id: UUID, dt: date, amount: int, currency: str = "CAD") -> Transaction:
    """Build a transaction row for direct test setup."""
    return Transaction(
        created_by_user_id=user_id,
        account_id=account_id,
        dt=dt,
        category_id=category_id,
        amount=amount,
        currency=currency,
    )


def _snapshot(account_id: UUID, dt: date, balance: int) -> AccountBalanceSnapshot:
    """Build an account balance snapshot row."""
    return AccountBalanceSnapshot(account_id=account_id, dt=dt, balance=balance)


async def _seed_usd_currency():
    """Insert USD for base-currency exclusion tests."""
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()


async def _create_category_api(client, headers, **overrides):
    payload = {"name": "Test Salary", "kind": "income", **overrides}
    return await client.post("/categories", json=payload, headers=headers)


async def _create_transaction_api(client, headers, account_id, category_id, **overrides):
    payload = {
        "account_id": account_id,
        "category_id": category_id,
        "dt": "2026-06-01",
        "amount": 100_000,
        "currency": "CAD",
        **overrides,
    }
    return await client.post("/transactions", json=payload, headers=headers)


async def test_period_glance_returns_compact_period_summary(client):
    """Period glance aggregates readable base-currency activity, including archived accounts."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)

    visible_account = (await _create_account(client, headers, name="Visible Cash")).json()
    archived_account = (await _create_account(client, headers, name="Archived Cash", is_archived=True)).json()
    visible_account_id = UUID(visible_account["id"])
    archived_account_id = UUID(archived_account["id"])
    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)
    groceries_id, groceries = _category(user_id, "Groceries", CategoryKind.EXPENSE)
    dining_id, dining = _category(user_id, "Dining", CategoryKind.EXPENSE)
    transfer_id, transfer = _category(user_id, "Transfer", CategoryKind.TRANSFER)
    balance_adjustment_id, balance_adjustment = _category(user_id, "Balance Adjustment", CategoryKind.TRANSFER)

    async with TestSession() as session:
        session.add_all([
            salary,
            groceries,
            dining,
            transfer,
            balance_adjustment,
            _transaction(user_id, visible_account_id, salary_id, date(2026, 3, 11), 500_000),
            _transaction(user_id, visible_account_id, groceries_id, date(2026, 3, 12), -120_000),
            _transaction(user_id, visible_account_id, dining_id, date(2026, 3, 13), -60_000),
            _transaction(user_id, visible_account_id, transfer_id, date(2026, 3, 14), 50_000),
            _transaction(user_id, visible_account_id, transfer_id, date(2026, 3, 15), -30_000),
            _transaction(user_id, visible_account_id, balance_adjustment_id, date(2026, 3, 15), 999_999),
            _transaction(user_id, visible_account_id, groceries_id, date(2026, 3, 4), -40_000),
            _transaction(user_id, visible_account_id, dining_id, date(2026, 3, 5), -100_000),
            _transaction(user_id, archived_account_id, salary_id, date(2026, 3, 12), 700_000),
            _transaction(user_id, archived_account_id, groceries_id, date(2026, 3, 13), -300_000),
            _snapshot(visible_account_id, date(2026, 3, 9), 1_000_000),
            _snapshot(visible_account_id, date(2026, 3, 10), 1_000_000),
            _snapshot(visible_account_id, date(2026, 3, 16), 1_320_000),
            _snapshot(archived_account_id, date(2026, 3, 10), 5_000_000),
            _snapshot(archived_account_id, date(2026, 3, 16), 6_000_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-03-10", "to_date": "2026-03-16"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data == {
        "income": 1_200_000,
        "expenses": 480_000,
        "income_expense_fx_status": {"state": "none", "missing_pairs": []},
        "net_worth_change": 6_320_000,
        "net_worth_change_fx_status": {"state": "none", "missing_pairs": []},
        "top_category_name": "Groceries",
        "top_category_share_pct": 88,
        "top_category_fx_status": {"state": "none", "missing_pairs": []},
        "biggest_change_name": "Groceries",
        "biggest_change_amount": 380_000,
        "biggest_change_pct": 950,
        "biggest_change_fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_period_glance_converts_foreign_income_and_expenses_and_signs_liability_balances(client, monkeypatch):
    """Income, expenses, and net-worth movement include converted foreign account values."""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {
            date(2026, 4, 30): Decimal("1.5"),
            date(2026, 5, 1): Decimal("1.5"),
            date(2026, 5, 2): Decimal("1.5"),
            date(2026, 5, 3): Decimal("1.5"),
            date(2026, 5, 7): Decimal("1.5"),
        }

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    await _seed_usd_currency()

    cash_account = (await _create_account(client, headers, name="CAD Cash")).json()
    card_account = (await _create_account(
        client,
        headers,
        account_kind="revolving",
        account_type="credit_card",
        name="CAD Card",
        credit_limit=500_000,
    )).json()
    usd_account = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()
    cash_account_id = UUID(cash_account["id"])
    card_account_id = UUID(card_account["id"])
    usd_account_id = UUID(usd_account["id"])
    salary_id, salary = _category(user_id, "Paycheque", CategoryKind.INCOME)
    food_id, food = _category(user_id, "Food", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            salary,
            food,
            _transaction(user_id, cash_account_id, salary_id, date(2026, 5, 2), 100_000),
            _transaction(user_id, cash_account_id, food_id, date(2026, 5, 3), -20_000),
            _transaction(user_id, usd_account_id, salary_id, date(2026, 5, 2), 900_000, "USD"),
            _transaction(user_id, usd_account_id, food_id, date(2026, 5, 3), -700_000, "USD"),
            _snapshot(cash_account_id, date(2026, 4, 30), 100_000),
            _snapshot(cash_account_id, date(2026, 5, 1), 100_000),
            _snapshot(cash_account_id, date(2026, 5, 7), 200_000),
            _snapshot(card_account_id, date(2026, 4, 30), -40_000),
            _snapshot(card_account_id, date(2026, 5, 1), -40_000),
            _snapshot(card_account_id, date(2026, 5, 7), -90_000),
            _snapshot(usd_account_id, date(2026, 4, 30), 5_000_000),
            _snapshot(usd_account_id, date(2026, 5, 1), 5_000_000),
            _snapshot(usd_account_id, date(2026, 5, 7), 9_000_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-05-01", "to_date": "2026-05-07"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["income"] == 1_450_000
    assert data["expenses"] == 1_070_000
    assert data["income_expense_fx_status"] == {"state": "complete", "missing_pairs": []}
    assert data["net_worth_change"] == 6_050_000
    assert data["net_worth_change_fx_status"] == {"state": "complete", "missing_pairs": []}
    assert data["top_category_name"] == "Food"
    assert data["top_category_share_pct"] == 100
    assert data["top_category_fx_status"] == {"state": "complete", "missing_pairs": []}
    assert data["biggest_change_name"] == "Food"
    assert data["biggest_change_amount"] == 1_070_000
    assert data["biggest_change_fx_status"] == {"state": "complete", "missing_pairs": []}
    assert "biggest_change_pct" not in data


async def test_period_glance_income_expenses_report_incomplete_fx(client, monkeypatch):
    """Income and expenses skip unconverted foreign rows and report missing pairs."""
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        raise FxRateNotFoundError()

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2))
        await session.commit()

    cad_account_id = UUID((await _create_account(client, headers, name="CAD Cash")).json()["id"])
    abc_account_id = UUID((await _create_account(client, headers, name="ABC Cash", currency="ABC")).json()["id"])
    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)
    food_id, food = _category(user_id, "Food", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            salary,
            food,
            _transaction(user_id, cad_account_id, salary_id, date(2026, 5, 2), 100_000),
            _transaction(user_id, abc_account_id, food_id, date(2026, 5, 3), -70_000, "ABC"),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-05-01", "to_date": "2026-05-07"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["income"] == 100_000
    assert data["expenses"] == 0
    assert data["income_expense_fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
    }
    assert data["net_worth_change_fx_status"] == {"state": "none", "missing_pairs": []}
    assert data["top_category_fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
    }
    assert data["biggest_change_fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
    }


async def test_period_glance_top_category_uses_converted_expense_totals(client, monkeypatch):
    """Top Category ranking uses converted expense-side totals."""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {date(2026, 5, 3): Decimal("1.5")}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    await _seed_usd_currency()

    cad_account_id = UUID((await _create_account(client, headers, name="CAD Cash")).json()["id"])
    usd_account_id = UUID((await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"])
    food_id, food = _category(user_id, "Food", CategoryKind.EXPENSE)
    travel_id, travel = _category(user_id, "Travel", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            food,
            travel,
            _transaction(user_id, cad_account_id, food_id, date(2026, 5, 3), -100_000),
            _transaction(user_id, usd_account_id, travel_id, date(2026, 5, 3), -90_000, "USD"),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-05-01", "to_date": "2026-05-07"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["top_category_name"] == "Travel"
    assert data["top_category_share_pct"] == 57
    assert data["top_category_fx_status"] == {"state": "complete", "missing_pairs": []}


async def test_period_glance_biggest_change_reports_incomplete_fx(client, monkeypatch):
    """Biggest-change status reports missing pairs independently from current-period totals."""
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        raise FxRateNotFoundError()

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2))
        await session.commit()

    abc_account_id = UUID((await _create_account(client, headers, name="ABC Cash", currency="ABC")).json()["id"])
    food_id, food = _category(user_id, "Food", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            food,
            _transaction(user_id, abc_account_id, food_id, date(2026, 4, 29), -70_000, "ABC"),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-05-01", "to_date": "2026-05-07"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["income_expense_fx_status"] == {"state": "none", "missing_pairs": []}
    assert data["net_worth_change_fx_status"] == {"state": "none", "missing_pairs": []}
    assert data["biggest_change_fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
    }


async def test_period_glance_net_worth_change_includes_first_day_balance_activity(client):
    """Selected-period balance movement starts from the day before from_date."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    transfer_id, transfer = _category(user_id, "Balance Adjustment", CategoryKind.TRANSFER)

    async with TestSession() as session:
        await session.execute(
            update(AccountBalanceSnapshot)
            .where(AccountBalanceSnapshot.account_id == account_id)
            .values(dt=date(2026, 5, 31), balance=0),
        )
        session.add_all([
            transfer,
            _transaction(user_id, account_id, transfer_id, date(2026, 6, 1), 100_000),
            _snapshot(account_id, date(2026, 6, 1), 100_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-06-01", "to_date": "2026-06-30"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["income"] == 0
    assert data["expenses"] == 0
    assert data["net_worth_change"] == 100_000


async def test_insights_range_includes_api_created_first_day_transaction(client):
    """A first-day API transaction is aggregated after snapshot recomputation."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = (await _create_account(client, headers, name="June Cash")).json()["id"]
    category_id = (await _create_category_api(client, headers, name="June Salary", kind="income")).json()["id"]

    create_resp = await _create_transaction_api(
        client,
        headers,
        account_id,
        category_id,
        dt="2026-06-01",
        amount=100_000,
    )
    snapshots_resp = await client.get(f"/accounts/{account_id}/snapshots", headers=headers)
    period_glance_resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-06-01", "to_date": "2026-06-30"},
        headers=headers,
    )
    net_worth_resp = await client.get(
        "/insights/net-worth",
        params={"from_date": "2026-06-01", "to_date": "2026-06-30"},
        headers=headers,
    )

    assert create_resp.status_code == 201
    assert snapshots_resp.status_code == 200
    assert {"account_id": account_id, "dt": "2026-06-01", "balance": 100_000} in snapshots_resp.json()

    assert period_glance_resp.status_code == 200
    period_glance = period_glance_resp.json()
    assert period_glance["income"] == 100_000
    assert period_glance["expenses"] == 0
    assert period_glance["net_worth_change"] == 100_000

    assert net_worth_resp.status_code == 200
    net_worth = net_worth_resp.json()
    assert net_worth["groups"] == [["cash", "Cash", "asset"]]
    assert net_worth["baseline"] == [0]
    assert net_worth["points"][0] == ["2026-06-01", "2026-06-01", [100_000]]
    assert net_worth["points"][-1] == ["2026-06-30", "2026-06-30", [100_000]]


async def test_period_glance_net_worth_change_reports_incomplete_fx(client, monkeypatch):
    """Net-worth movement skips foreign accounts that cannot be converted."""
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        raise FxRateNotFoundError()

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2))
        await session.commit()

    cad_account_id = UUID((await _create_account(client, headers, name="CAD Cash")).json()["id"])
    abc_account_id = UUID((await _create_account(client, headers, name="ABC Cash", currency="ABC")).json()["id"])

    async with TestSession() as session:
        session.add_all([
            _snapshot(cad_account_id, date(2026, 4, 30), 100_000),
            _snapshot(cad_account_id, date(2026, 5, 1), 100_000),
            _snapshot(cad_account_id, date(2026, 5, 7), 150_000),
            _snapshot(abc_account_id, date(2026, 4, 30), 500_000),
            _snapshot(abc_account_id, date(2026, 5, 1), 500_000),
            _snapshot(abc_account_id, date(2026, 5, 7), 900_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-05-01", "to_date": "2026-05-07"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["income_expense_fx_status"] == {"state": "none", "missing_pairs": []}
    assert data["net_worth_change"] == 50_000
    assert data["net_worth_change_fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
    }


async def test_period_glance_handles_one_day_range_no_income_and_flat_category_change(client):
    """Single-day ranges use a single previous day and allow null savings rate."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Daily Cash")).json()["id"])
    utilities_id, utilities = _category(user_id, "Utilities", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            utilities,
            _transaction(user_id, account_id, utilities_id, date(2026, 6, 15), -5_000),
            _transaction(user_id, account_id, utilities_id, date(2026, 6, 14), -5_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-06-15", "to_date": "2026-06-15"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["income"] == 0
    assert data["expenses"] == 5_000
    assert data["top_category_share_pct"] == 100
    assert data["biggest_change_name"] == "Utilities"
    assert data["biggest_change_amount"] == 0
    assert data["biggest_change_pct"] == 0


async def test_period_glance_nets_expense_refunds(client):
    """Expense refunds reduce the expense total sent to the card."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    income_id, income = _category(user_id, "Side Income", CategoryKind.INCOME)
    medical_id, medical = _category(user_id, "Medical", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            income,
            medical,
            _transaction(user_id, account_id, income_id, date(2026, 9, 3), 10_000),
            _transaction(user_id, account_id, medical_id, date(2026, 9, 4), -30_000),
            _transaction(user_id, account_id, medical_id, date(2026, 9, 5), 5_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-09-01", "to_date": "2026-09-30"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["income"] == 10_000
    assert data["expenses"] == 25_000
    assert data["top_category_name"] == "Medical"
    assert data["top_category_share_pct"] == 100


async def test_period_glance_routes_flipped_categories_to_opposite_side(client):
    """Refunds and income losses are netted per category, then routed by sign."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)
    income_reversal_id, income_reversal = _category(user_id, "Income Reversal", CategoryKind.INCOME)
    groceries_id, groceries = _category(user_id, "Groceries", CategoryKind.EXPENSE)
    over_refund_id, over_refund = _category(user_id, "Over-refunded", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            salary,
            income_reversal,
            groceries,
            over_refund,
            _transaction(user_id, account_id, salary_id, date(2026, 10, 2), 200_000),
            _transaction(user_id, account_id, income_reversal_id, date(2026, 10, 3), -5_000),
            _transaction(user_id, account_id, groceries_id, date(2026, 10, 4), -100_000),
            _transaction(user_id, account_id, groceries_id, date(2026, 10, 5), 40_000),
            _transaction(user_id, account_id, over_refund_id, date(2026, 10, 6), 20_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-10-01", "to_date": "2026-10-31"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["income"] == 220_000
    assert data["expenses"] == 65_000
    assert data["top_category_name"] == "Groceries"
    assert data["top_category_share_pct"] == 92
    assert data["biggest_change_name"] == "Groceries"
    assert data["biggest_change_amount"] == 60_000
    assert "biggest_change_pct" not in data


async def test_period_glance_counts_net_negative_income_categories_as_expenses(client):
    """Income-kind categories become expenses when their period net is negative."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Investment Cash")).json()["id"])
    capital_gains_id, capital_gains = _category(user_id, "Capital Gains", CategoryKind.INCOME)
    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)

    async with TestSession() as session:
        session.add_all([
            capital_gains,
            salary,
            _transaction(user_id, account_id, capital_gains_id, date(2026, 12, 4), -80_000),
            _transaction(user_id, account_id, salary_id, date(2026, 12, 5), 300_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-12-01", "to_date": "2026-12-31"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["income"] == 300_000
    assert data["expenses"] == 80_000
    assert data["top_category_name"] == "Capital Gains"
    assert data["top_category_share_pct"] == 100
    assert data["biggest_change_name"] == "Capital Gains"
    assert data["biggest_change_amount"] == -80_000
    assert "biggest_change_pct" not in data


async def test_period_glance_excludes_converted_resolved_income_loss(client, monkeypatch):
    """A converted income-kind loss moving to zero is not a current-period change driver."""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {date(2026, 1, 4): Decimal("1.5")}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    await _seed_usd_currency()
    account_id = UUID((await _create_account(client, headers, name="Investment Cash", currency="USD")).json()["id"])
    capital_gains_id, capital_gains = _category(user_id, "Capital Gains", CategoryKind.INCOME)

    async with TestSession() as session:
        session.add_all([
            capital_gains,
            _transaction(user_id, account_id, capital_gains_id, date(2026, 1, 4), -466_541, "USD"),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-01-08", "to_date": "2026-01-14"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["income"] == 0
    assert data["expenses"] == 0
    assert data["biggest_change_fx_status"] == {"state": "complete", "missing_pairs": []}
    assert "biggest_change_name" not in data
    assert "biggest_change_amount" not in data
    assert "biggest_change_pct" not in data


async def test_period_glance_reports_vanished_over_refund_as_negative_change(client):
    """An expense-kind category moving from over-refund to zero is negative movement."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    shopping_id, shopping = _category(user_id, "Shopping", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            shopping,
            _transaction(user_id, account_id, shopping_id, date(2026, 2, 4), 25_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-02-08", "to_date": "2026-02-14"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["income"] == 0
    assert data["expenses"] == 0
    assert data["biggest_change_name"] == "Shopping"
    assert data["biggest_change_amount"] == -25_000
    assert data["biggest_change_pct"] == -100


async def test_period_glance_uses_stable_tie_breakers(client):
    """Equal top and movement values are ordered by category name for stable output."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    beta_id, beta = _category(user_id, "Beta", CategoryKind.EXPENSE)
    alpha_id, alpha = _category(user_id, "Alpha", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            beta,
            alpha,
            _transaction(user_id, account_id, beta_id, date(2026, 11, 4), -50_000),
            _transaction(user_id, account_id, alpha_id, date(2026, 11, 5), -50_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-11-01", "to_date": "2026-11-30"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["expenses"] == 100_000
    assert data["top_category_name"] == "Alpha"
    assert data["top_category_share_pct"] == 50
    assert data["biggest_change_name"] == "Alpha"
    assert data["biggest_change_amount"] == 50_000


async def test_period_glance_reports_previous_only_category_as_decrease(client):
    """Categories that disappear in the current period are still change candidates."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    travel_id, travel = _category(user_id, "Travel", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            travel,
            _transaction(user_id, account_id, travel_id, date(2026, 7, 5), -90_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-07-08", "to_date": "2026-07-14"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["income"] == 0
    assert data["expenses"] == 0
    assert "top_category_name" not in data
    assert "top_category_share_pct" not in data
    assert data["biggest_change_name"] == "Travel"
    assert data["biggest_change_amount"] == -90_000
    assert data["biggest_change_pct"] == -100


async def test_period_glance_returns_net_worth_change_without_period_transactions(client):
    """A quiet period can still report balance movement from snapshots."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Investment")).json()["id"])

    async with TestSession() as session:
        session.add_all([
            _snapshot(account_id, date(2026, 7, 15), 1_000_000),
            _snapshot(account_id, date(2026, 8, 20), 1_125_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-08-01", "to_date": "2026-08-31"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["income"] == 0
    assert data["expenses"] == 0
    assert data["net_worth_change"] == 125_000
    assert "top_category_name" not in data
    assert "biggest_change_name" not in data


async def test_period_glance_compares_previous_calendar_year(client):
    """Year-to-date presets can compare against the previous full calendar year."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    groceries_id, groceries = _category(user_id, "Groceries", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            groceries,
            _transaction(user_id, account_id, groceries_id, date(2026, 2, 15), -100_000),
            _transaction(user_id, account_id, groceries_id, date(2025, 2, 15), -40_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/period-glance",
        params={
            "from_date": "2026-01-01",
            "to_date": "2026-06-06",
            "comparison_period": "previous_year",
        },
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["biggest_change_name"] == "Groceries"
    assert data["biggest_change_amount"] == 60_000
    assert data["biggest_change_pct"] == 150


async def test_period_glance_rejects_invalid_date_range(client):
    """The endpoint rejects a start date after the end date."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-03-16", "to_date": "2026-03-10"},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_period_glance_requires_date_params(client):
    """Both date bounds are required for a cacheable card-specific query."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/insights/period-glance", headers=headers)

    assert resp.status_code == 422


async def test_period_glance_requires_auth(client):
    """Insights endpoints require an authenticated user."""
    resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-03-10", "to_date": "2026-03-16"},
    )

    assert resp.status_code == 401


async def test_period_glance_returns_empty_summary_without_accounts(client):
    """Users without base-currency accounts get a zeroed card payload."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(
        "/insights/period-glance",
        params={"from_date": "2026-03-10", "to_date": "2026-03-16"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["income"] == 0
    assert data["expenses"] == 0
    assert data["net_worth_change"] == 0
    assert "top_category_name" not in data
    assert "biggest_change_name" not in data
