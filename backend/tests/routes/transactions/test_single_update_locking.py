"""Single-row writers validate the current row while holding its database lock."""

import asyncio
import uuid

import pytest
from sqlalchemy import select, text

from app.models.transaction import Transaction
from app.permissions import transactions as transaction_permissions
from app.services.transactions import update as update_module
from tests.conftest import TestSession
from tests.routes.groups.test_transactions import _setup_group_with_shared_account
from tests.routes.transactions._helpers import (
    _create_account,
    _create_transaction,
    _get_system_category_id,
    _setup_user_with_deps,
)


async def _wait_until_blocked(blocker_pid: int, blocked_pid: int) -> None:
    """Observe the actual PostgreSQL wait rather than assuming a scheduled task reached the lock."""
    async with asyncio.timeout(5):
        async with TestSession() as observer:
            while blocker_pid not in await observer.scalar(
                text("SELECT pg_blocking_pids(:pid)"), {"pid": blocked_pid},
            ):
                await asyncio.sleep(0.01)


async def _run_serialized_patches(client, headers, transaction_id, first_fields, second_fields, monkeypatch):
    """Hold the first real request after its row lock, then let the second queue behind it."""
    original = update_module.check_transaction_access
    first_locked = asyncio.Event()
    second_entered = asyncio.Event()
    release_first = asyncio.Event()
    pids = []

    async def hold_first(db, *args, **kwargs):
        pids.append(await db.scalar(text("SELECT pg_backend_pid()")))
        if len(pids) == 2:
            second_entered.set()
        txn = await original(db, *args, **kwargs)
        if len(pids) == 1:
            first_locked.set()
            await release_first.wait()
        return txn

    monkeypatch.setattr(update_module, "check_transaction_access", hold_first)
    requests = []
    try:
        async with asyncio.timeout(10):
            requests.append(asyncio.create_task(client.patch(
                f"/transactions/{transaction_id}", json=first_fields, headers=headers,
            )))
            await first_locked.wait()
            requests.append(asyncio.create_task(client.patch(
                f"/transactions/{transaction_id}", json=second_fields, headers=headers,
            )))
            await second_entered.wait()
            await _wait_until_blocked(pids[0], pids[1])
            release_first.set()
            results = await asyncio.gather(*requests)
    finally:
        release_first.set()
        for request in requests:
            if not request.done():
                request.cancel()
        await asyncio.gather(*requests, return_exceptions=True)

    assert len(set(pids)) == 2
    return results


async def _patch_after_holder_change(client, headers, transaction_id, fields, monkeypatch, change):
    """Queue a real request on a row while an independent session changes related state."""
    original = update_module.check_transaction_access
    waiting = asyncio.Event()
    waiting_pid = None

    async def record_waiter(db, *args, **kwargs):
        nonlocal waiting_pid
        waiting_pid = await db.scalar(text("SELECT pg_backend_pid()"))
        waiting.set()
        return await original(db, *args, **kwargs)

    monkeypatch.setattr(update_module, "check_transaction_access", record_waiter)
    request = None
    async with TestSession() as holder:
        await holder.execute(
            select(Transaction.id).where(Transaction.id == uuid.UUID(transaction_id)).with_for_update(),
        )
        holder_pid = await holder.scalar(text("SELECT pg_backend_pid()"))
        try:
            async with asyncio.timeout(10):
                request = asyncio.create_task(client.patch(
                    f"/transactions/{transaction_id}", json=fields, headers=headers,
                ))
                await waiting.wait()
                await _wait_until_blocked(holder_pid, waiting_pid)
                await change(holder)
                await holder.commit()
                return await request
        finally:
            await holder.rollback()
            if request is not None and not request.done():
                request.cancel()
                await asyncio.gather(request, return_exceptions=True)


async def test_concurrent_transfer_edits_validate_the_final_pair(client, monkeypatch):
    """Moving A/X to B/X makes a queued counterparty=B edit invalid rather than leaving B/B."""
    headers, account_a, _ = await _setup_user_with_deps(client)
    account_b = (await _create_account(client, headers, name="Savings")).json()["id"]
    account_x = (await _create_account(client, headers, name="Cash")).json()["id"]
    transfer_category = await _get_system_category_id(client, headers, "Transfer")
    created = await _create_transaction(
        client, headers, account_a, transfer_category,
        counterparty_account_id=account_x, counterparty_account_scope="tracked",
    )
    assert created.status_code == 201
    transaction_id = created.json()["id"]

    moved, changed_counterparty = await _run_serialized_patches(
        client, headers, transaction_id,
        {"account_id": account_b},
        {"counterparty_account_id": account_b},
        monkeypatch,
    )

    assert moved.status_code == 200, moved.text
    assert changed_counterparty.status_code == 422, changed_counterparty.text
    saved = (await client.get(f"/transactions/{transaction_id}", headers=headers)).json()
    assert saved["account_id"] == account_b
    assert saved["counterparty_account_id"] == account_x


async def test_disjoint_edits_both_survive_after_the_second_waits(client, monkeypatch):
    """A queued notes edit keeps the amount committed by the first writer."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    transaction_id = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    amount, notes = await _run_serialized_patches(
        client, headers, transaction_id, {"amount": -7000}, {"notes": "after amount"}, monkeypatch,
    )

    assert amount.status_code == notes.status_code == 200
    saved = (await client.get(f"/transactions/{transaction_id}", headers=headers)).json()
    assert (saved["amount"], saved["notes"]) == (-7000, "after amount")
    assert (await client.get(f"/accounts/{account_id}", headers=headers)).json()["current_balance"] == -7000


async def test_concurrent_account_moves_rebuild_from_the_latest_account(client, monkeypatch):
    """Successive account moves leave only the final account with the transaction balance."""
    headers, account_a, category_id = await _setup_user_with_deps(client)
    account_b = (await _create_account(client, headers, name="Savings")).json()["id"]
    account_c = (await _create_account(client, headers, name="Cash")).json()["id"]
    transaction_id = (await _create_transaction(client, headers, account_a, category_id)).json()["id"]

    first, second = await _run_serialized_patches(
        client, headers, transaction_id, {"account_id": account_b}, {"account_id": account_c}, monkeypatch,
    )

    assert first.status_code == second.status_code == 200
    saved = (await client.get(f"/transactions/{transaction_id}", headers=headers)).json()
    assert saved["account_id"] == account_c
    balances = [
        (await client.get(f"/accounts/{account_id}", headers=headers)).json()["current_balance"]
        for account_id in (account_a, account_b, account_c)
    ]
    assert balances == [0, 0, -5000]


async def test_row_deleted_while_update_waits_returns_not_found(client, monkeypatch):
    """A queued edit reports a missing row after the lock holder deletes it."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    transaction_id = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    async def delete_row(holder):
        await holder.execute(text("DELETE FROM transactions WHERE id = :id"), {"id": uuid.UUID(transaction_id)})

    response = await _patch_after_holder_change(
        client, headers, transaction_id, {"notes": "too late"}, monkeypatch, delete_row,
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Transaction not found"


@pytest.mark.parametrize("revoked_account", ["source", "destination"])
async def test_permissions_are_rechecked_after_waiting_for_the_row(client, monkeypatch, revoked_account):
    """Source and destination grants are checked after a queued writer gets the row."""
    admin, member, member_id, group_id, source_id, category_id, merchant_id = (
        await _setup_group_with_shared_account(client)
    )
    destination_id = (await _create_account(client, admin, name="Group savings", group_id=group_id)).json()["id"]
    grants = {}
    for account_id in (source_id, destination_id):
        granted = await client.post(
            f"/accounts/{account_id}/permissions",
            json={"user_id": member_id, "level": "write"}, headers=admin,
        )
        assert granted.status_code == 201
        grants[account_id] = granted.json()["id"]
    transaction_id = (await _create_transaction(
        client, admin, source_id, category_id, merchant_id=merchant_id,
    )).json()["id"]
    revoked_id = source_id if revoked_account == "source" else destination_id

    async def revoke(_holder):
        response = await client.delete(f"/accounts/{revoked_id}/permissions/{grants[revoked_id]}", headers=admin)
        assert response.status_code == 204

    fields = {"notes": "after revoke"} if revoked_account == "source" else {"account_id": destination_id}
    response = await _patch_after_holder_change(
        client, member, transaction_id, fields, monkeypatch, revoke,
    )
    assert response.status_code == 404
    assert (await client.get(f"/transactions/{transaction_id}", headers=admin)).json()["account_id"] == source_id


@pytest.mark.parametrize("action", ["patch", "delete"])
async def test_held_row_returns_a_bounded_conflict(client, monkeypatch, action):
    """A held row yields a conflict for either single-row write instead of hanging."""
    monkeypatch.setattr(transaction_permissions, "TRANSACTION_WRITE_LOCK_WAIT", "100ms")
    headers, account_id, category_id = await _setup_user_with_deps(client)
    transaction_id = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    async with TestSession() as holder:
        await holder.execute(
            select(Transaction.id).where(Transaction.id == uuid.UUID(transaction_id)).with_for_update(),
        )
        async with asyncio.timeout(5):
            if action == "patch":
                response = await client.patch(
                    f"/transactions/{transaction_id}", json={"notes": "blocked"}, headers=headers,
                )
            else:
                response = await client.delete(f"/transactions/{transaction_id}", headers=headers)
        await holder.rollback()

    assert response.status_code == 409
    assert response.json()["detail"] == "Another change reached this transaction first"
