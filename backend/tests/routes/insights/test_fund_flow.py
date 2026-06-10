"""Route tests for the insights Fund Flow endpoint."""

from datetime import date
from decimal import Decimal
from uuid import UUID, uuid4

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.support import _create_account, _create_user, _get_auth_header


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


async def _seed_currency(currency_id: str, name: str, symbol: str, minor_unit_exponent: int = 2):
    """Insert a currency row for foreign-account tests."""
    async with TestSession() as session:
        session.add(Currency(id=currency_id, name=name, symbol=symbol, minor_unit_exponent=minor_unit_exponent))
        await session.commit()


async def test_fund_flow_returns_all_base_currency_entries(client):
    """The flow endpoint returns all readable base-currency entries and counts."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)

    visible_account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    archived_account_id = UUID((await _create_account(client, headers, name="Archived Cash", is_archived=True)).json()["id"])

    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)
    freelance_id, freelance = _category(user_id, "Freelance", CategoryKind.INCOME)
    bonus_id, bonus = _category(user_id, "Bonus", CategoryKind.INCOME)
    interest_id, interest = _category(user_id, "Interest", CategoryKind.INCOME)
    dividends_id, dividends = _category(user_id, "Dividends", CategoryKind.INCOME)
    gift_id, gift = _category(user_id, "Gift", CategoryKind.INCOME)
    housing_id, housing = _category(user_id, "Housing", CategoryKind.EXPENSE)
    groceries_id, groceries = _category(user_id, "Groceries", CategoryKind.EXPENSE)
    dining_id, dining = _category(user_id, "Dining", CategoryKind.EXPENSE)
    shopping_id, shopping = _category(user_id, "Shopping", CategoryKind.EXPENSE)
    transport_id, transport = _category(user_id, "Transport", CategoryKind.EXPENSE)
    travel_id, travel = _category(user_id, "Travel", CategoryKind.EXPENSE)
    medical_id, medical = _category(user_id, "Medical", CategoryKind.EXPENSE)
    transfer_id, transfer = _category(user_id, "Transfer", CategoryKind.TRANSFER)

    async with TestSession() as session:
        session.add_all([
            salary,
            freelance,
            bonus,
            interest,
            dividends,
            gift,
            housing,
            groceries,
            dining,
            shopping,
            transport,
            travel,
            medical,
            transfer,
            _transaction(user_id, visible_account_id, salary_id, date(2026, 3, 11), 500_000),
            _transaction(user_id, visible_account_id, freelance_id, date(2026, 3, 12), 100_000),
            _transaction(user_id, visible_account_id, bonus_id, date(2026, 3, 13), 80_000),
            _transaction(user_id, visible_account_id, interest_id, date(2026, 3, 14), 70_000),
            _transaction(user_id, visible_account_id, dividends_id, date(2026, 3, 15), 60_000),
            _transaction(user_id, visible_account_id, gift_id, date(2026, 3, 16), 50_000),
            _transaction(user_id, visible_account_id, housing_id, date(2026, 3, 11), -180_000),
            _transaction(user_id, visible_account_id, groceries_id, date(2026, 3, 12), -90_000),
            _transaction(user_id, visible_account_id, dining_id, date(2026, 3, 13), -80_000),
            _transaction(user_id, visible_account_id, shopping_id, date(2026, 3, 14), -70_000),
            _transaction(user_id, visible_account_id, transport_id, date(2026, 3, 15), -60_000),
            _transaction(user_id, visible_account_id, travel_id, date(2026, 3, 16), -50_000),
            _transaction(user_id, visible_account_id, medical_id, date(2026, 3, 16), -40_000),
            _transaction(user_id, visible_account_id, transfer_id, date(2026, 3, 15), 999_999),
            _transaction(user_id, visible_account_id, salary_id, date(2026, 2, 28), 300_000),
            _transaction(user_id, archived_account_id, salary_id, date(2026, 3, 11), 700_000),
            _transaction(user_id, archived_account_id, housing_id, date(2026, 3, 11), -700_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/fund-flow",
        params={"from_date": "2026-03-10", "to_date": "2026-03-16"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "income_sources": [
            ["Salary", 1_200_000],
            ["Freelance", 100_000],
            ["Bonus", 80_000],
            ["Interest", 70_000],
            ["Dividends", 60_000],
            ["Gift", 50_000],
        ],
        "expense_categories": [
            ["Housing", 880_000],
            ["Groceries", 90_000],
            ["Dining", 80_000],
            ["Shopping", 70_000],
            ["Transport", 60_000],
            ["Travel", 50_000],
            ["Medical", 40_000],
        ],
        "income_outflows": [],
        "expense_inflows": [],
        "income_source_count": 6,
        "expense_category_count": 7,
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_fund_flow_converts_foreign_entries_by_transaction_date(client, monkeypatch):
    """Foreign entries are converted daily before category totals are ranked."""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        assert (base, quote, start_date, end_date) == (
            "USD",
            "CAD",
            date(2026, 5, 1),
            date(2026, 5, 2),
        )
        return {
            date(2026, 5, 1): Decimal("1.5"),
            date(2026, 5, 2): Decimal("2"),
        }

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    await _seed_currency("USD", "US Dollar", "$")

    cad_account_id = UUID((await _create_account(client, headers, name="CAD Cash")).json()["id"])
    usd_account_id = UUID((await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"])
    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)
    rent_id, rent = _category(user_id, "Rent", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            salary,
            rent,
            _transaction(user_id, cad_account_id, salary_id, date(2026, 5, 1), 100_00),
            _transaction(user_id, cad_account_id, rent_id, date(2026, 5, 2), -50_00),
            _transaction(user_id, usd_account_id, salary_id, date(2026, 5, 1), 10_00, "USD"),
            _transaction(user_id, usd_account_id, salary_id, date(2026, 5, 2), 10_00, "USD"),
            _transaction(user_id, usd_account_id, rent_id, date(2026, 5, 2), -30_00, "USD"),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/fund-flow",
        params={"from_date": "2026-05-01", "to_date": "2026-05-02"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "income_sources": [["Salary", 13_500]],
        "expense_categories": [["Rent", 11_000]],
        "income_outflows": [],
        "expense_inflows": [],
        "income_source_count": 1,
        "expense_category_count": 1,
        "fx_status": {"state": "complete", "missing_pairs": []},
    }


async def test_fund_flow_reports_incomplete_fx_with_missing_pairs(client, monkeypatch):
    """Unconverted foreign rows are skipped and reported through the Fund Flow FX status."""
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        raise FxRateNotFoundError()

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    await _seed_currency("ABC", "Unsupported Test Currency", "A")

    cad_account_id = UUID((await _create_account(client, headers, name="CAD Cash")).json()["id"])
    abc_account_id = UUID((await _create_account(client, headers, name="ABC Cash", currency="ABC")).json()["id"])
    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)
    food_id, food = _category(user_id, "Food", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            salary,
            food,
            _transaction(user_id, cad_account_id, salary_id, date(2026, 6, 1), 100_000),
            _transaction(user_id, abc_account_id, food_id, date(2026, 6, 2), -70_000, "ABC"),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/fund-flow",
        params={"from_date": "2026-06-01", "to_date": "2026-06-30"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "income_sources": [["Salary", 100_000]],
        "expense_categories": [],
        "income_outflows": [],
        "expense_inflows": [],
        "income_source_count": 1,
        "expense_category_count": 0,
        "fx_status": {
            "state": "incomplete",
            "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
        },
    }


async def test_fund_flow_reclassifies_categories_by_net_sign(client):
    """Negative income categories become outflows; positive expense categories become inflows."""
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
            _transaction(user_id, account_id, salary_id, date(2026, 4, 2), 200_000),
            _transaction(user_id, account_id, income_reversal_id, date(2026, 4, 3), -5_000),
            _transaction(user_id, account_id, groceries_id, date(2026, 4, 4), -100_000),
            _transaction(user_id, account_id, groceries_id, date(2026, 4, 5), 40_000),
            _transaction(user_id, account_id, over_refund_id, date(2026, 4, 6), 20_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/fund-flow",
        params={"from_date": "2026-04-01", "to_date": "2026-04-30"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "income_sources": [["Salary", 200_000], ["Over-refunded", 20_000]],
        "expense_categories": [["Groceries", 60_000], ["Income Reversal", 5_000]],
        "income_outflows": [["Income Reversal", 5_000]],
        "expense_inflows": [["Over-refunded", 20_000]],
        "income_source_count": 2,
        "expense_category_count": 2,
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_fund_flow_shows_negative_capital_gains_as_expense(client):
    """Negative capital gains are outflows even though the category is income-kind."""
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
            _transaction(user_id, account_id, capital_gains_id, date(2026, 6, 4), -80_000),
            _transaction(user_id, account_id, salary_id, date(2026, 6, 5), 300_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/fund-flow",
        params={"from_date": "2026-06-01", "to_date": "2026-06-30"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "income_sources": [["Salary", 300_000]],
        "expense_categories": [["Capital Gains", 80_000]],
        "income_outflows": [["Capital Gains", 80_000]],
        "expense_inflows": [],
        "income_source_count": 1,
        "expense_category_count": 1,
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_fund_flow_returns_empty_payload_without_accounts(client):
    """Users without base-currency accounts get an empty card payload."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(
        "/insights/fund-flow",
        params={"from_date": "2026-03-10", "to_date": "2026-03-16"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "income_sources": [],
        "expense_categories": [],
        "income_outflows": [],
        "expense_inflows": [],
        "income_source_count": 0,
        "expense_category_count": 0,
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_fund_flow_handles_single_sided_period(client):
    """A period with only income still returns the available side without synthetic rows."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)

    async with TestSession() as session:
        session.add_all([
            salary,
            _transaction(user_id, account_id, salary_id, date(2026, 5, 1), 300_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/fund-flow",
        params={"from_date": "2026-05-01", "to_date": "2026-05-31"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "income_sources": [["Salary", 300_000]],
        "expense_categories": [],
        "income_outflows": [],
        "expense_inflows": [],
        "income_source_count": 1,
        "expense_category_count": 0,
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_fund_flow_orders_equal_amounts_by_name(client):
    """Equal category totals are stable and alphabetically ordered."""
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
            _transaction(user_id, account_id, beta_id, date(2026, 8, 4), -50_000),
            _transaction(user_id, account_id, alpha_id, date(2026, 8, 5), -50_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/fund-flow",
        params={"from_date": "2026-08-01", "to_date": "2026-08-31"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["expense_categories"] == [["Alpha", 50_000], ["Beta", 50_000]]


async def test_fund_flow_rejects_invalid_date_range(client):
    """The endpoint rejects a start date after the end date."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(
        "/insights/fund-flow",
        params={"from_date": "2026-03-16", "to_date": "2026-03-10"},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_fund_flow_requires_date_params(client):
    """Both date bounds are required for a cacheable card-specific query."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/insights/fund-flow", headers=headers)

    assert resp.status_code == 422


async def test_fund_flow_requires_auth(client):
    """Insights endpoints require an authenticated user."""
    resp = await client.get(
        "/insights/fund-flow",
        params={"from_date": "2026-03-10", "to_date": "2026-03-16"},
    )

    assert resp.status_code == 401
