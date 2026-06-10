import importlib
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy import delete, func, select, update

from app.models.account import Account, AccountBalanceSnapshot
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.accounts._account_helpers import (
    _created_at_in_tz,
    _FixedClock,
    _signup_user,
)
from tests.routes.support import _create_account, _create_user, _get_auth_header, _seed_currency

# --- GET /accounts ---


async def test_list_accounts_returns_empty_list(client):
    """User with no accounts gets an empty list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/accounts", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_accounts_returns_user_accounts(client):
    """User sees only their own accounts."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_account(client, headers, name="Account A")
    await _create_account(client, headers, name="Account B")

    resp = await client.get("/accounts", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    names = {a["name"] for a in data}
    assert names == {"Account A", "Account B"}


async def test_list_accounts_returns_overview_shape(client):
    """List endpoint returns the trimmed AccountsOverview shape, not the detail shape."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _create_account(client, headers)

    resp = await client.get("/accounts", headers=headers)

    assert resp.status_code == 200
    row = resp.json()[0]
    # Detail-only and tax-advantaged-category-level tax fields are excluded from the overview shape
    assert "created_at" not in row
    for field in (
        "tax_treatment",
        "lifetime_contribution_limit",
        "accrued_contributions",
        "accrued_lifetime_contribution_limit",
        "ytd_contributions",
        "ytd_withdrawals",
        "lifetime_contributions",
        "lifetime_withdrawals",
        "current_year_contribution_limit",
        "current_year_withdrawal_limit",
    ):
        assert field not in row
    # Overview fields are present
    for field in (
        "id", "owner_id", "group_id", "account_kind", "account_type", "name",
        "tax_advantaged_category_id", "currency", "institution", "current_balance",
        "base_currency_current_balance", "current_balance_fx_status", "credit_limit",
        "is_archived", "closed_at",
    ):
        assert field in row, f"missing overview field: {field}"


async def test_list_accounts_current_balance_starts_at_zero(client):
    """Newly created accounts have a zero anchor snapshot, so current_balance is 0 in the list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _create_account(client, headers)

    resp = await client.get("/accounts", headers=headers)

    assert resp.status_code == 200
    assert resp.json()[0]["current_balance"] == 0


async def test_list_accounts_current_balance_uses_latest_snapshot(client):
    """When multiple snapshots exist for an account, list returns the most recent balance."""
    from uuid import UUID

    from app.models.account import AccountBalanceSnapshot

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = UUID(create_resp.json()["id"])

    # Insert two snapshots after the zero anchor: the older of the two (12345)
    # and the newer (98765). Helper should return the most recent.
    async with TestSession() as session:
        session.add(AccountBalanceSnapshot(
            account_id=account_id,
            dt=date(2027, 1, 1),
            balance=12345,
        ))
        session.add(AccountBalanceSnapshot(
            account_id=account_id,
            dt=date(2027, 6, 1),
            balance=98765,
        ))
        await session.commit()

    resp = await client.get("/accounts", headers=headers)

    assert resp.status_code == 200
    assert resp.json()[0]["current_balance"] == 98765


async def test_list_accounts_converts_current_balance_to_user_base_currency(client, monkeypatch):
    """List rows expose a converted current balance for overview stats."""
    from datetime import UTC

    account_routes = importlib.import_module("app.routes.accounts.router")
    from app.services.fx import FrankfurterProvider

    calls = []

    async def fake_get_rate(self, base, quote, rate_date):
        calls.append((base, quote, rate_date))
        return Decimal("1.5")

    monkeypatch.setattr(account_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rate", fake_get_rate)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    cad_account = (await _create_account(client, headers, name="CAD Cash")).json()
    usd_account = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()

    async with TestSession() as session:
        await session.execute(
            update(AccountBalanceSnapshot)
            .where(AccountBalanceSnapshot.account_id == UUID(cad_account["id"]))
            .values(balance=100_00),
        )
        await session.execute(
            update(AccountBalanceSnapshot)
            .where(AccountBalanceSnapshot.account_id == UUID(usd_account["id"]))
            .values(balance=200_00),
        )
        await session.commit()

    resp = await client.get("/accounts", headers=headers)

    assert resp.status_code == 200
    rows = {row["name"]: row for row in resp.json()}
    assert rows["CAD Cash"]["current_balance"] == 100_00
    assert rows["CAD Cash"]["base_currency_current_balance"] == 100_00
    assert rows["CAD Cash"]["current_balance_fx_status"] == {"state": "none", "missing_pairs": []}
    assert rows["USD Cash"]["current_balance"] == 200_00
    assert rows["USD Cash"]["base_currency_current_balance"] == 300_00
    assert rows["USD Cash"]["current_balance_fx_status"] == {"state": "complete", "missing_pairs": []}
    assert calls == [("USD", "CAD", date(2026, 3, 20))]


async def test_list_accounts_reports_current_balance_fx_failure(client, monkeypatch):
    """Rows with unconverted foreign balances report the missing pair."""
    from datetime import UTC

    account_routes = importlib.import_module("app.routes.accounts.router")
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rate(self, base, quote, rate_date):
        raise FxRateNotFoundError()

    monkeypatch.setattr(account_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rate", fake_get_rate)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2))
        await session.commit()

    account = (await _create_account(client, headers, name="ABC Cash", currency="ABC")).json()

    async with TestSession() as session:
        await session.execute(
            update(AccountBalanceSnapshot)
            .where(AccountBalanceSnapshot.account_id == UUID(account["id"]))
            .values(balance=200_00),
        )
        await session.commit()

    resp = await client.get("/accounts", headers=headers)

    assert resp.status_code == 200
    row = resp.json()[0]
    assert row["current_balance"] == 200_00
    assert row["base_currency_current_balance"] == 0
    assert row["current_balance_fx_status"] == {
        "state": "incomplete",
        "missing_pairs": [{"base": "ABC", "quote": "CAD"}],
    }


async def test_get_account_returns_current_balance(client):
    """Single-account fetch also returns current_balance."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.get(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["current_balance"] == 0


async def test_create_account_returns_current_balance(client):
    """POST /accounts response includes current_balance from the just-inserted zero anchor."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers)

    assert resp.status_code == 201
    assert resp.json()["current_balance"] == 0


async def test_create_account_with_starting_balance_creates_adjustment(client):
    """Non-zero starting_balance creates a Balance Adjustment transaction."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = UUID(signup_resp.json()["user"]["id"])

    resp = await _create_account(client, headers, starting_balance=123_45)

    assert resp.status_code == 201
    data = resp.json()
    assert data["current_balance"] == 123_45
    account_id = UUID(data["id"])
    expected_dt = _created_at_in_tz(data, "America/Toronto")

    async with TestSession() as session:
        result = await session.execute(
            select(Transaction, Category)
            .join(Category, Transaction.category_id == Category.id)
            .where(Transaction.account_id == account_id)
            .order_by(Transaction.dt, Transaction.created_at, Transaction.id),
        )
        rows = result.all()
        snapshots_result = await session.execute(
            select(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == account_id),
        )
        snapshots = snapshots_result.scalars().all()

    assert len(rows) == 1
    txn, category = rows[0]
    assert len(snapshots) == 1
    snapshot = snapshots[0]
    assert txn.created_by_user_id == user_id
    assert txn.account_id == account_id
    assert txn.dt == expected_dt
    assert txn.merchant_id is None
    assert txn.fx_rate is None
    assert txn.amount == 123_45
    assert txn.currency == data["currency"]
    assert txn.notes == "Starting balance"
    assert category.name == "Balance Adjustment"
    assert category.kind == CategoryKind.TRANSFER
    assert category.is_system is True
    assert category.owner_id is None
    assert category.group_id is None
    assert snapshot.account_id == account_id
    assert snapshot.dt == expected_dt
    assert snapshot.balance == 123_45

    detail_resp = await client.get(f"/accounts/{account_id}", headers=headers)
    list_resp = await client.get("/accounts", headers=headers)

    assert detail_resp.status_code == 200
    assert detail_resp.json()["current_balance"] == 123_45
    assert list_resp.status_code == 200
    assert list_resp.json()[0]["current_balance"] == 123_45


async def test_create_group_account_starting_balance_uses_group_owner_creation_day(client):
    """Group-account starting balances are dated in the group owner's timezone."""
    await _seed_currency()
    owner_resp = await _signup_user(
        client,
        email="owner@example.com",
        first_name="Owner",
        tz="Pacific/Kiritimati",
    )
    member_resp = await _signup_user(
        client,
        email="member@example.com",
        first_name="Member",
        tz="America/Adak",
    )
    owner_headers = _get_auth_header(owner_resp)
    member_headers = _get_auth_header(member_resp)
    member_user_id = member_resp.json()["user"]["id"]

    group_resp = await client.post("/groups", json={"name": "Global Household"}, headers=owner_headers)
    assert group_resp.status_code == 201
    group_id = group_resp.json()["id"]
    add_member_resp = await client.post(f"/groups/{group_id}/members", json={"user_id": member_user_id}, headers=owner_headers)
    assert add_member_resp.status_code == 201
    promote_resp = await client.patch(f"/groups/{group_id}/members/{member_user_id}", json={"is_admin": True}, headers=owner_headers)
    assert promote_resp.status_code == 200

    resp = await _create_account(client, member_headers, group_id=group_id, starting_balance=50_00)

    assert resp.status_code == 201
    data = resp.json()
    account_id = UUID(data["id"])
    owner_local_dt = _created_at_in_tz(data, "Pacific/Kiritimati")
    acting_user_local_dt = _created_at_in_tz(data, "America/Adak")
    assert owner_local_dt != acting_user_local_dt

    async with TestSession() as session:
        txn = await session.scalar(select(Transaction).where(Transaction.account_id == account_id))
        snapshot = await session.scalar(select(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == account_id))

    assert txn is not None
    assert snapshot is not None
    assert txn.dt == owner_local_dt
    assert snapshot.dt == owner_local_dt
    assert txn.dt != acting_user_local_dt
    assert snapshot.balance == 50_00


async def test_create_account_starting_balance_rolls_back_if_balance_adjustment_category_missing(client):
    """Missing Balance Adjustment configuration does not leave partial account rows."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    async with TestSession() as session:
        await session.execute(delete(Category).where(Category.name == "Balance Adjustment", Category.is_system.is_(True)))
        await session.commit()

    resp = await _create_account(client, headers, starting_balance=100_00)

    assert resp.status_code == 500
    assert resp.json()["detail"] == "Balance adjustment category is not configured"

    async with TestSession() as session:
        account_count = await session.scalar(select(func.count(Account.id)))
        transaction_count = await session.scalar(select(func.count(Transaction.id)))
        snapshot_count = await session.scalar(select(func.count(AccountBalanceSnapshot.account_id)))

    assert account_count == 0
    assert transaction_count == 0
    assert snapshot_count == 0


async def test_create_revolving_account_with_signed_starting_balance(client):
    """Liability starting balances are accepted as signed debt values."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(
        client,
        headers,
        account_kind="revolving",
        account_type="credit_card",
        name="Visa",
        starting_balance=-42_42,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["current_balance"] == -42_42
    account_id = UUID(data["id"])
    expected_dt = _created_at_in_tz(data, "America/Toronto")

    async with TestSession() as session:
        txn = await session.scalar(select(Transaction).where(Transaction.account_id == account_id))
        snapshot = await session.scalar(select(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == account_id))

    assert txn is not None
    assert snapshot is not None
    assert txn.dt == expected_dt
    assert txn.amount == -42_42
    assert txn.notes == "Starting balance"
    assert snapshot.dt == expected_dt
    assert snapshot.balance == -42_42


@pytest.mark.parametrize("starting_balance", [None, 0])
async def test_create_account_without_nonzero_starting_balance_creates_no_adjustment(client, starting_balance):
    """Null and zero starting balances keep the zero anchor and skip a transaction row."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_account(client, headers, starting_balance=starting_balance)

    assert resp.status_code == 201
    data = resp.json()
    assert data["current_balance"] == 0
    account_id = UUID(data["id"])
    expected_dt = _created_at_in_tz(data, "America/Toronto")

    async with TestSession() as session:
        transaction_id = await session.scalar(select(Transaction.id).where(Transaction.account_id == account_id))
        snapshot = await session.scalar(
            select(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == account_id),
        )

    assert transaction_id is None
    assert snapshot is not None
    assert snapshot.dt == expected_dt
    assert snapshot.balance == 0


async def test_list_accounts_without_auth_returns_401(client):
    """GET /accounts without an Authorization header returns 401."""
    resp = await client.get("/accounts")
    assert resp.status_code == 401
