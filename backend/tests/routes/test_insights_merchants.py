"""Route tests for the shared insights merchants endpoint."""

from datetime import date
from decimal import Decimal
from uuid import UUID, uuid4

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.conftest import _create_account, _create_user, _get_auth_header


def _category(user_id: UUID, name: str, kind: CategoryKind) -> tuple[UUID, Category]:
    """Build a personal category row for direct test setup."""
    category_id = uuid4()
    return category_id, Category(id=category_id, owner_id=user_id, name=name, kind=kind)


def _merchant(user_id: UUID, name: str) -> tuple[UUID, Merchant]:
    """Build a personal merchant row for direct test setup."""
    merchant_id = uuid4()
    return merchant_id, Merchant(id=merchant_id, owner_id=user_id, name=name)


def _transaction(
    user_id: UUID,
    account_id: UUID,
    category_id: UUID,
    dt: date,
    amount: int,
    merchant_id: UUID | None = None,
    currency: str = "CAD",
) -> Transaction:
    """Build a transaction row for direct test setup."""
    return Transaction(
        created_by_user_id=user_id,
        account_id=account_id,
        dt=dt,
        merchant_id=merchant_id,
        category_id=category_id,
        amount=amount,
        currency=currency,
    )


async def _seed_currency(currency_id: str, name: str, symbol: str):
    """Insert a currency row for foreign-account tests."""
    async with TestSession() as session:
        session.add(Currency(id=currency_id, name=name, symbol=symbol, minor_unit_exponent=2))
        await session.commit()


async def test_merchants_returns_distribution_and_ranking_payloads(client):
    """The shared endpoint returns both merchant card payloads from one request."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    expense_id, expense = _category(user_id, "Shopping", CategoryKind.EXPENSE)
    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)
    alpha_id, alpha = _merchant(user_id, "Alpha Market")
    beta_id, beta = _merchant(user_id, "Beta Grocer")
    income_merchant_id, income_merchant = _merchant(user_id, "Income Merchant")

    async with TestSession() as session:
        session.add_all([
            expense,
            salary,
            alpha,
            beta,
            income_merchant,
            _transaction(user_id, account_id, expense_id, date(2026, 4, 10), -100_000, alpha_id),
            _transaction(user_id, account_id, expense_id, date(2026, 4, 11), 20_000, alpha_id),
            _transaction(user_id, account_id, expense_id, date(2026, 4, 12), -50_000, beta_id),
            _transaction(user_id, account_id, salary_id, date(2026, 4, 12), -999_999, income_merchant_id),
            _transaction(user_id, account_id, expense_id, date(2026, 3, 20), -40_000, alpha_id),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/merchants",
        params={"from_date": "2026-04-01", "to_date": "2026-04-30"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "distribution": [
            [str(alpha_id), "Alpha Market", 80_000, 100, 40_000],
            [str(beta_id), "Beta Grocer", 50_000, None, 50_000],
        ],
        "ranking": [
            [str(alpha_id), "Alpha Market", 80_000, 2, 100],
            [str(beta_id), "Beta Grocer", 50_000, 1, None],
        ],
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_merchants_converts_foreign_entries_by_transaction_date(client, monkeypatch):
    """Merchant rows use converted daily spend for ranking, distribution, and changes."""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        assert (base, quote) == ("USD", "CAD")
        if (start_date, end_date) == (date(2026, 5, 1), date(2026, 5, 2)):
            return {
                date(2026, 5, 1): Decimal("1.5"),
                date(2026, 5, 2): Decimal("2"),
            }
        if (start_date, end_date) == (date(2026, 4, 30), date(2026, 4, 30)):
            return {date(2026, 4, 30): Decimal("1.25")}
        raise AssertionError(f"unexpected FX range: {start_date} to {end_date}")

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    await _seed_currency("USD", "US Dollar", "$")

    cad_account_id = UUID((await _create_account(client, headers, name="CAD Cash")).json()["id"])
    usd_account_id = UUID((await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"])
    expense_id, expense = _category(user_id, "Shopping", CategoryKind.EXPENSE)
    alpha_id, alpha = _merchant(user_id, "Alpha Market")
    beta_id, beta = _merchant(user_id, "Beta Grocer")

    async with TestSession() as session:
        session.add_all([
            expense,
            alpha,
            beta,
            _transaction(user_id, cad_account_id, expense_id, date(2026, 5, 1), -20_00, alpha_id),
            _transaction(user_id, usd_account_id, expense_id, date(2026, 5, 1), -100_00, alpha_id, "USD"),
            _transaction(user_id, usd_account_id, expense_id, date(2026, 5, 2), 20_00, alpha_id, "USD"),
            _transaction(user_id, cad_account_id, expense_id, date(2026, 5, 2), -50_00, beta_id),
            _transaction(user_id, usd_account_id, expense_id, date(2026, 4, 30), -40_00, alpha_id, "USD"),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/merchants",
        params={"from_date": "2026-05-01", "to_date": "2026-05-02"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "distribution": [
            [str(alpha_id), "Alpha Market", 13_000, 160, 8_000],
            [str(beta_id), "Beta Grocer", 5_000, None, 5_000],
        ],
        "ranking": [
            [str(alpha_id), "Alpha Market", 13_000, 3, 160],
            [str(beta_id), "Beta Grocer", 5_000, 1, None],
        ],
        "fx_status": {"state": "complete", "missing_pairs": []},
    }


async def test_merchants_reports_incomplete_fx_with_missing_pairs(client, monkeypatch):
    """Unconverted foreign merchant rows are skipped and reported."""
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
    expense_id, expense = _category(user_id, "Shopping", CategoryKind.EXPENSE)
    alpha_id, alpha = _merchant(user_id, "Alpha Market")
    beta_id, beta = _merchant(user_id, "Beta Grocer")

    async with TestSession() as session:
        session.add_all([
            expense,
            alpha,
            beta,
            _transaction(user_id, usd_account_id, expense_id, date(2026, 5, 1), -100_00, alpha_id, "USD"),
            _transaction(user_id, abc_account_id, expense_id, date(2026, 5, 2), -90_00, beta_id, "ABC"),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/merchants",
        params={"from_date": "2026-05-01", "to_date": "2026-05-02"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "distribution": [
            [str(alpha_id), "Alpha Market", 15_000, None, 15_000],
        ],
        "ranking": [
            [str(alpha_id), "Alpha Market", 15_000, 1, None],
        ],
        "fx_status": {
            "state": "incomplete",
            "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
        },
    }


async def test_merchants_compare_previous_calendar_month(client):
    """Merchant deltas can compare against the previous full calendar month."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    expense_id, expense = _category(user_id, "Shopping", CategoryKind.EXPENSE)
    alpha_id, alpha = _merchant(user_id, "Alpha Market")

    async with TestSession() as session:
        session.add_all([
            expense,
            alpha,
            _transaction(user_id, account_id, expense_id, date(2026, 5, 10), -100_000, alpha_id),
            _transaction(user_id, account_id, expense_id, date(2026, 4, 10), -40_000, alpha_id),
            _transaction(user_id, account_id, expense_id, date(2026, 3, 31), -60_000, alpha_id),
        ])
        await session.commit()

    resp = await client.get(
        "/insights/merchants",
        params={
            "from_date": "2026-05-01",
            "to_date": "2026-05-31",
            "comparison_period": "previous_month",
        },
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "distribution": [
            [str(alpha_id), "Alpha Market", 100_000, 150, 60_000],
        ],
        "ranking": [
            [str(alpha_id), "Alpha Market", 100_000, 1, 150],
        ],
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_merchants_rejects_invalid_date_range(client):
    """The shared endpoint rejects a start date after the end date."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(
        "/insights/merchants",
        params={"from_date": "2026-04-30", "to_date": "2026-04-01"},
        headers=headers,
    )

    assert resp.status_code == 422
