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
from tests.routes.accounts._account_helpers import _create_second_user, _created_at_in_tz, _FixedClock
from tests.routes.accounts._balance_snapshot_helpers import _create_category, _create_group, _create_transaction
from tests.routes.support import (
    _create_account,
    _create_user,
    _get_auth_header,
    _get_system_merchant_id,
    _record_starting_balance,
)

# The zone every test signup stores, whose evening is already the next day in UTC
USER_TZ = "America/Toronto"

ALREADY_HAS_TRANSACTIONS = "This account already has transactions, so a starting balance can't be recorded"


async def _account_transactions(account_id: str):
    """Return an account's transactions with their categories, oldest first"""
    async with TestSession() as session:
        return (await session.execute(
            select(Transaction, Category)
            .join(Category, Transaction.category_id == Category.id)
            .where(Transaction.account_id == UUID(account_id))
            .order_by(Transaction.dt, Transaction.created_at),
        )).all()


async def _wait_until_waiting_on(blocker_pid: int, request: asyncio.Task):
    """Wait until a backend waits on a lock the blocker holds, or the request has already answered"""
    async with asyncio.timeout(5), TestSession() as observer:
        while not request.done():
            is_waiting = await observer.scalar(
                text("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE NOT granted AND :pid = ANY(pg_blocking_pids(pid)))"),
                {"pid": blocker_pid},
            )
            if is_waiting:
                return
            await asyncio.sleep(0.01)


# --- POST /accounts/{account_id}/starting-balance ---


async def test_record_starting_balance_writes_one_opening_adjustment_on_the_users_day(client, monkeypatch):
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
    account_id = (await _create_account(
        client, headers, account_kind=account_kind, account_type=account_type, name="Owed",
    )).json()["id"]

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


@pytest.mark.parametrize("amount", [0, -100_00])
async def test_record_starting_balance_refuses_an_amount_below_one_minor_unit(client, amount):
    """A negative or zero balance writes nothing, since a starting balance is stated as zero or higher."""
    headers = _get_auth_header(await _create_user(client))
    account_id = (await _create_account(client, headers)).json()["id"]

    resp = await _record_starting_balance(client, headers, account_id, amount)

    assert resp.status_code == 422
    assert resp.json()["detail"][0]["loc"] == ["body", "amount"]
    assert await _account_transactions(account_id) == []


async def test_record_starting_balance_on_another_users_account_returns_404(client):
    """Another user's account is not found and keeps no balance."""
    headers = _get_auth_header(await _create_user(client))
    account_id = (await _create_account(client, headers)).json()["id"]
    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await _record_starting_balance(client, other_headers, account_id, 100_00)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Account not found"
    assert await _account_transactions(account_id) == []


async def test_record_starting_balance_refuses_a_group_account(client):
    """A group account is left out of the new flow, even for the group's admin."""
    headers = _get_auth_header(await _create_user(client))
    group_id = await _create_group(client, headers)
    account_id = (await _create_account(client, headers, group_id=group_id)).json()["id"]

    resp = await _record_starting_balance(client, headers, account_id, 100_00)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "A starting balance can only be recorded on a personal account"
    assert await _account_transactions(account_id) == []


async def test_record_starting_balance_on_an_account_created_archived(client):
    """An account created archived still takes its starting balance, as transactions can't be added to it."""
    headers = _get_auth_header(await _create_user(client))
    account_id = (await _create_account(client, headers, is_archived=True)).json()["id"]

    resp = await _record_starting_balance(client, headers, account_id, 100_00)

    assert resp.status_code == 200
    assert (resp.json()["is_archived"], resp.json()["current_balance"]) == (True, 100_00)
    assert [txn.amount for txn, _ in await _account_transactions(account_id)] == [100_00]


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


async def test_record_starting_balance_waits_for_a_transaction_still_saving_and_refuses(client):
    """A starting balance sent while a transaction is being saved to the account is refused once it lands."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_data = (await _create_account(client, headers)).json()
    merchant_id = UUID(await _get_system_merchant_id(client, headers))

    async with TestSession() as saving:
        category_id = await saving.scalar(select(Category.id).where(Category.is_system.is_(True)).limit(1))
        saving.add(Transaction(
            created_by_user_id=UUID(signup_resp.json()["user"]["id"]),
            account_id=UUID(account_data["id"]),
            dt=_created_at_in_tz(account_data, USER_TZ),
            category_id=category_id,
            merchant_id=merchant_id,
            amount=-5000,
            currency="CAD",
        ))
        await saving.flush()
        saving_pid = await saving.scalar(text("SELECT pg_backend_pid()"))
        request = asyncio.create_task(_record_starting_balance(client, headers, account_data["id"], 100_00))
        await _wait_until_waiting_on(saving_pid, request)
        await saving.commit()

    resp = await request

    assert resp.status_code == 422
    assert resp.json()["detail"] == ALREADY_HAS_TRANSACTIONS
    assert [txn.amount for txn, _ in await _account_transactions(account_data["id"])] == [-5000]
