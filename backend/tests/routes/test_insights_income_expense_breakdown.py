"""Route tests for insights income-expense breakdown endpoint."""

from datetime import date
from decimal import Decimal
from uuid import UUID, uuid4

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


async def _seed_currency(currency_id: str, name: str, symbol: str, minor_unit_exponent: int = 2):
    """Insert a currency row for foreign-account tests."""
    async with TestSession() as session:
        session.add(Currency(id=currency_id, name=name, symbol=symbol, minor_unit_exponent=minor_unit_exponent))
        await session.commit()


async def test_income_expense_breakdown_returns_limited_period_payload(client):
    """The card gets capped pie rows and top movement rows for both modes."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)

    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    archived_account_id = UUID((await _create_account(client, headers, name="Archived Cash", is_archived=True)).json()["id"])

    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)
    freelance_id, freelance = _category(user_id, "Freelance", CategoryKind.INCOME)
    bonus_id, bonus = _category(user_id, "Bonus", CategoryKind.INCOME)
    housing_id, housing = _category(user_id, "Housing", CategoryKind.EXPENSE)
    groceries_id, groceries = _category(user_id, "Groceries", CategoryKind.EXPENSE)
    dining_id, dining = _category(user_id, "Dining", CategoryKind.EXPENSE)
    shopping_id, shopping = _category(user_id, "Shopping", CategoryKind.EXPENSE)
    transport_id, transport = _category(user_id, "Transport", CategoryKind.EXPENSE)
    travel_id, travel = _category(user_id, "Travel", CategoryKind.EXPENSE)
    medical_id, medical = _category(user_id, "Medical", CategoryKind.EXPENSE)
    coffee_id, coffee = _category(user_id, "Coffee", CategoryKind.EXPENSE)
    pets_id, pets = _category(user_id, "Pets", CategoryKind.EXPENSE)
    old_utilities_id, old_utilities = _category(user_id, "Old Utilities", CategoryKind.EXPENSE)
    transfer_id, transfer = _category(user_id, "Transfer", CategoryKind.TRANSFER)

    async with TestSession() as session:
        session.add_all([
            salary,
            freelance,
            bonus,
            housing,
            groceries,
            dining,
            shopping,
            transport,
            travel,
            medical,
            coffee,
            pets,
            old_utilities,
            transfer,
            _transaction(user_id, account_id, salary_id, date(2026, 3, 11), 500_000),
            _transaction(user_id, account_id, freelance_id, date(2026, 3, 12), 100_000),
            _transaction(user_id, account_id, bonus_id, date(2026, 3, 13), 80_000),
            _transaction(user_id, account_id, housing_id, date(2026, 3, 11), -180_000),
            _transaction(user_id, account_id, groceries_id, date(2026, 3, 12), -90_000),
            _transaction(user_id, account_id, dining_id, date(2026, 3, 13), -80_000),
            _transaction(user_id, account_id, shopping_id, date(2026, 3, 14), -70_000),
            _transaction(user_id, account_id, transport_id, date(2026, 3, 15), -60_000),
            _transaction(user_id, account_id, travel_id, date(2026, 3, 16), -50_000),
            _transaction(user_id, account_id, medical_id, date(2026, 3, 16), -40_000),
            _transaction(user_id, account_id, coffee_id, date(2026, 3, 16), -30_000),
            _transaction(user_id, account_id, pets_id, date(2026, 3, 16), -20_000),
            _transaction(user_id, account_id, transfer_id, date(2026, 3, 15), 999_999),
            _transaction(user_id, account_id, salary_id, date(2026, 3, 4), 450_000),
            _transaction(user_id, account_id, freelance_id, date(2026, 3, 5), 120_000),
            _transaction(user_id, account_id, housing_id, date(2026, 3, 4), -200_000),
            _transaction(user_id, account_id, groceries_id, date(2026, 3, 5), -30_000),
            _transaction(user_id, account_id, dining_id, date(2026, 3, 6), -120_000),
            _transaction(user_id, account_id, transport_id, date(2026, 3, 7), -60_000),
            _transaction(user_id, account_id, travel_id, date(2026, 3, 8), -50_000),
            _transaction(user_id, account_id, medical_id, date(2026, 3, 9), -40_000),
            _transaction(user_id, account_id, old_utilities_id, date(2026, 3, 9), -55_000),
            _transaction(user_id, account_id, salary_id, date(2026, 2, 28), 300_000),
            _transaction(user_id, archived_account_id, salary_id, date(2026, 3, 11), 700_000),
            _transaction(user_id, archived_account_id, housing_id, date(2026, 3, 11), -700_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/income-expense-breakdown",
        params={"from_date": "2026-03-10", "to_date": "2026-03-16"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "expense": [
            [str(housing_id), "Housing", "expense", 180_000],
            [str(groceries_id), "Groceries", "expense", 90_000],
            [str(dining_id), "Dining", "expense", 80_000],
            [str(shopping_id), "Shopping", "expense", 70_000],
            [str(transport_id), "Transport", "expense", 60_000],
            [str(travel_id), "Travel", "expense", 50_000],
            [str(medical_id), "Medical", "expense", 40_000],
            [str(coffee_id), "Coffee", "expense", 30_000],
            [str(pets_id), "Pets", "expense", 20_000],
        ],
        "income": [
            [str(salary_id), "Salary", "income", 500_000],
            [str(freelance_id), "Freelance", "income", 100_000],
            [str(bonus_id), "Bonus", "income", 80_000],
        ],
        "expense_total": 620_000,
        "income_total": 680_000,
        "expense_increases": [
            [str(shopping_id), "Shopping", 70_000, 0, None, 1],
            [str(groceries_id), "Groceries", 90_000, 30_000, 200, 1],
            [str(coffee_id), "Coffee", 30_000, 0, None, 1],
        ],
        "expense_decreases": [
            [str(old_utilities_id), "Old Utilities", 0, 55_000, -100, 0],
            [str(dining_id), "Dining", 80_000, 120_000, -33, 1],
            [str(housing_id), "Housing", 180_000, 200_000, -10, 1],
        ],
        "income_increases": [
            [str(bonus_id), "Bonus", 80_000, 0, None, 1],
            [str(salary_id), "Salary", 500_000, 450_000, 11, 1],
        ],
        "income_decreases": [
            [str(freelance_id), "Freelance", 100_000, 120_000, -17, 1],
        ],
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_income_expense_breakdown_converts_foreign_entries_by_transaction_date(client, monkeypatch):
    """Breakdown slices and movement rows use converted daily totals."""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        assert base == "USD"
        assert quote == "CAD"
        if (start_date, end_date) == (date(2026, 5, 1), date(2026, 5, 2)):
            return {
                date(2026, 5, 1): Decimal("1.5"),
                date(2026, 5, 2): Decimal("2"),
            }
        if (start_date, end_date) == (date(2026, 4, 30), date(2026, 4, 30)):
            return {
                date(2026, 4, 30): Decimal("1.2"),
            }
        raise AssertionError(f"Unexpected FX range: {start_date} to {end_date}")

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    await _seed_currency("USD", "US Dollar", "$")

    cad_account_id = UUID((await _create_account(client, headers, name="CAD Cash")).json()["id"])
    usd_account_id = UUID((await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"])
    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)
    food_id, food = _category(user_id, "Food", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            salary,
            food,
            _transaction(user_id, cad_account_id, salary_id, date(2026, 5, 1), 100_00),
            _transaction(user_id, usd_account_id, salary_id, date(2026, 5, 1), 10_00, "USD"),
            _transaction(user_id, usd_account_id, salary_id, date(2026, 5, 2), 10_00, "USD"),
            _transaction(user_id, cad_account_id, food_id, date(2026, 5, 2), -50_00),
            _transaction(user_id, usd_account_id, food_id, date(2026, 5, 2), -30_00, "USD"),
            _transaction(user_id, usd_account_id, salary_id, date(2026, 4, 30), 50_00, "USD"),
            _transaction(user_id, usd_account_id, food_id, date(2026, 4, 30), -20_00, "USD"),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/income-expense-breakdown",
        params={"from_date": "2026-05-01", "to_date": "2026-05-02"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "expense": [[str(food_id), "Food", "expense", 11_000]],
        "income": [[str(salary_id), "Salary", "income", 13_500]],
        "expense_total": 11_000,
        "income_total": 13_500,
        "expense_increases": [[str(food_id), "Food", 11_000, 2_400, 358, 2]],
        "expense_decreases": [],
        "income_increases": [[str(salary_id), "Salary", 13_500, 6_000, 125, 3]],
        "income_decreases": [],
        "fx_status": {"state": "complete", "missing_pairs": []},
    }


async def test_income_expense_breakdown_reports_incomplete_fx_with_missing_pairs(client, monkeypatch):
    """Unconverted foreign rows are skipped and reported in the card FX status."""
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
        "/insights/income-expense-breakdown",
        params={"from_date": "2026-06-01", "to_date": "2026-06-30"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "expense": [],
        "income": [[str(salary_id), "Salary", "income", 100_000]],
        "expense_total": 0,
        "income_total": 100_000,
        "expense_increases": [],
        "expense_decreases": [],
        "income_increases": [[str(salary_id), "Salary", 100_000, 0, None, 1]],
        "income_decreases": [],
        "fx_status": {
            "state": "incomplete",
            "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
        },
    }


async def test_income_expense_breakdown_counts_category_crossovers_by_sign(client):
    """Income losses become expense rows; over-refunded expenses become income rows."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)
    capital_gains_id, capital_gains = _category(user_id, "Capital Gains", CategoryKind.INCOME)
    groceries_id, groceries = _category(user_id, "Groceries", CategoryKind.EXPENSE)
    over_refund_id, over_refund = _category(user_id, "Over-refunded", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            salary,
            capital_gains,
            groceries,
            over_refund,
            _transaction(user_id, account_id, salary_id, date(2026, 4, 2), 360_000),
            _transaction(user_id, account_id, salary_id, date(2026, 4, 3), -60_000),
            _transaction(user_id, account_id, capital_gains_id, date(2026, 4, 3), 20_000),
            _transaction(user_id, account_id, capital_gains_id, date(2026, 4, 4), -100_000),
            _transaction(user_id, account_id, groceries_id, date(2026, 4, 4), -100_000),
            _transaction(user_id, account_id, groceries_id, date(2026, 4, 5), 40_000),
            _transaction(user_id, account_id, over_refund_id, date(2026, 4, 6), -30_000),
            _transaction(user_id, account_id, over_refund_id, date(2026, 4, 7), 50_000),
            _transaction(user_id, account_id, salary_id, date(2026, 3, 5), 300_000),
            _transaction(user_id, account_id, capital_gains_id, date(2026, 3, 6), 20_000),
            _transaction(user_id, account_id, over_refund_id, date(2026, 3, 7), -30_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/income-expense-breakdown",
        params={"from_date": "2026-04-01", "to_date": "2026-04-30"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["income"] == [
        [str(salary_id), "Salary", "income", 300_000],
        [str(over_refund_id), "Over-refunded", "expense", 20_000],
    ]
    assert data["expense"] == [
        [str(capital_gains_id), "Capital Gains", "income", 80_000],
        [str(groceries_id), "Groceries", "expense", 60_000],
    ]
    assert data["expense_total"] == 120_000
    assert data["income_total"] == 240_000
    assert data["income_decreases"] == [[str(capital_gains_id), "Capital Gains", 0, 20_000, -100, 2]]
    assert data["expense_increases"] == [[str(groceries_id), "Groceries", 60_000, 0, None, 2]]
    assert data["expense_decreases"] == [[str(over_refund_id), "Over-refunded", 0, 30_000, -100, 2]]


async def test_income_expense_breakdown_does_not_emit_other_for_exact_limit(client):
    """Exactly seven positive categories fit without an Other bucket."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])

    category_rows = [
        _category(user_id, f"Category {index}", CategoryKind.EXPENSE)
        for index in range(1, 8)
    ]

    async with TestSession() as session:
        session.add_all([
            *(category for _category_id, category in category_rows),
            *(
                _transaction(user_id, account_id, category_id, date(2026, 7, index), -(10_000 * index))
                for index, (category_id, _category) in enumerate(category_rows, start=1)
            ),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/income-expense-breakdown",
        params={"from_date": "2026-07-01", "to_date": "2026-07-31"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["expense"] == [
        [str(category_id), f"Category {index}", "expense", 10_000 * index]
        for index, (category_id, _category) in reversed(list(enumerate(category_rows, start=1)))
    ]
    assert all(entry[1] != "Other" for entry in data["expense"])


async def test_income_expense_breakdown_one_day_range_compares_previous_one_day(client):
    """A one-day range compares against only the immediately preceding day."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Daily Cash")).json()["id"])
    dining_id, dining = _category(user_id, "Dining", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            dining,
            _transaction(user_id, account_id, dining_id, date(2026, 8, 15), -70_000),
            _transaction(user_id, account_id, dining_id, date(2026, 8, 14), -20_000),
            _transaction(user_id, account_id, dining_id, date(2026, 8, 13), -900_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/income-expense-breakdown",
        params={"from_date": "2026-08-15", "to_date": "2026-08-15"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["expense"] == [[str(dining_id), "Dining", "expense", 70_000]]
    assert data["expense_increases"] == [[str(dining_id), "Dining", 70_000, 20_000, 250, 1]]
    assert data["expense_decreases"] == []


async def test_income_expense_breakdown_omits_zero_net_current_categories(client):
    """Zero-net categories with no prior movement do not leak into breakdown or trends."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    reimbursed_id, reimbursed = _category(user_id, "Reimbursed Expense", CategoryKind.EXPENSE)
    offset_income_id, offset_income = _category(user_id, "Offset Income", CategoryKind.INCOME)

    async with TestSession() as session:
        session.add_all([
            reimbursed,
            offset_income,
            _transaction(user_id, account_id, reimbursed_id, date(2026, 9, 10), -50_000),
            _transaction(user_id, account_id, reimbursed_id, date(2026, 9, 11), 50_000),
            _transaction(user_id, account_id, offset_income_id, date(2026, 9, 12), 80_000),
            _transaction(user_id, account_id, offset_income_id, date(2026, 9, 13), -80_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/income-expense-breakdown",
        params={"from_date": "2026-09-01", "to_date": "2026-09-30"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "expense": [],
        "income": [],
        "expense_total": 0,
        "income_total": 0,
        "expense_increases": [],
        "expense_decreases": [],
        "income_increases": [],
        "income_decreases": [],
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_income_expense_breakdown_returns_empty_payload_without_accounts(client):
    """Users without base-currency accounts get an empty card payload."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(
        "/insights/income-expense-breakdown",
        params={"from_date": "2026-03-10", "to_date": "2026-03-16"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "expense": [],
        "income": [],
        "expense_total": 0,
        "income_total": 0,
        "expense_increases": [],
        "expense_decreases": [],
        "income_increases": [],
        "income_decreases": [],
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_income_expense_breakdown_uses_stable_tie_breakers(client):
    """Equal category totals and movement amounts are ordered by category name."""
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
            _transaction(user_id, account_id, beta_id, date(2026, 5, 4), -50_000),
            _transaction(user_id, account_id, alpha_id, date(2026, 5, 5), -50_000),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/income-expense-breakdown",
        params={"from_date": "2026-05-01", "to_date": "2026-05-07"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["expense"] == [
        [str(alpha_id), "Alpha", "expense", 50_000],
        [str(beta_id), "Beta", "expense", 50_000],
    ]
    assert data["expense_increases"] == [
        [str(alpha_id), "Alpha", 50_000, 0, None, 1],
        [str(beta_id), "Beta", 50_000, 0, None, 1],
    ]


async def test_income_expense_breakdown_rejects_invalid_date_range(client):
    """The endpoint rejects a start date after the end date."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(
        "/insights/income-expense-breakdown",
        params={"from_date": "2026-03-16", "to_date": "2026-03-10"},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_income_expense_breakdown_requires_date_params(client):
    """Both date bounds are required for a cacheable card-specific query."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/insights/income-expense-breakdown", headers=headers)

    assert resp.status_code == 422


async def test_income_expense_breakdown_requires_auth(client):
    """Insights endpoints require an authenticated user."""
    resp = await client.get(
        "/insights/income-expense-breakdown",
        params={"from_date": "2026-03-10", "to_date": "2026-03-16"},
    )

    assert resp.status_code == 401
