"""Route tests for insights cash-flow endpoint."""

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


async def _seed_currency(currency_id: str, name: str, symbol: str):
    """Insert a currency row for foreign-account tests."""
    async with TestSession() as session:
        session.add(Currency(id=currency_id, name=name, symbol=symbol, minor_unit_exponent=2))
        await session.commit()


async def _get_category_id(client, headers, name: str) -> UUID:
    """Return a category ID by name from the authenticated category list."""
    response = await client.get("/categories", headers=headers)
    assert response.status_code == 200
    for category in response.json():
        if category["name"] == name:
            return UUID(category["id"])
    raise AssertionError(f"category not found: {name}")


async def test_cash_flow_returns_daily_buckets_and_excludes_non_cash_flow_rows(client):
    """Daily buckets include transfers by sign and exclude hidden and adjustment rows."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)

    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    hidden_account_id = UUID((await _create_account(client, headers, name="Hidden Cash", is_hidden=True)).json()["id"])
    salary_id, salary = _category(user_id, "Payroll", CategoryKind.INCOME)
    groceries_id, groceries = _category(user_id, "Groceries Test", CategoryKind.EXPENSE)
    transfer_id, transfer = _category(user_id, "Transfer Test", CategoryKind.TRANSFER)
    balance_adjustment_id = await _get_category_id(client, headers, "Balance Adjustment")

    async with TestSession() as session:
        session.add_all([
            salary,
            groceries,
            transfer,
            _transaction(user_id, account_id, salary_id, date(2026, 5, 1), 100_000),
            _transaction(user_id, account_id, groceries_id, date(2026, 5, 2), -25_000),
            _transaction(user_id, account_id, transfer_id, date(2026, 5, 3), 10_000),
            _transaction(user_id, account_id, transfer_id, date(2026, 5, 4), -7_000),
            _transaction(user_id, account_id, balance_adjustment_id, date(2026, 5, 5), 999_999),
            _transaction(user_id, account_id, salary_id, date(2026, 4, 30), 50_000),
            _transaction(user_id, hidden_account_id, salary_id, date(2026, 5, 1), 800_000),
        ])
        await session.commit()

    response = await client.get(
        "/insights/cash-flow",
        params={"from_date": "2026-05-01", "to_date": "2026-05-07"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json() == {
        "points": [
            ["2026-05-01", "2026-05-01", 100_000, 0],
            ["2026-05-02", "2026-05-02", 0, 25_000],
            ["2026-05-03", "2026-05-03", 10_000, 0],
            ["2026-05-04", "2026-05-04", 0, 7_000],
            ["2026-05-05", "2026-05-05", 0, 0],
            ["2026-05-06", "2026-05-06", 0, 0],
            ["2026-05-07", "2026-05-07", 0, 0],
        ],
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_cash_flow_converts_foreign_entries_by_transaction_date(client, monkeypatch):
    """Foreign entries are converted daily before cash-flow buckets are built."""
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
    groceries_id, groceries = _category(user_id, "Groceries", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            salary,
            groceries,
            _transaction(user_id, cad_account_id, salary_id, date(2026, 5, 1), 20_00),
            _transaction(user_id, cad_account_id, groceries_id, date(2026, 5, 1), -10_00),
            _transaction(user_id, usd_account_id, salary_id, date(2026, 5, 1), 100_00, "USD"),
            _transaction(user_id, usd_account_id, groceries_id, date(2026, 5, 2), -50_00, "USD"),
        ])
        await session.commit()

    response = await client.get(
        "/insights/cash-flow",
        params={"from_date": "2026-05-01", "to_date": "2026-05-02"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json() == {
        "points": [
            ["2026-05-01", "2026-05-01", 17_000, 1_000],
            ["2026-05-02", "2026-05-02", 0, 10_000],
        ],
        "fx_status": {"state": "complete", "missing_pairs": []},
    }


async def test_cash_flow_reports_incomplete_fx_with_missing_pairs(client, monkeypatch):
    """Unconverted foreign rows are skipped and reported through cash-flow FX status."""
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        if base == "USD":
            return {date(2026, 5, 1): Decimal("1.5")}
        raise FxRateNotFoundError()

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    await _seed_currency("USD", "US Dollar", "$")
    await _seed_currency("ABC", "Unsupported Test Currency", "A")

    usd_account_id = UUID((await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"])
    abc_account_id = UUID((await _create_account(client, headers, name="ABC Cash", currency="ABC")).json()["id"])
    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)
    groceries_id, groceries = _category(user_id, "Groceries", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            salary,
            groceries,
            _transaction(user_id, usd_account_id, salary_id, date(2026, 5, 1), 100_00, "USD"),
            _transaction(user_id, abc_account_id, groceries_id, date(2026, 5, 2), -90_00, "ABC"),
        ])
        await session.commit()

    response = await client.get(
        "/insights/cash-flow",
        params={"from_date": "2026-05-01", "to_date": "2026-05-02"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json() == {
        "points": [
            ["2026-05-01", "2026-05-01", 15_000, 0],
            ["2026-05-02", "2026-05-02", 0, 0],
        ],
        "fx_status": {
            "state": "incomplete",
            "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
        },
    }


async def test_cash_flow_uses_weekly_buckets_for_mid_length_ranges(client):
    """Ranges over 31 and up to 90 days are grouped into partial weekly buckets."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    salary_id, salary = _category(user_id, "Weekly Pay", CategoryKind.INCOME)
    groceries_id, groceries = _category(user_id, "Weekly Groceries", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            salary,
            groceries,
            _transaction(user_id, account_id, salary_id, date(2026, 3, 10), 100_000),
            _transaction(user_id, account_id, groceries_id, date(2026, 3, 16), -30_000),
            _transaction(user_id, account_id, salary_id, date(2026, 4, 20), 40_000),
        ])
        await session.commit()

    response = await client.get(
        "/insights/cash-flow",
        params={"from_date": "2026-03-10", "to_date": "2026-04-20"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["points"] == [
        ["2026-03-10", "2026-03-15", 100_000, 0],
        ["2026-03-16", "2026-03-22", 0, 30_000],
        ["2026-03-23", "2026-03-29", 0, 0],
        ["2026-03-30", "2026-04-05", 0, 0],
        ["2026-04-06", "2026-04-12", 0, 0],
        ["2026-04-13", "2026-04-19", 0, 0],
        ["2026-04-20", "2026-04-20", 40_000, 0],
    ]
    assert response.json()["fx_status"] == {"state": "none", "missing_pairs": []}


async def test_cash_flow_uses_monthly_buckets_for_long_ranges(client):
    """Ranges over 90 days are grouped into partial monthly buckets."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    salary_id, salary = _category(user_id, "Monthly Pay", CategoryKind.INCOME)
    rent_id, rent = _category(user_id, "Monthly Rent", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            salary,
            rent,
            _transaction(user_id, account_id, salary_id, date(2026, 1, 15), 100_000),
            _transaction(user_id, account_id, rent_id, date(2026, 2, 1), -40_000),
            _transaction(user_id, account_id, salary_id, date(2026, 5, 20), 80_000),
        ])
        await session.commit()

    response = await client.get(
        "/insights/cash-flow",
        params={"from_date": "2026-01-15", "to_date": "2026-05-20"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["points"] == [
        ["2026-01-15", "2026-01-31", 100_000, 0],
        ["2026-02-01", "2026-02-28", 0, 40_000],
        ["2026-03-01", "2026-03-31", 0, 0],
        ["2026-04-01", "2026-04-30", 0, 0],
        ["2026-05-01", "2026-05-20", 80_000, 0],
    ]
    assert response.json()["fx_status"] == {"state": "none", "missing_pairs": []}


async def test_cash_flow_returns_empty_points_without_accounts(client):
    """Users without accounts get an empty cash-flow payload."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    response = await client.get(
        "/insights/cash-flow",
        params={"from_date": "2026-05-01", "to_date": "2026-05-07"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json() == {
        "points": [],
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_cash_flow_returns_empty_points_without_activity(client):
    """Users with accounts but no matching cash-flow rows get an empty payload."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _create_account(client, headers, name="Main Cash")

    response = await client.get(
        "/insights/cash-flow",
        params={"from_date": "2026-05-01", "to_date": "2026-05-07"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json() == {
        "points": [],
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_cash_flow_rejects_invalid_date_range(client):
    """The endpoint rejects a start date after the end date."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    response = await client.get(
        "/insights/cash-flow",
        params={"from_date": "2026-05-07", "to_date": "2026-05-01"},
        headers=headers,
    )

    assert response.status_code == 422


async def test_cash_flow_requires_date_params(client):
    """Both date bounds are required for a cacheable card-specific query."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    response = await client.get("/insights/cash-flow", headers=headers)

    assert response.status_code == 422


async def test_cash_flow_requires_auth(client):
    """Insights endpoints require an authenticated user."""
    response = await client.get(
        "/insights/cash-flow",
        params={"from_date": "2026-05-01", "to_date": "2026-05-07"},
    )

    assert response.status_code == 401
