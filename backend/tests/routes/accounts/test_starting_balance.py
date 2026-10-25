import asyncio
import importlib
from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import delete, func, select, text

from app.models.account import AccountBalanceSnapshot
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.accounts._account_helpers import _create_second_user, _created_at_in_tz, _FixedClock, _signup_user
from tests.routes.accounts._balance_snapshot_helpers import (
    _create_category,
    _create_group,
    _create_transaction,
    _grant_account_permission,
)
from tests.routes.support import (
    _create_account,
    _create_user,
    _get_auth_header,
    _get_system_merchant_id,
    _record_starting_balance,
    _seed_currency,
)
from tests.routes.support.lock_helpers import _wait_until_waiting_on

# The zone every test signup stores, whose evening is already the next day in UTC
USER_TZ = "America/Toronto"

ALREADY_HAS_TRANSACTIONS = "This account already has transactions, so a starting balance can't be recorded"
NOT_OWN_ACCOUNT = "Starting balances can only be recorded on your own accounts"


async def _group_changed_at(client, headers, group_id: str) -> str | None:
    """Return when the group's data last changed, as a member's cache status reports it"""
    status = await client.get("/me/cache-status", headers=headers)
    assert status.status_code == 200, status.text
    return status.json()["groups"].get(group_id, {}).get("changed_at")


async def _account_transactions(account_id: str):
    """Return an account's transactions with their categories, oldest first"""
    async with TestSession() as session:
        return (
            await session.execute(
                select(Transaction, Category)
                .join(Category, Transaction.category_id == Category.id)
                .where(Transaction.account_id == UUID(account_id))
                .order_by(Transaction.dt, Transaction.created_at),
            )
        ).all()


async def test_record_starting_balance_writes_it_once_on_the_users_day(client, monkeypatch):
    """1,250.00 recorded late in the user's evening is one Balance Adjustment dated their day, not UTC's."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_data = (await _create_account(client, headers, name="Everyday")).json()
    today = _created_at_in_tz(account_data, USER_TZ)
    evening = datetime(today.year, today.month, today.day, 22, 0, tzinfo=ZoneInfo(USER_TZ))
    monkeypatch.setattr(importlib.import_module("app.routes.accounts.router"), "datetime", _FixedClock(evening))

    resp = await _record_starting_balance(client, headers, account_data["id"], 1_250_00)

    assert resp.status_code == 200
    assert resp.json()["current_balance"] == 1_250_00
    rows = await _account_transactions(account_data["id"])
    assert len(rows) == 1
    txn, category = rows[0]
    assert txn.created_by_user_id == UUID(signup_resp.json()["user"]["id"])
    assert txn.dt == today
    assert txn.amount == 1_250_00
    assert txn.currency == "CAD"
    assert txn.fx_rate is None
    assert txn.notes == "Starting balance"

    # The app writes this transaction rather than the user, so it is attributed to the shared Myself
    assert txn.merchant_id == UUID(await _get_system_merchant_id(client, headers))
    assert (category.name, category.kind, category.is_system) == ("Balance Adjustment", CategoryKind.TRANSFER, True)


@pytest.mark.parametrize(("account_kind", "account_type"), [("revolving", "credit_card"), ("amortizing", "loan")])
async def test_record_starting_balance_saves_a_liabilitys_amount_owed_negated(client, account_kind, account_type):
    """A liability owing 400.00 shows a balance of -400.00."""
    headers = _get_auth_header(await _create_user(client))
    account_id = (
        await _create_account(
            client,
            headers,
            account_kind=account_kind,
            account_type=account_type,
            name="Owed",
        )
    ).json()["id"]

    resp = await _record_starting_balance(client, headers, account_id, 400_00)

    assert resp.status_code == 200
    assert resp.json()["current_balance"] == -400_00
    assert [txn.amount for txn, _ in await _account_transactions(account_id)] == [-400_00]


async def test_record_starting_balance_refuses_an_account_with_a_transaction(client):
    """An account that already has a transaction keeps it as its only one."""
    headers = _get_auth_header(await _create_user(client))
    account_id = (await _create_account(client, headers)).json()["id"]
    category_id = (await _create_category(client, headers)).json()["id"]
    assert (await _create_transaction(client, headers, account_id, category_id)).status_code == 201

    resp = await _record_starting_balance(client, headers, account_id, 100_00)

    assert resp.status_code == 422
    assert resp.json()["detail"] == ALREADY_HAS_TRANSACTIONS
    assert [txn.amount for txn, _ in await _account_transactions(account_id)] == [-5000]


async def test_record_starting_balance_accepts_an_overdrawn_asset(client):
    """An asset account that starts 100.00 overdrawn shows -100.00."""
    headers = _get_auth_header(await _create_user(client))
    account_id = (await _create_account(client, headers)).json()["id"]

    resp = await _record_starting_balance(client, headers, account_id, -100_00)

    assert resp.status_code == 200
    assert resp.json()["current_balance"] == -100_00
    assert [txn.amount for txn, _ in await _account_transactions(account_id)] == [-100_00]


async def test_record_starting_balance_saves_a_liabilitys_credit_balance_positive(client):
    """A credit card holding 25.00 of credit, stated as owing -25.00, shows a balance of 25.00."""
    headers = _get_auth_header(await _create_user(client))
    account_id = (await _create_account(client, headers, account_kind="revolving", account_type="credit_card", name="Visa")).json()["id"]

    resp = await _record_starting_balance(client, headers, account_id, -25_00)

    assert resp.status_code == 200
    assert resp.json()["current_balance"] == 25_00
    assert [txn.amount for txn, _ in await _account_transactions(account_id)] == [25_00]


async def test_record_starting_balance_of_zero_writes_no_transaction_and_leaves_the_account_open(client):
    """A zero balance needs no adjustment, so the account stays empty and can still take a real one."""
    headers = _get_auth_header(await _create_user(client))
    account_id = (await _create_account(client, headers)).json()["id"]

    zero = await _record_starting_balance(client, headers, account_id, 0)
    real = await _record_starting_balance(client, headers, account_id, 40_00)

    assert zero.status_code == 200
    assert zero.json()["current_balance"] == 0
    assert real.status_code == 200
    assert [txn.amount for txn, _ in await _account_transactions(account_id)] == [40_00]


async def test_record_starting_balance_of_zero_on_another_users_account_returns_404(client):
    """A zero balance still checks the account is the user's before answering."""
    owner_headers = _get_auth_header(await _create_user(client))
    account_id = (await _create_account(client, owner_headers)).json()["id"]
    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await _record_starting_balance(client, other_headers, account_id, 0)

    assert resp.status_code == 404


async def test_record_starting_balance_writes_nothing_if_balance_adjustment_category_missing(client):
    """Missing Balance Adjustment configuration leaves the account at zero with no transaction."""
    headers = _get_auth_header(await _create_user(client))
    account_id = (await _create_account(client, headers)).json()["id"]
    async with TestSession() as session:
        await session.execute(delete(Category).where(Category.name == "Balance Adjustment", Category.is_system.is_(True)))
        await session.commit()

    resp = await _record_starting_balance(client, headers, account_id, 100_00)

    assert resp.status_code == 500
    assert resp.json()["detail"] == "Balance adjustment category is not configured"
    async with TestSession() as session:
        transaction_count = await session.scalar(select(func.count(Transaction.id)))
        snapshot = await session.scalar(
            select(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == UUID(account_id)),
        )
    assert transaction_count == 0
    assert snapshot is not None
    assert snapshot.balance == 0


async def test_record_starting_balance_on_another_users_account_returns_404(client):
    """Another user's account is not found and keeps no balance."""
    headers = _get_auth_header(await _create_user(client))
    account_id = (await _create_account(client, headers)).json()["id"]
    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await _record_starting_balance(client, other_headers, account_id, 100_00)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Account not found"
    assert await _account_transactions(account_id) == []


async def test_record_starting_balance_on_a_new_group_account_uses_the_group_owners_day(client, monkeypatch):
    """A group admin's 50.00 on the group account they just created is dated in the group owner's timezone, not theirs."""
    await _seed_currency()

    # Kiritimati and Honolulu stay 24 hours apart without daylight saving time, so the
    # database creation timestamp falls on different local dates whenever this test runs
    owner_headers = _get_auth_header(await _signup_user(client, email="owner@example.com", first_name="Owner", tz="Pacific/Kiritimati"))
    member_resp = await _signup_user(client, email="member@example.com", first_name="Member", tz="Pacific/Honolulu")
    member_headers = _get_auth_header(member_resp)
    member_id = member_resp.json()["user"]["id"]
    group_id = await _create_group(client, owner_headers)
    assert (await client.post(f"/groups/{group_id}/members", json={"user_id": member_id}, headers=owner_headers)).status_code == 201
    promoted = await client.patch(f"/groups/{group_id}/members/{member_id}", json={"is_admin": True}, headers=owner_headers)
    assert promoted.status_code == 200
    account_data = (await _create_account(client, member_headers, group_id=group_id)).json()
    owner_day = _created_at_in_tz(account_data, "Pacific/Kiritimati")
    assert owner_day != _created_at_in_tz(account_data, "Pacific/Honolulu")
    created_at = datetime.fromisoformat(account_data["created_at"])
    monkeypatch.setattr(importlib.import_module("app.routes.accounts.router"), "datetime", _FixedClock(created_at))
    before = await _group_changed_at(client, owner_headers, group_id)

    resp = await _record_starting_balance(client, member_headers, account_data["id"], 50_00)

    # The account is read back as of the admin's own day, which is still the day before the owner's
    # day the balance is dated, so the admin sees no balance yet
    assert resp.status_code == 200
    assert (resp.json()["id"], resp.json()["current_balance"]) == (account_data["id"], 0)
    rows = await _account_transactions(account_data["id"])
    assert [(txn.dt, txn.amount, txn.notes) for txn, _ in rows] == [(owner_day, 50_00, "Starting balance")]
    assert await _group_changed_at(client, owner_headers, group_id) != before


async def test_record_starting_balance_on_an_account_shared_through_a_grant_returns_403(client):
    """A member with an admin grant on an account of a group they don't administer is told it isn't theirs, though they run a group."""
    owner_headers = _get_auth_header(await _create_user(client))
    member_resp = await _create_second_user(client)
    member_headers = _get_auth_header(member_resp)
    member_id = member_resp.json()["user"]["id"]
    await _create_group(client, member_headers)
    group_id = await _create_group(client, owner_headers)
    added = await client.post(f"/groups/{group_id}/members", json={"user_id": member_id}, headers=owner_headers)
    assert added.status_code == 201
    account_id = (await _create_account(client, owner_headers, group_id=group_id)).json()["id"]
    granted = await _grant_account_permission(client, owner_headers, account_id, member_id, "admin")
    assert granted.status_code == 201

    # The grant lets the member edit the account, so only the ownership rule refuses the starting balance
    edited = await client.patch(f"/accounts/{account_id}", json={"name": "Shared"}, headers=member_headers)
    assert edited.status_code == 200
    resp = await _record_starting_balance(client, member_headers, account_id, 100_00)

    assert resp.status_code == 403
    assert resp.json()["detail"] == NOT_OWN_ACCOUNT
    assert await _account_transactions(account_id) == []


async def test_record_starting_balance_on_an_account_created_archived(client):
    """An account created archived still takes its starting balance, as transactions can't be added to it."""
    headers = _get_auth_header(await _create_user(client))
    account_id = (await _create_account(client, headers, is_archived=True)).json()["id"]

    resp = await _record_starting_balance(client, headers, account_id, 100_00)

    assert resp.status_code == 200
    assert (resp.json()["is_archived"], resp.json()["current_balance"]) == (True, 100_00)
    assert [txn.amount for txn, _ in await _account_transactions(account_id)] == [100_00]


async def test_record_starting_balance_waits_for_a_transaction_still_saving_and_refuses(client):
    """A starting balance sent while a transaction is being saved to the account is refused once it lands."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_data = (await _create_account(client, headers)).json()
    merchant_id = UUID(await _get_system_merchant_id(client, headers))

    async with TestSession() as saving:
        category_id = await saving.scalar(select(Category.id).where(Category.is_system.is_(True)).limit(1))
        saving.add(
            Transaction(
                created_by_user_id=UUID(signup_resp.json()["user"]["id"]),
                account_id=UUID(account_data["id"]),
                dt=_created_at_in_tz(account_data, USER_TZ),
                category_id=category_id,
                merchant_id=merchant_id,
                amount=-5000,
                currency="CAD",
            )
        )
        await saving.flush()
        saving_pid = await saving.scalar(text("SELECT pg_backend_pid()"))
        request = asyncio.create_task(_record_starting_balance(client, headers, account_data["id"], 100_00))
        await _wait_until_waiting_on(saving_pid, request)
        await saving.commit()

    resp = await request

    assert resp.status_code == 422
    assert resp.json()["detail"] == ALREADY_HAS_TRANSACTIONS
    assert [txn.amount for txn, _ in await _account_transactions(account_data["id"])] == [-5000]
