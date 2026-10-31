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
from tests.routes.support import _create_account, _create_user, _get_auth_header
from tests.routes.support.clock_helpers import PROFILE_TODAY, PROFILE_TOMORROW, freeze_profile_clock


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
        session.add_all(
            [
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
            ]
        )
        await session.commit()

    resp = await client.get(
        "/insights/merchants",
        params={"from_date": "2026-04-01", "to_date": "2026-04-30"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "distribution": [
            [str(alpha_id), "Alpha Market", 80_000, 40_000],
            [str(beta_id), "Beta Grocer", 50_000, 50_000],
        ],
        "ranking": [
            [str(alpha_id), "Alpha Market", 80_000, 2, 40_000],
            [str(beta_id), "Beta Grocer", 50_000, 1, 0],
        ],
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_merchants_category_filter_keeps_only_the_chosen_categories_in_both_periods(client):
    """Chosen categories narrow spend and the comparison period, and a non-expense id keeps nothing."""
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    food_id, food = _category(user_id, "Food", CategoryKind.EXPENSE)
    fun_id, fun = _category(user_id, "Fun", CategoryKind.EXPENSE)
    rent_id, rent = _category(user_id, "Rent", CategoryKind.EXPENSE)
    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)
    alpha_id, alpha = _merchant(user_id, "Alpha Market")
    beta_id, beta = _merchant(user_id, "Beta Cinema")
    gamma_id, gamma = _merchant(user_id, "Gamma Landlord")

    async with TestSession() as session:
        session.add_all(
            [
                food,
                fun,
                rent,
                salary,
                alpha,
                beta,
                gamma,
                _transaction(user_id, account_id, food_id, date(2026, 4, 10), -100_000, alpha_id),
                _transaction(user_id, account_id, fun_id, date(2026, 4, 11), -30_000, alpha_id),
                _transaction(user_id, account_id, fun_id, date(2026, 4, 12), -50_000, beta_id),
                _transaction(user_id, account_id, rent_id, date(2026, 4, 12), -200_000, gamma_id),
                _transaction(user_id, account_id, fun_id, date(2026, 3, 20), -20_000, alpha_id),
                _transaction(user_id, account_id, food_id, date(2026, 3, 20), -90_000, alpha_id),
            ]
        )
        await session.commit()
    params = {"from_date": "2026-04-01", "to_date": "2026-04-30"}

    one_category = await client.get(
        "/insights/merchants",
        params={**params, "category_id": [str(fun_id)]},
        headers=headers,
    )
    two_categories = await client.get(
        "/insights/merchants",
        params={**params, "category_id": [str(fun_id), str(food_id)]},
        headers=headers,
    )
    income_category = await client.get(
        "/insights/merchants",
        params={**params, "category_id": [str(salary_id)]},
        headers=headers,
    )
    unfiltered = await client.get("/insights/merchants", params=params, headers=headers)

    assert one_category.status_code == 200
    assert one_category.json()["distribution"] == [
        [str(beta_id), "Beta Cinema", 50_000, 50_000],
        [str(alpha_id), "Alpha Market", 30_000, 10_000],
    ]
    assert one_category.json()["ranking"] == [
        [str(beta_id), "Beta Cinema", 50_000, 1, 0],
        [str(alpha_id), "Alpha Market", 30_000, 1, 20_000],
    ]
    assert two_categories.status_code == 200
    assert [row[:3] for row in two_categories.json()["distribution"]] == [
        [str(alpha_id), "Alpha Market", 130_000],
        [str(beta_id), "Beta Cinema", 50_000],
    ]
    assert income_category.status_code == 200
    assert income_category.json()["distribution"] == []
    assert [row[:3] for row in unfiltered.json()["distribution"]] == [
        [str(gamma_id), "Gamma Landlord", 200_000],
        [str(alpha_id), "Alpha Market", 130_000],
        [str(beta_id), "Beta Cinema", 50_000],
    ]


async def test_merchants_converts_foreign_entries_by_transaction_date(client, monkeypatch):
    """Merchant rows use converted daily spend for ranking, distribution, and changes."""
    from app.services.fx import FrankfurterProvider

    async def fake_get_rates(self, base, quote, start_date, end_date):
        assert (base, quote) == ("USD", "CAD")
        if (start_date, end_date) == (date(2026, 4, 24), date(2026, 5, 2)):
            return {
                date(2026, 5, 1): Decimal("1.5"),
                date(2026, 5, 2): Decimal("2"),
            }
        if (start_date, end_date) == (date(2026, 4, 23), date(2026, 4, 30)):
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
        session.add_all(
            [
                expense,
                alpha,
                beta,
                _transaction(user_id, cad_account_id, expense_id, date(2026, 5, 1), -20_00, alpha_id),
                _transaction(user_id, usd_account_id, expense_id, date(2026, 5, 1), -100_00, alpha_id, "USD"),
                _transaction(user_id, usd_account_id, expense_id, date(2026, 5, 2), 20_00, alpha_id, "USD"),
                _transaction(user_id, cad_account_id, expense_id, date(2026, 5, 2), -50_00, beta_id),
                _transaction(user_id, usd_account_id, expense_id, date(2026, 4, 30), -40_00, alpha_id, "USD"),
            ]
        )
        await session.commit()

    resp = await client.get(
        "/insights/merchants",
        params={"from_date": "2026-05-01", "to_date": "2026-05-02"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "distribution": [
            [str(alpha_id), "Alpha Market", 13_000, 8_000],
            [str(beta_id), "Beta Grocer", 5_000, 5_000],
        ],
        "ranking": [
            [str(alpha_id), "Alpha Market", 13_000, 3, 5_000],
            [str(beta_id), "Beta Grocer", 5_000, 1, 0],
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
        session.add_all(
            [
                expense,
                alpha,
                beta,
                _transaction(user_id, usd_account_id, expense_id, date(2026, 5, 1), -100_00, alpha_id, "USD"),
                _transaction(user_id, abc_account_id, expense_id, date(2026, 5, 2), -90_00, beta_id, "ABC"),
            ]
        )
        await session.commit()

    resp = await client.get(
        "/insights/merchants",
        params={"from_date": "2026-05-01", "to_date": "2026-05-02"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "distribution": [
            [str(alpha_id), "Alpha Market", 15_000, 15_000],
        ],
        "ranking": [
            [str(alpha_id), "Alpha Market", 15_000, 1, 0],
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
        session.add_all(
            [
                expense,
                alpha,
                _transaction(user_id, account_id, expense_id, date(2026, 5, 10), -100_000, alpha_id),
                _transaction(user_id, account_id, expense_id, date(2026, 4, 10), -40_000, alpha_id),
                _transaction(user_id, account_id, expense_id, date(2026, 3, 31), -60_000, alpha_id),
            ]
        )
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
            [str(alpha_id), "Alpha Market", 100_000, 60_000],
        ],
        "ranking": [
            [str(alpha_id), "Alpha Market", 100_000, 1, 40_000],
        ],
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_merchants_leave_out_days_after_the_profile_date(client, freeze_now):
    """A purchase dated after the profile's today adds nothing, though it is already today in UTC."""
    freeze_profile_clock(freeze_now)
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    expense_id, expense = _category(user_id, "Shopping", CategoryKind.EXPENSE)
    alpha_id, alpha = _merchant(user_id, "Alpha Market")
    beta_id, beta = _merchant(user_id, "Beta Grocer")

    async with TestSession() as session:
        rows = [
            expense,
            alpha,
            beta,
            _transaction(user_id, account_id, expense_id, PROFILE_TODAY, -10_000, alpha_id),
            _transaction(user_id, account_id, expense_id, PROFILE_TOMORROW, -90_000, alpha_id),
            _transaction(user_id, account_id, expense_id, PROFILE_TOMORROW, -50_000, beta_id),
        ]
        session.add_all(rows)
        await session.commit()

    resp = await client.get(
        "/insights/merchants",
        params={"from_date": "2026-06-01", "to_date": "2026-06-30"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["distribution"] == [[str(alpha_id), "Alpha Market", 10_000, 10_000]]
    assert resp.json()["ranking"] == [[str(alpha_id), "Alpha Market", 10_000, 1, 0]]


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
