"""Route tests for insights savings-rate trend endpoint."""

from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.conftest import _create_account, _create_user, _get_auth_header


class _FixedClock:
    """Minimal datetime replacement for route-level now() calls."""

    def __init__(self, current: datetime):
        self.current = current

    def now(self, tz=None):
        return self.current.astimezone(tz) if tz else self.current


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


async def test_savings_rate_trend_returns_latest_available_monthly_totals(client, monkeypatch):
    """Savings-rate trend returns compact monthly income and expense totals."""
    from app.routes import insights as insights_routes

    monkeypatch.setattr(insights_routes, "datetime", _FixedClock(datetime(2026, 5, 19, 16, 0, tzinfo=UTC)))
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)

    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    hidden_account_id = UUID((await _create_account(client, headers, name="Hidden Cash", is_hidden=True)).json()["id"])
    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)
    groceries_id, groceries = _category(user_id, "Groceries", CategoryKind.EXPENSE)
    transfer_id, transfer = _category(user_id, "Transfer", CategoryKind.TRANSFER)

    async with TestSession() as session:
        session.add_all([
            salary,
            groceries,
            transfer,
            _transaction(user_id, account_id, salary_id, date(2026, 2, 4), 500_000),
            _transaction(user_id, account_id, groceries_id, date(2026, 2, 5), -200_000),
            _transaction(user_id, account_id, groceries_id, date(2026, 3, 8), -100_000),
            _transaction(user_id, account_id, transfer_id, date(2026, 3, 9), 999_999),
            _transaction(user_id, account_id, salary_id, date(2026, 5, 1), 600_000),
            _transaction(user_id, account_id, groceries_id, date(2026, 5, 2), -300_000),
            _transaction(user_id, account_id, salary_id, date(2026, 6, 1), 999_999),
            _transaction(user_id, account_id, groceries_id, date(2026, 6, 2), -999_999),
            _transaction(user_id, hidden_account_id, salary_id, date(2026, 5, 1), 700_000),
            _transaction(user_id, hidden_account_id, groceries_id, date(2026, 5, 2), -700_000),
        ])
        await session.commit()

    resp = await client.get("/insights/savings-rate-trend", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == {
        "points": [
            ["2026-02-01", 500_000, 200_000],
            ["2026-03-01", 0, 100_000],
            ["2026-04-01", 0, 0],
            ["2026-05-01", 600_000, 300_000],
        ],
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_savings_rate_trend_converts_foreign_entries_by_transaction_date(client, monkeypatch):
    """Foreign entries are converted daily before monthly category totals are classified."""
    from app.routes import insights as insights_routes
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

    monkeypatch.setattr(insights_routes, "datetime", _FixedClock(datetime(2026, 5, 19, 16, 0, tzinfo=UTC)))
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
            _transaction(user_id, cad_account_id, salary_id, date(2026, 5, 1), 100_00),
            _transaction(user_id, cad_account_id, groceries_id, date(2026, 5, 1), -20_00),
            _transaction(user_id, usd_account_id, salary_id, date(2026, 5, 1), 10_00, "USD"),
            _transaction(user_id, usd_account_id, salary_id, date(2026, 5, 2), 10_00, "USD"),
            _transaction(user_id, usd_account_id, groceries_id, date(2026, 5, 2), -30_00, "USD"),
        ])
        await session.commit()

    resp = await client.get("/insights/savings-rate-trend", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == {
        "points": [
            ["2026-05-01", 13_500, 8_000],
        ],
        "fx_status": {"state": "complete", "missing_pairs": []},
    }


async def test_savings_rate_trend_reports_incomplete_fx_with_missing_pairs(client, monkeypatch):
    """Unconverted foreign rows are skipped and reported through savings-rate FX status."""
    from app.routes import insights as insights_routes
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        if base == "USD":
            return {date(2026, 5, 1): Decimal("1.5")}
        raise FxRateNotFoundError()

    monkeypatch.setattr(insights_routes, "datetime", _FixedClock(datetime(2026, 5, 19, 16, 0, tzinfo=UTC)))
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

    resp = await client.get("/insights/savings-rate-trend", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == {
        "points": [
            ["2026-05-01", 15_000, 0],
        ],
        "fx_status": {
            "state": "incomplete",
            "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
        },
    }


async def test_savings_rate_trend_caps_at_latest_twelve_months(client, monkeypatch):
    """Longer histories are capped to the latest 12 calendar months."""
    from app.routes import insights as insights_routes

    monkeypatch.setattr(insights_routes, "datetime", _FixedClock(datetime(2026, 5, 19, 16, 0, tzinfo=UTC)))
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)

    async with TestSession() as session:
        session.add_all([
            salary,
            _transaction(user_id, account_id, salary_id, date(2025, 1, 15), 100_000),
            _transaction(user_id, account_id, salary_id, date(2026, 5, 1), 600_000),
        ])
        await session.commit()

    resp = await client.get("/insights/savings-rate-trend", headers=headers)

    assert resp.status_code == 200
    points = resp.json()["points"]
    assert len(points) == 12
    assert points[0] == ["2025-06-01", 0, 0]
    assert points[-1] == ["2026-05-01", 600_000, 0]
    assert resp.json()["fx_status"] == {"state": "none", "missing_pairs": []}


async def test_savings_rate_trend_includes_current_month_without_activity(client, monkeypatch):
    """Existing histories still emit the current in-progress month as a zero bucket."""
    from app.routes import insights as insights_routes

    monkeypatch.setattr(insights_routes, "datetime", _FixedClock(datetime(2026, 5, 19, 16, 0, tzinfo=UTC)))
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)
    groceries_id, groceries = _category(user_id, "Groceries", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            salary,
            groceries,
            _transaction(user_id, account_id, salary_id, date(2026, 3, 15), 450_000),
            _transaction(user_id, account_id, groceries_id, date(2026, 3, 16), -120_000),
        ])
        await session.commit()

    resp = await client.get("/insights/savings-rate-trend", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == {
        "points": [
            ["2026-03-01", 450_000, 120_000],
            ["2026-04-01", 0, 0],
            ["2026-05-01", 0, 0],
        ],
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_savings_rate_trend_uses_user_timezone_for_current_month(client, monkeypatch):
    """The current month is anchored in the user's timezone, not UTC."""
    from app.routes import insights as insights_routes

    monkeypatch.setattr(insights_routes, "datetime", _FixedClock(datetime(2026, 1, 1, 1, 0, tzinfo=UTC)))
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)
    groceries_id, groceries = _category(user_id, "Groceries", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            salary,
            groceries,
            _transaction(user_id, account_id, salary_id, date(2025, 11, 30), 400_000),
            _transaction(user_id, account_id, groceries_id, date(2025, 12, 31), -125_000),
            _transaction(user_id, account_id, salary_id, date(2026, 1, 1), 999_999),
        ])
        await session.commit()

    resp = await client.get("/insights/savings-rate-trend", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == {
        "points": [
            ["2025-11-01", 400_000, 0],
            ["2025-12-01", 0, 125_000],
        ],
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_savings_rate_trend_routes_flipped_categories_by_monthly_net(client, monkeypatch):
    """Savings trend nets each monthly category before assigning income or expense."""
    from app.routes import insights as insights_routes

    monkeypatch.setattr(insights_routes, "datetime", _FixedClock(datetime(2026, 5, 19, 16, 0, tzinfo=UTC)))
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)
    account_id = UUID((await _create_account(client, headers, name="Main Cash")).json()["id"])
    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)
    capital_gains_id, capital_gains = _category(user_id, "Capital Gains", CategoryKind.INCOME)
    groceries_id, groceries = _category(user_id, "Groceries", CategoryKind.EXPENSE)
    refunded_id, refunded = _category(user_id, "Refunded Expense", CategoryKind.EXPENSE)

    async with TestSession() as session:
        session.add_all([
            salary,
            capital_gains,
            groceries,
            refunded,
            _transaction(user_id, account_id, salary_id, date(2026, 5, 2), 300_000),
            _transaction(user_id, account_id, capital_gains_id, date(2026, 5, 3), -80_000),
            _transaction(user_id, account_id, groceries_id, date(2026, 5, 4), -100_000),
            _transaction(user_id, account_id, groceries_id, date(2026, 5, 5), 40_000),
            _transaction(user_id, account_id, refunded_id, date(2026, 5, 6), 20_000),
        ])
        await session.commit()

    resp = await client.get("/insights/savings-rate-trend", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == {
        "points": [
            ["2026-05-01", 320_000, 140_000],
        ],
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_savings_rate_trend_returns_empty_payload_without_visible_accounts(client, monkeypatch):
    """Users without visible accounts receive an empty payload."""
    from app.routes import insights as insights_routes

    monkeypatch.setattr(insights_routes, "datetime", _FixedClock(datetime(2026, 5, 19, 16, 0, tzinfo=UTC)))
    signup_resp = await _create_user(client)
    user_id = UUID(signup_resp.json()["user"]["id"])
    headers = _get_auth_header(signup_resp)

    hidden_account_id = UUID((await _create_account(client, headers, name="Hidden Cash", is_hidden=True)).json()["id"])
    salary_id, salary = _category(user_id, "Salary", CategoryKind.INCOME)

    async with TestSession() as session:
        session.add_all([
            salary,
            _transaction(user_id, hidden_account_id, salary_id, date(2026, 5, 1), 600_000),
        ])
        await session.commit()

    resp = await client.get("/insights/savings-rate-trend", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == {
        "points": [],
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_savings_rate_trend_returns_empty_payload_without_activity(client, monkeypatch):
    """Users without income or expense history receive an empty compact payload."""
    from app.routes import insights as insights_routes

    monkeypatch.setattr(insights_routes, "datetime", _FixedClock(datetime(2026, 5, 19, 16, 0, tzinfo=UTC)))
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _create_account(client, headers, name="Main Cash")

    resp = await client.get("/insights/savings-rate-trend", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == {
        "points": [],
        "fx_status": {"state": "none", "missing_pairs": []},
    }


async def test_savings_rate_trend_requires_auth(client):
    """Insights savings-rate trend requires an authenticated user."""
    resp = await client.get("/insights/savings-rate-trend")

    assert resp.status_code == 401
