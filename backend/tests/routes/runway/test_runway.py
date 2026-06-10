from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import update

from app.models.account import AccountBalanceSnapshot
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.support import _create_account, _create_user, _get_auth_header


def _owner_local_creation_day(account):
    """Return the account creation date in the owner timezone"""
    return datetime.fromisoformat(account["created_at"]).astimezone(ZoneInfo("America/Toronto")).date()


async def _seed_usd():
    """Insert the USD currency row for runway FX tests"""
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()


# --- PUT /me/runway-accounts ---


async def _signup_second_user(client):
    """Sign up a second user and return auth headers"""
    resp = await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "securepassword123",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    return _get_auth_header(resp)


async def test_put_runway_accounts_isolates_across_users(client):
    """Each user's runway selection is scoped to themselves — A's PUT doesn't surface in B's GET."""
    signup_a = await _create_user(client)
    headers_a = _get_auth_header(signup_a)
    headers_b = await _signup_second_user(client)

    account_a_id = (await _create_account(client, headers_a, name="A's account")).json()["id"]
    account_b_id = (await _create_account(client, headers_b, name="B's account")).json()["id"]

    await client.put("/me/runway-accounts", json={"account_ids": [account_a_id]}, headers=headers_a)
    await client.put("/me/runway-accounts", json={"account_ids": [account_b_id]}, headers=headers_b)

    resp_a = await client.get("/me/runway-accounts", headers=headers_a)
    resp_b = await client.get("/me/runway-accounts", headers=headers_b)

    assert resp_a.status_code == 200
    assert resp_b.status_code == 200
    assert resp_a.json() == [account_a_id]
    assert resp_b.json() == [account_b_id]


async def test_put_runway_accounts_rejects_other_users_account(client):
    """User A cannot pin user B's account into their runway — returns 422 and A's selection stays empty."""
    signup_a = await _create_user(client)
    headers_a = _get_auth_header(signup_a)
    headers_b = await _signup_second_user(client)

    account_b_id = (await _create_account(client, headers_b, name="B's account")).json()["id"]

    resp = await client.put(
        "/me/runway-accounts",
        json={"account_ids": [account_b_id]},
        headers=headers_a,
    )

    assert resp.status_code == 422

    get_resp = await client.get("/me/runway-accounts", headers=headers_a)
    assert get_resp.json() == []


# --- /me/runway-settings ---


async def test_get_runway_settings_requires_auth(client):
    """GET /me/runway-settings is authenticated."""
    resp = await client.get("/me/runway-settings")
    assert resp.status_code == 401


async def test_put_runway_settings_requires_auth(client):
    """PUT /me/runway-settings is authenticated."""
    resp = await client.put(
        "/me/runway-settings",
        json={
            "account_ids": [],
            "thresholds": {"risky_below_months": 1, "healthy_at_months": 3},
        },
    )
    assert resp.status_code == 401


async def test_get_runway_settings_returns_defaults(client):
    """New users start with default runway status thresholds."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/me/runway-settings", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == {
        "account_ids": [],
        "archived_account_ids": [],
        "thresholds": {"risky_below_months": 1, "healthy_at_months": 3},
    }


async def test_put_runway_settings_persists_accounts_and_thresholds(client):
    """PUT /me/runway-settings replaces selected accounts and threshold settings together."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = (await _create_account(client, headers)).json()["id"]

    payload = {
        "account_ids": [account_id],
        "thresholds": {"risky_below_months": 2, "healthy_at_months": 7.5},
    }
    put_resp = await client.put("/me/runway-settings", json=payload, headers=headers)
    get_resp = await client.get("/me/runway-settings", headers=headers)
    expected = {
        **payload,
        "archived_account_ids": [],
    }

    assert put_resp.status_code == 200
    assert put_resp.json() == expected
    assert get_resp.status_code == 200
    assert get_resp.json() == expected


async def test_put_runway_settings_isolates_thresholds_across_users(client):
    """Each user's runway thresholds are scoped to themselves."""
    signup_a = await _create_user(client)
    headers_a = _get_auth_header(signup_a)
    headers_b = await _signup_second_user(client)

    await client.put(
        "/me/runway-settings",
        json={
            "account_ids": [],
            "thresholds": {"risky_below_months": 2, "healthy_at_months": 6},
        },
        headers=headers_a,
    )

    resp_a = await client.get("/me/runway-settings", headers=headers_a)
    resp_b = await client.get("/me/runway-settings", headers=headers_b)

    assert resp_a.status_code == 200
    assert resp_b.status_code == 200
    assert resp_a.json()["thresholds"] == {"risky_below_months": 2, "healthy_at_months": 6}
    assert resp_b.json()["thresholds"] == {"risky_below_months": 1, "healthy_at_months": 3}


async def test_put_runway_settings_rejects_other_users_account(client):
    """Combined runway settings cannot include accounts the user cannot access."""
    signup_a = await _create_user(client)
    headers_a = _get_auth_header(signup_a)
    headers_b = await _signup_second_user(client)
    account_b_id = (await _create_account(client, headers_b, name="B's account")).json()["id"]

    resp = await client.put(
        "/me/runway-settings",
        json={
            "account_ids": [account_b_id],
            "thresholds": {"risky_below_months": 1, "healthy_at_months": 3},
        },
        headers=headers_a,
    )

    assert resp.status_code == 422


async def test_put_runway_settings_rejects_invalid_account_without_changing_thresholds(client):
    """Invalid account selections do not partially update runway thresholds."""
    signup_a = await _create_user(client)
    headers_a = _get_auth_header(signup_a)
    headers_b = await _signup_second_user(client)
    account_b_id = (await _create_account(client, headers_b, name="B's account")).json()["id"]

    await client.put(
        "/me/runway-settings",
        json={
            "account_ids": [],
            "thresholds": {"risky_below_months": 2, "healthy_at_months": 6},
        },
        headers=headers_a,
    )

    resp = await client.put(
        "/me/runway-settings",
        json={
            "account_ids": [account_b_id],
            "thresholds": {"risky_below_months": 4, "healthy_at_months": 8},
        },
        headers=headers_a,
    )
    get_resp = await client.get("/me/runway-settings", headers=headers_a)

    assert resp.status_code == 422
    assert get_resp.status_code == 200
    assert get_resp.json() == {
        "account_ids": [],
        "archived_account_ids": [],
        "thresholds": {"risky_below_months": 2, "healthy_at_months": 6},
    }


@pytest.mark.parametrize(
    "thresholds",
    [
        {"risky_below_months": -0.5, "healthy_at_months": 3},
        {"risky_below_months": 1, "healthy_at_months": 12.5},
        {"risky_below_months": 1.25, "healthy_at_months": 3},
        {"risky_below_months": 2, "healthy_at_months": 3},
    ],
)
async def test_put_runway_settings_rejects_invalid_thresholds(client, thresholds):
    """Thresholds must fit the allowed range, step, and separation rules."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.put(
        "/me/runway-settings",
        json={"account_ids": [], "thresholds": thresholds},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_get_runway_includes_threshold_settings(client):
    """GET /me/runway includes persisted thresholds so clients can classify the status pill."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await client.put(
        "/me/runway-settings",
        json={
            "account_ids": [],
            "thresholds": {"risky_below_months": 2, "healthy_at_months": 8},
        },
        headers=headers,
    )
    resp = await client.get("/me/runway", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["thresholds"] == {"risky_below_months": 2, "healthy_at_months": 8}


async def test_archived_runway_selection_excludes_current_balance_but_keeps_history(client, monkeypatch):
    """Archived selected accounts keep historical expenses while their current balance stays inactive"""
    from app.routes.users import date_helpers as user_routes

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 4, 15, 16, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    monkeypatch.setattr(user_routes, "datetime", FixedDateTime)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    visible_account = (await _create_account(client, headers, name="Visible Cash")).json()
    archived_account = (await _create_account(client, headers, name="Temporarily Archived")).json()
    visible_account_id = visible_account["id"]
    archived_account_id = archived_account["id"]

    async with TestSession() as session:
        category = Category(owner_id=user_id, name="Test Expense", kind=CategoryKind.EXPENSE)
        session.add(category)
        await session.flush()
        session.add_all([
            Transaction(
                created_by_user_id=user_id,
                account_id=UUID(visible_account_id),
                category_id=category.id,
                dt=date(2026, 3, 1),
                amount=-12_000,
                currency="CAD",
            ),
            Transaction(
                created_by_user_id=user_id,
                account_id=UUID(archived_account_id),
                category_id=category.id,
                dt=date(2026, 3, 2),
                amount=-24_000,
                currency="CAD",
            ),
            AccountBalanceSnapshot(account_id=UUID(visible_account_id), dt=date(2026, 4, 15), balance=120_000),
            AccountBalanceSnapshot(account_id=UUID(archived_account_id), dt=date(2026, 4, 15), balance=48_000),
        ])
        for account, balance in [(visible_account, 120_000), (archived_account, 48_000)]:
            await session.execute(
                update(AccountBalanceSnapshot)
                .where(
                    AccountBalanceSnapshot.account_id == UUID(account["id"]),
                    AccountBalanceSnapshot.dt == _owner_local_creation_day(account),
                )
                .values(balance=balance),
            )
        await session.commit()

    await client.put(
        "/me/runway-accounts",
        json={"account_ids": [visible_account_id, archived_account_id]},
        headers=headers,
    )
    await client.patch(f"/accounts/{archived_account_id}", json={"is_archived": True}, headers=headers)
    await client.put("/me/runway-accounts", json={"account_ids": [visible_account_id]}, headers=headers)

    archived_list_resp = await client.get("/me/runway-accounts", headers=headers)
    archived_settings_resp = await client.get("/me/runway-settings", headers=headers)
    archived_runway_resp = await client.get("/me/runway", headers=headers)

    assert archived_list_resp.status_code == 200
    assert archived_list_resp.json() == [visible_account_id]
    assert archived_settings_resp.status_code == 200
    assert archived_settings_resp.json()["account_ids"] == [visible_account_id]
    assert archived_settings_resp.json()["archived_account_ids"] == [archived_account_id]
    assert archived_runway_resp.status_code == 200
    archived_runway = archived_runway_resp.json()
    assert archived_runway["liquid_balance"] == 120_000
    assert archived_runway["account_balances"] == [{"account_id": visible_account_id, "balance": 120_000}]
    assert archived_runway["months_covered"] == 1
    assert archived_runway["avg_monthly_expense"] == 36_000
    assert archived_runway["months"] == pytest.approx(120_000 / 36_000)

    await client.patch(f"/accounts/{archived_account_id}", json={"is_archived": False}, headers=headers)

    restored_list_resp = await client.get("/me/runway-accounts", headers=headers)
    restored_settings_resp = await client.get("/me/runway-settings", headers=headers)
    restored_runway_resp = await client.get("/me/runway", headers=headers)

    assert restored_list_resp.status_code == 200
    assert set(restored_list_resp.json()) == {visible_account_id, archived_account_id}
    assert restored_settings_resp.status_code == 200
    assert set(restored_settings_resp.json()["account_ids"]) == {visible_account_id, archived_account_id}
    assert restored_settings_resp.json()["archived_account_ids"] == []
    restored_runway = restored_runway_resp.json()
    assert restored_runway["liquid_balance"] == 120_000
    assert sorted(restored_runway["account_balances"], key=lambda item: item["account_id"]) == sorted([
        {"account_id": visible_account_id, "balance": 120_000},
        {"account_id": archived_account_id, "balance": 0},
    ], key=lambda item: item["account_id"])
    assert restored_runway["months_covered"] == 1
    assert restored_runway["avg_monthly_expense"] == 36_000


async def test_get_runway_excludes_current_partial_month_from_average(client, monkeypatch):
    """Runway averages over completed months with expenses, not the current partial month."""
    from app.routes.users import date_helpers as user_routes

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 4, 15, 16, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    monkeypatch.setattr(user_routes, "datetime", FixedDateTime)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    account_id = (await _create_account(client, headers)).json()["id"]

    async with TestSession() as session:
        category = Category(owner_id=user_id, name="Test Expense", kind=CategoryKind.EXPENSE)
        session.add(category)
        await session.flush()
        session.add_all([
            Transaction(
                created_by_user_id=user_id,
                account_id=account_id,
                category_id=category.id,
                dt=date(2025, 3, 31),
                amount=-48_000,
                currency="CAD",
            ),
            Transaction(
                created_by_user_id=user_id,
                account_id=account_id,
                category_id=category.id,
                dt=date(2025, 4, 1),
                amount=-12_000,
                currency="CAD",
            ),
            Transaction(
                created_by_user_id=user_id,
                account_id=account_id,
                category_id=category.id,
                dt=date(2026, 3, 31),
                amount=-24_000,
                currency="CAD",
            ),
            Transaction(
                created_by_user_id=user_id,
                account_id=account_id,
                category_id=category.id,
                dt=date(2026, 4, 1),
                amount=-96_000,
                currency="CAD",
            ),
        ])
        session.add(AccountBalanceSnapshot(account_id=account_id, dt=date(2026, 4, 15), balance=180_000))
        await session.commit()

    thresholds = {"risky_below_months": 2, "healthy_at_months": 8}
    await client.put(
        "/me/runway-settings",
        json={"account_ids": [account_id], "thresholds": thresholds},
        headers=headers,
    )
    resp = await client.get("/me/runway", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["months_covered"] == 2
    assert data["avg_monthly_expense"] == 18_000
    assert data["reason"] is None
    assert data["thresholds"] == thresholds


async def test_get_runway_handles_refunds_and_excludes_income_losses_and_transfers(client, monkeypatch):
    """Runway uses net expense category totals and excludes income/transfers."""
    from app.routes.users import date_helpers as user_routes

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 4, 15, 16, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    monkeypatch.setattr(user_routes, "datetime", FixedDateTime)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    account_id = (await _create_account(client, headers)).json()["id"]

    async with TestSession() as session:
        expense_category = Category(owner_id=user_id, name="Groceries", kind=CategoryKind.EXPENSE)
        over_refunded_category = Category(owner_id=user_id, name="Shopping", kind=CategoryKind.EXPENSE)
        income_category = Category(owner_id=user_id, name="Capital Gains", kind=CategoryKind.INCOME)
        transfer_category = Category(owner_id=user_id, name="Transfer", kind=CategoryKind.TRANSFER)
        session.add_all([expense_category, over_refunded_category, income_category, transfer_category])
        await session.flush()
        session.add_all([
            Transaction(
                created_by_user_id=user_id,
                account_id=account_id,
                category_id=expense_category.id,
                dt=date(2026, 3, 1),
                amount=-12_000,
                currency="CAD",
            ),
            Transaction(
                created_by_user_id=user_id,
                account_id=account_id,
                category_id=income_category.id,
                dt=date(2026, 3, 2),
                amount=-6_000,
                currency="CAD",
            ),
            Transaction(
                created_by_user_id=user_id,
                account_id=account_id,
                category_id=expense_category.id,
                dt=date(2026, 3, 3),
                amount=4_000,
                currency="CAD",
            ),
            Transaction(
                created_by_user_id=user_id,
                account_id=account_id,
                category_id=income_category.id,
                dt=date(2026, 3, 3),
                amount=1_000,
                currency="CAD",
            ),
            Transaction(
                created_by_user_id=user_id,
                account_id=account_id,
                category_id=over_refunded_category.id,
                dt=date(2026, 3, 3),
                amount=-5_000,
                currency="CAD",
            ),
            Transaction(
                created_by_user_id=user_id,
                account_id=account_id,
                category_id=over_refunded_category.id,
                dt=date(2026, 3, 3),
                amount=7_000,
                currency="CAD",
            ),
            Transaction(
                created_by_user_id=user_id,
                account_id=account_id,
                category_id=transfer_category.id,
                dt=date(2026, 3, 4),
                amount=-99_000,
                currency="CAD",
            ),
            Transaction(
                created_by_user_id=user_id,
                account_id=account_id,
                category_id=expense_category.id,
                dt=date(2026, 4, 1),
                amount=-48_000,
                currency="CAD",
            ),
        ])
        session.add(AccountBalanceSnapshot(account_id=account_id, dt=date(2026, 4, 15), balance=180_000))
        await session.commit()

    await client.put("/me/runway-accounts", json={"account_ids": [account_id]}, headers=headers)
    resp = await client.get("/me/runway", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["months_covered"] == 1
    # Groceries net to $80.00. Capital Gains, transfers, over-refunded Shopping,
    # and the current partial month are excluded.
    assert data["avg_monthly_expense"] == 8_000
    assert data["reason"] is None


async def test_get_runway_converts_foreign_currency_balances_and_daily_expenses(client, monkeypatch):
    """Runway converts selected balances and historical expense rows to the user's base currency."""
    from app.routes.users import date_helpers as user_routes
    from app.services.fx import FrankfurterProvider

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 4, 15, 16, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    calls = []

    async def fake_get_rates(self, base, quote, start_date, end_date):
        calls.append((base, quote, start_date, end_date))
        return {
            date(2026, 3, 13): Decimal("1.25"),
            date(2026, 3, 14): Decimal("1.75"),
            date(2026, 4, 15): Decimal("1.5"),
        }

    monkeypatch.setattr(user_routes, "datetime", FixedDateTime)
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    await _seed_usd()
    cad_account = (await _create_account(client, headers, name="CAD Cash")).json()
    usd_account = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()
    cad_account_id = cad_account["id"]
    usd_account_id = usd_account["id"]

    async with TestSession() as session:
        category = Category(owner_id=user_id, name="Test Expense", kind=CategoryKind.EXPENSE)
        session.add(category)
        await session.flush()
        session.add_all([
            Transaction(
                created_by_user_id=user_id,
                account_id=UUID(cad_account_id),
                category_id=category.id,
                dt=date(2026, 3, 13),
                amount=-12_000,
                currency="CAD",
            ),
            Transaction(
                created_by_user_id=user_id,
                account_id=UUID(usd_account_id),
                category_id=category.id,
                dt=date(2026, 3, 13),
                amount=-10_000,
                currency="USD",
            ),
            Transaction(
                created_by_user_id=user_id,
                account_id=UUID(usd_account_id),
                category_id=category.id,
                dt=date(2026, 3, 14),
                amount=-10_000,
                currency="USD",
            ),
            AccountBalanceSnapshot(account_id=UUID(cad_account_id), dt=date(2026, 4, 15), balance=100_000),
            AccountBalanceSnapshot(account_id=UUID(usd_account_id), dt=date(2026, 4, 15), balance=20_000),
        ])
        for account, balance in [(cad_account, 100_000), (usd_account, 20_000)]:
            await session.execute(
                update(AccountBalanceSnapshot)
                .where(
                    AccountBalanceSnapshot.account_id == UUID(account["id"]),
                    AccountBalanceSnapshot.dt == _owner_local_creation_day(account),
                )
                .values(balance=balance),
            )
        await session.commit()

    await client.put("/me/runway-accounts", json={"account_ids": [cad_account_id, usd_account_id]}, headers=headers)
    resp = await client.get("/me/runway", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["liquid_balance"] == 130_000
    account_balances = {row["account_id"]: row["balance"] for row in data["account_balances"]}
    assert account_balances == {
        cad_account_id: 100_000,
        usd_account_id: 30_000,
    }
    assert data["months_covered"] == 1
    assert data["avg_monthly_expense"] == 42_000
    assert data["months"] == pytest.approx(130_000 / 42_000)
    assert data["fx_status"] == {"state": "complete", "missing_pairs": []}
    assert calls == [("USD", "CAD", date(2025, 4, 1), date(2026, 4, 15))]


async def test_get_runway_reports_incomplete_fx_with_missing_pairs(client, monkeypatch):
    """Runway skips unconverted foreign expense rows and reports the missing pair."""
    from app.routes.users import date_helpers as user_routes
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 4, 15, 16, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    async def fake_get_rates(self, base, quote, start_date, end_date):
        if base == "USD":
            return {date(2026, 3, 13): Decimal("1.5")}
        raise FxRateNotFoundError()

    monkeypatch.setattr(user_routes, "datetime", FixedDateTime)
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    async with TestSession() as session:
        session.add_all([
            Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
            Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2),
        ])
        await session.commit()

    cad_account = (await _create_account(client, headers, name="CAD Cash")).json()
    cad_account_id = cad_account["id"]
    usd_account_id = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()["id"]
    abc_account_id = (await _create_account(client, headers, name="ABC Cash", currency="ABC")).json()["id"]

    async with TestSession() as session:
        category = Category(owner_id=user_id, name="Test Expense", kind=CategoryKind.EXPENSE)
        session.add(category)
        await session.flush()
        session.add_all([
            Transaction(
                created_by_user_id=user_id,
                account_id=UUID(usd_account_id),
                category_id=category.id,
                dt=date(2026, 3, 13),
                amount=-20_000,
                currency="USD",
            ),
            Transaction(
                created_by_user_id=user_id,
                account_id=UUID(abc_account_id),
                category_id=category.id,
                dt=date(2026, 3, 13),
                amount=-90_000,
                currency="ABC",
            ),
            AccountBalanceSnapshot(account_id=UUID(cad_account_id), dt=date(2026, 4, 15), balance=120_000),
        ])
        await session.execute(
            update(AccountBalanceSnapshot)
            .where(
                AccountBalanceSnapshot.account_id == UUID(cad_account_id),
                AccountBalanceSnapshot.dt == _owner_local_creation_day(cad_account),
            )
            .values(balance=120_000),
        )
        await session.commit()

    await client.put("/me/runway-accounts", json={"account_ids": [cad_account_id]}, headers=headers)
    resp = await client.get("/me/runway", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["liquid_balance"] == 120_000
    assert data["avg_monthly_expense"] == 30_000
    assert data["fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [
            {
                "base": "ABC",
                "quote": "CAD",
            },
        ],
    }


async def test_get_runway_reports_unavailable_fx(client, monkeypatch):
    """Runway reports unavailable FX when every provider lookup fails."""
    from app.routes.users import date_helpers as user_routes
    from app.services.fx import FrankfurterProvider, FxProviderUnavailableError

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 4, 15, 16, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    async def fake_get_rates(self, base, quote, start_date, end_date):
        raise FxProviderUnavailableError()

    monkeypatch.setattr(user_routes, "datetime", FixedDateTime)
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    await _seed_usd()
    usd_account = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()
    usd_account_id = usd_account["id"]

    async with TestSession() as session:
        category = Category(owner_id=user_id, name="Test Expense", kind=CategoryKind.EXPENSE)
        session.add(category)
        await session.flush()
        session.add_all([
            Transaction(
                created_by_user_id=user_id,
                account_id=UUID(usd_account_id),
                category_id=category.id,
                dt=date(2026, 3, 13),
                amount=-20_000,
                currency="USD",
            ),
            AccountBalanceSnapshot(account_id=UUID(usd_account_id), dt=date(2026, 4, 15), balance=20_000),
        ])
        await session.execute(
            update(AccountBalanceSnapshot)
            .where(
                AccountBalanceSnapshot.account_id == UUID(usd_account_id),
                AccountBalanceSnapshot.dt == _owner_local_creation_day(usd_account),
            )
            .values(balance=20_000),
        )
        await session.commit()

    await client.put("/me/runway-accounts", json={"account_ids": [usd_account_id]}, headers=headers)
    resp = await client.get("/me/runway", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["reason"] == "insufficient_history"
    assert data["liquid_balance"] == 0
    assert data["account_balances"] == []
    assert data["avg_monthly_expense"] == 0
    assert data["fx_status"] == {
        "state": "unavailable",
        "missing_pairs": [
            {
                "base": "USD",
                "quote": "CAD",
            },
        ],
    }


async def test_get_runway_uses_viewer_timezone_for_window_start(client, monkeypatch):
    """A Toronto viewer still treats Jan 1 01:00 UTC as Dec 31 for runway history."""
    from app.routes.users import date_helpers as user_routes

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 1, 1, 1, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    monkeypatch.setattr(user_routes, "datetime", FixedDateTime)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    account_id = (await _create_account(client, headers)).json()["id"]

    async with TestSession() as session:
        category = Category(owner_id=user_id, name="Test Expense", kind=CategoryKind.EXPENSE)
        session.add(category)
        await session.flush()
        session.add(Transaction(
            created_by_user_id=user_id,
            account_id=account_id,
            category_id=category.id,
            dt=date(2025, 1, 1),
            amount=-12000,
            currency="CAD",
        ))
        session.add(AccountBalanceSnapshot(account_id=account_id, dt=date(2026, 12, 31), balance=120000))
        await session.commit()

    await client.put("/me/runway-accounts", json={"account_ids": [account_id]}, headers=headers)
    resp = await client.get("/me/runway", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["months_covered"] == 1
    assert data["avg_monthly_expense"] == 12000
    assert data["reason"] is None


async def test_get_runway_uses_calendar_months_for_window_start(client, monkeypatch):
    """A leap-day expense stays inside the trailing 12-month runway window."""
    from app.routes.users import date_helpers as user_routes

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2025, 2, 28, 17, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    monkeypatch.setattr(user_routes, "datetime", FixedDateTime)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    account_id = (await _create_account(client, headers)).json()["id"]

    async with TestSession() as session:
        category = Category(owner_id=user_id, name="Test Expense", kind=CategoryKind.EXPENSE)
        session.add(category)
        await session.flush()
        session.add(Transaction(
            created_by_user_id=user_id,
            account_id=account_id,
            category_id=category.id,
            dt=date(2024, 2, 29),
            amount=-12000,
            currency="CAD",
        ))
        session.add(AccountBalanceSnapshot(account_id=account_id, dt=date(2025, 2, 28), balance=120000))
        await session.commit()

    await client.put("/me/runway-accounts", json={"account_ids": [account_id]}, headers=headers)
    resp = await client.get("/me/runway", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["months_covered"] == 1
    assert data["avg_monthly_expense"] == 12000
    assert data["reason"] is None
