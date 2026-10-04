import importlib
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select, update

from app.models.account import AccountBalanceSnapshot
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.services.fx.converter import RATE_LOOKBACK
from tests.conftest import TestSession
from tests.routes.accounts._account_helpers import (
    _created_at_in_tz,
    _FixedClock,
    _signup_user,
)
from tests.routes.support import (
    _create_account,
    _create_user,
    _get_auth_header,
    _seed_currency,
)

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
    assert all(account["can_write"] is True for account in data)


async def test_list_accounts_keeps_write_capabilities_bound_to_the_caller_and_group(client):
    """Admin access in one group does not raise a read grant from another group to write."""
    await _seed_currency()
    alice = await _signup_user(
        client,
        email="capability-alice@example.com",
        first_name="Alice",
        tz="America/Toronto",
    )
    assert alice.status_code == 201, alice.json()
    alice_headers = _get_auth_header(alice)
    alice_id = alice.json()["user"]["id"]
    household_a = (
        await client.post(
            "/groups",
            json={"name": "Household A"},
            headers=alice_headers,
        )
    ).json()["id"]
    account_a = (
        await _create_account(
            client,
            alice_headers,
            name="Household A Chequing",
            group_id=household_a,
        )
    ).json()["id"]

    bob = await _signup_user(
        client,
        email="capability-bob@example.com",
        first_name="Bob",
        tz="America/Toronto",
    )
    assert bob.status_code == 201, bob.json()
    bob_headers = _get_auth_header(bob)
    household_b = (
        await client.post(
            "/groups",
            json={"name": "Household B"},
            headers=bob_headers,
        )
    ).json()["id"]
    await client.post(
        f"/groups/{household_b}/members",
        json={"user_id": alice_id},
        headers=bob_headers,
    )
    account_b = (
        await _create_account(
            client,
            bob_headers,
            name="Household B Chequing",
            group_id=household_b,
        )
    ).json()["id"]
    await client.post(
        f"/accounts/{account_b}/permissions",
        json={"user_id": alice_id, "level": "read"},
        headers=bob_headers,
    )
    charlie = await _signup_user(
        client,
        email="capability-charlie@example.com",
        first_name="Charlie",
        tz="America/Toronto",
    )
    assert charlie.status_code == 201, charlie.json()
    charlie_id = charlie.json()["user"]["id"]
    await client.post(
        f"/groups/{household_b}/members",
        json={"user_id": charlie_id},
        headers=bob_headers,
    )
    await client.post(
        f"/accounts/{account_b}/permissions",
        json={"user_id": charlie_id, "level": "write"},
        headers=bob_headers,
    )

    resp = await client.get("/accounts", headers=alice_headers)

    assert resp.status_code == 200
    rows = {row["id"]: row for row in resp.json()}
    listed_ids = [row["id"] for row in resp.json()]
    assert listed_ids.count(account_a) == 1
    assert listed_ids.count(account_b) == 1
    assert rows[account_a]["can_write"] is True
    assert rows[account_b]["can_write"] is False


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
        "id",
        "owner_id",
        "group_id",
        "account_kind",
        "account_type",
        "name",
        "tax_advantaged_category_id",
        "currency",
        "institution",
        "current_balance",
        "base_currency_current_balance",
        "current_balance_fx_status",
        "credit_limit",
        "can_write",
        "is_archived",
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


async def test_list_accounts_current_balance_uses_latest_snapshot(client, monkeypatch):
    """The balance uses the latest snapshot eligible on the viewer's local date."""
    from uuid import UUID

    from app.models.account import AccountBalanceSnapshot

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = UUID(create_resp.json()["id"])

    # The snapshots are future-dated relative to real time; advance the route clock so both
    # are eligible without depending on when the test suite runs.
    older_dt = date.today() + timedelta(days=30)
    newer_dt = date.today() + timedelta(days=60)
    account_routes = importlib.import_module("app.routes.accounts.router")
    monkeypatch.setattr(account_routes, "datetime", _FixedClock(datetime.now(UTC) + timedelta(days=90)))
    async with TestSession() as session:
        session.add(
            AccountBalanceSnapshot(
                account_id=account_id,
                dt=older_dt,
                balance=12345,
            )
        )
        session.add(
            AccountBalanceSnapshot(
                account_id=account_id,
                dt=newer_dt,
                balance=98765,
            )
        )
        await session.commit()

    resp = await client.get("/accounts", headers=headers)

    assert resp.status_code == 200
    assert resp.json()[0]["current_balance"] == 98765


async def test_list_accounts_converts_current_balance_to_user_base_currency(client, monkeypatch):
    """List rows expose a converted current balance for overview stats."""
    account_routes = importlib.import_module("app.routes.accounts.router")
    from app.services.fx import FrankfurterProvider

    calls = []

    async def fake_get_rates(self, base, quote, start_date, end_date):
        calls.append((base, quote, start_date, end_date))
        return {end_date: Decimal("1.5")}

    now = datetime.now(UTC)
    monkeypatch.setattr(account_routes, "datetime", _FixedClock(now))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    cad_account = (await _create_account(client, headers, name="CAD Cash")).json()
    usd_account = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()

    async with TestSession() as session:
        await session.execute(
            update(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == UUID(cad_account["id"])).values(balance=100_00),
        )
        await session.execute(
            update(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == UUID(usd_account["id"])).values(balance=200_00),
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
    today = now.astimezone(ZoneInfo("America/Toronto")).date()
    assert calls == [("USD", "CAD", today - RATE_LOOKBACK, today)]


async def test_list_accounts_reports_current_balance_fx_failure(client, monkeypatch):
    """Rows with unconverted foreign balances report the missing pair."""
    account_routes = importlib.import_module("app.routes.accounts.router")
    from app.services.fx import FrankfurterProvider, FxRateNotFoundError

    async def fake_get_rates(self, base, quote, start_date, end_date):
        raise FxRateNotFoundError()

    monkeypatch.setattr(account_routes, "datetime", _FixedClock(datetime.now(UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="ABC", name="Unsupported Test Currency", symbol="A", minor_unit_exponent=2))
        await session.commit()

    account = (await _create_account(client, headers, name="ABC Cash", currency="ABC")).json()

    async with TestSession() as session:
        await session.execute(
            update(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == UUID(account["id"])).values(balance=200_00),
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


async def test_create_group_account_anchors_on_group_owner_creation_day(client):
    """A group account's zero anchor is dated in the group owner's timezone, not the creator's."""
    await _seed_currency()

    # Kiritimati and Honolulu stay 24 hours apart without daylight saving time, so the
    # database creation timestamp falls on different local dates whenever this test runs
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
        tz="Pacific/Honolulu",
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

    resp = await _create_account(client, member_headers, group_id=group_id)

    assert resp.status_code == 201
    data = resp.json()
    account_id = UUID(data["id"])
    owner_local_dt = _created_at_in_tz(data, "Pacific/Kiritimati")
    acting_user_local_dt = _created_at_in_tz(data, "Pacific/Honolulu")
    assert owner_local_dt != acting_user_local_dt

    async with TestSession() as session:
        snapshot = await session.scalar(select(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == account_id))

    assert snapshot is not None
    assert snapshot.dt == owner_local_dt
    assert snapshot.balance == 0


async def test_create_account_refuses_a_starting_balance_from_an_out_of_date_page(client):
    """A balance typed into a page loaded before it got its own request is refused, not lost."""
    headers = _get_auth_header(await _create_user(client))

    resp = await _create_account(client, headers, starting_balance=123_45)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "This page is out of date, so reload it and add the account again"
    assert (await client.get("/accounts", headers=headers)).json() == []


@pytest.mark.parametrize("starting_balance", [None, 0])
async def test_create_account_writes_only_the_zero_anchor_for_a_blank_starting_balance(client, starting_balance):
    """The null or zero an out-of-date page sends for a blank field loses nothing, so it's accepted."""
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
