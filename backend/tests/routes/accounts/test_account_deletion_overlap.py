"""Deleting an account while another change to it is saving

Each test holds one real request at the point where it holds its locks, lets the other queue
behind it on the database, then releases the first. Both must finish with the outcome of one of
the two orders they could have run in, rather than one being cancelled as a deadlock.
"""

import asyncio
import contextvars

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.permissions import accounts as account_permissions_module
from app.routes.accounts import deletion_helpers as account_deletion_module
from app.services.importers.shared import run_history as run_history_module
from app.services.transactions import creation as creation_module
from app.services.transactions import deletion as deletion_module
from app.services.transactions import update as update_module
from tests.routes.support import _create_account, _get_system_merchant_id, _wait_until_blocked
from tests.routes.transactions._helpers import _create_transaction, _get_system_category_id, _setup_user_with_deps
from tests.routes.transactions._import_helpers import _import_run
from tests.routes.transactions.test_import_run_undo import _csv_payload

# Set inside one request's task, so a patched session method acts on that request alone
_held_request = contextvars.ContextVar("held_request", default=False)


async def _pid(db) -> int:
    return await db.scalar(text("SELECT pg_backend_pid()"))


async def _overlap(first, second, *, first_held, release, second_entered, pids):
    """Run the first request to its hold, queue the second behind it, then let both finish."""
    requests = []
    try:
        async with asyncio.timeout(10):
            requests.append(asyncio.create_task(first()))
            await first_held.wait()
            requests.append(asyncio.create_task(second()))
            await second_entered.wait()
            await _wait_until_blocked(pids[0], pids[1])
            release.set()
            return await asyncio.gather(*requests)
    finally:
        release.set()
        for request in requests:
            if not request.done():
                request.cancel()
        await asyncio.gather(*requests, return_exceptions=True)


def _record_pid(monkeypatch, module, name: str, pids: list[int], entered: asyncio.Event):
    """Record the queued request's database backend as it enters a step, so its lock wait can be observed."""
    original = getattr(module, name)

    async def record(db, *args, **kwargs):
        if _held_request.get():
            return await original(db, *args, **kwargs)
        pids.append(await _pid(db))
        entered.set()
        return await original(db, *args, **kwargs)

    monkeypatch.setattr(module, name, record)


def _hold_delete_at_commit(monkeypatch, client, headers, account_id, held, release, pids):
    """Return a delete of the account that holds just before it commits, with its rows removed."""
    original_commit = AsyncSession.commit

    async def hold_commit(session):
        if _held_request.get():
            pids.append(await _pid(session))
            held.set()
            await release.wait()
        await original_commit(session)

    async def delete_account():
        _held_request.set(True)
        return await client.delete(f"/accounts/{account_id}", headers=headers)

    monkeypatch.setattr(AsyncSession, "commit", hold_commit)
    return delete_account


async def _setup(client):
    """Sign up a user with an account holding one transaction, and a second account."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    merchant_id = await _get_system_merchant_id(client, headers)
    transaction = await _create_transaction(client, headers, account_id, category_id, merchant_id=merchant_id)
    assert transaction.status_code == 201
    other_account_id = (await _create_account(client, headers, name="Savings")).json()["id"]
    return headers, account_id, category_id, merchant_id, transaction.json()["id"], other_account_id


@pytest.mark.parametrize(("change", "module", "status"), [
    ("create", creation_module, 201),
    ("edit", update_module, 200),
    ("delete", deletion_module, 204),
])
async def test_an_account_delete_waits_for_a_transaction_change_that_reached_the_account_first(
    client, monkeypatch, change, module, status,
):
    """The transaction change lands and answers, then the delete takes the account and everything in it."""
    headers, account_id, category_id, merchant_id, transaction_id, _ = await _setup(client)
    held, release, entered, deleted = asyncio.Event(), asyncio.Event(), asyncio.Event(), asyncio.Event()
    pids = []
    original_mark = module.mark_cache_changed_for_scope
    original_commit = AsyncSession.commit

    async def hold_before_cache_mark(db, **scope):
        pids.append(await _pid(db))
        held.set()
        await release.wait()
        await original_mark(db, **scope)

    async def commit_then_wait_for_the_delete(session):
        await original_commit(session)
        # The delete goes ahead the moment this commits, so the change answers only once the
        # account and the row it saved are gone
        if _held_request.get():
            await deleted.wait()

    async def transaction_change():
        _held_request.set(True)
        if change == "create":
            return await _create_transaction(client, headers, account_id, category_id, merchant_id=merchant_id)
        if change == "edit":
            return await client.patch(f"/transactions/{transaction_id}", json={"amount": -7000}, headers=headers)
        return await client.delete(f"/transactions/{transaction_id}", headers=headers)

    async def delete_account():
        try:
            return await client.delete(f"/accounts/{account_id}", headers=headers)
        finally:
            deleted.set()

    monkeypatch.setattr(module, "mark_cache_changed_for_scope", hold_before_cache_mark)
    monkeypatch.setattr(AsyncSession, "commit", commit_then_wait_for_the_delete)
    _record_pid(monkeypatch, account_deletion_module, "check_account_access", pids, entered)

    changed, removed = await _overlap(
        transaction_change, delete_account, first_held=held, release=release, second_entered=entered, pids=pids,
    )

    assert changed.status_code == status, changed.text
    assert removed.status_code == 204, removed.text
    assert (await client.get(f"/accounts/{account_id}", headers=headers)).status_code == 404


@pytest.mark.parametrize("change", ["create", "move", "bulk move", "transfer", "rename"])
async def test_a_change_reaching_an_account_being_deleted_is_refused_as_not_found(client, monkeypatch, change):
    """The delete lands first, and a change that would write to the account finds it gone."""
    headers, deleting_id, category_id, merchant_id, _, other_id = await _setup(client)
    staying = await _create_transaction(client, headers, other_id, category_id, merchant_id=merchant_id)
    staying_id = staying.json()["id"]
    held, release, entered = asyncio.Event(), asyncio.Event(), asyncio.Event()
    pids = []
    delete_account = _hold_delete_at_commit(monkeypatch, client, headers, deleting_id, held, release, pids)

    async def write_to_the_account():
        if change == "create":
            return await _create_transaction(client, headers, deleting_id, category_id, merchant_id=merchant_id)
        if change == "move":
            return await client.patch(f"/transactions/{staying_id}", json={"account_id": deleting_id}, headers=headers)
        if change == "bulk move":
            return await client.patch(
                "/transactions/bulk", json={"transaction_ids": [staying_id], "account_id": deleting_id}, headers=headers,
            )
        if change == "transfer":
            return await _create_transaction(
                client, headers, other_id, await _get_system_category_id(client, headers, "Transfer"),
                merchant_id=merchant_id, counterparty_account_scope="tracked", counterparty_account_id=deleting_id,
            )
        return await client.patch(f"/accounts/{deleting_id}", json={"name": "Renamed"}, headers=headers)

    _record_pid(monkeypatch, account_permissions_module, "_get_account_or_404", pids, entered)

    removed, refused = await _overlap(
        delete_account, write_to_the_account, first_held=held, release=release, second_entered=entered, pids=pids,
    )

    assert removed.status_code == 204, removed.text
    assert refused.status_code == 404, refused.text
    assert refused.json()["detail"] == "Account not found"


async def test_editing_a_transfer_that_records_an_account_being_deleted_waits_for_the_delete(client, monkeypatch):
    """The delete is refused for the transfer recording the account, then the edit goes ahead."""
    headers, deleting_id, _, merchant_id, _, other_id = await _setup(client)
    transfer = await _create_transaction(
        client, headers, other_id, await _get_system_category_id(client, headers, "Transfer"),
        merchant_id=merchant_id, counterparty_account_scope="tracked", counterparty_account_id=deleting_id,
    )
    assert transfer.status_code == 201, transfer.text
    held, release, entered = asyncio.Event(), asyncio.Event(), asyncio.Event()
    pids = []
    delete_account = _hold_delete_at_commit(monkeypatch, client, headers, deleting_id, held, release, pids)
    _record_pid(monkeypatch, update_module, "check_transaction_access", pids, entered)

    removed, edited = await _overlap(
        delete_account,
        lambda: client.patch(f"/transactions/{transfer.json()['id']}", json={"amount": -7000}, headers=headers),
        first_held=held, release=release, second_entered=entered, pids=pids,
    )

    assert removed.status_code == 409, removed.text
    assert edited.status_code == 200, edited.text


async def test_an_account_delete_overlapping_an_import_undo_still_deletes_the_account(client, monkeypatch):
    """The undo takes the change marker before its rows, so the two meet in a circle the delete gives way in."""
    headers, account_id, _ = await _setup_user_with_deps(client)
    payload = _csv_payload(["-4.50"])
    payload["accounts"] = [{"source": "Everyday", "account_id": account_id}]
    imported = await _import_run(client, headers, payload, file_name="everyday-test.csv")
    assert imported.status_code == 201, imported.text
    run_id = (await client.get("/transactions/import/last", headers=headers)).json()["id"]
    held, release, entered = asyncio.Event(), asyncio.Event(), asyncio.Event()
    pids = []
    original_marker = run_history_module.load_locked_change_marker

    async def hold_after_marker(db, *args):
        changed_at = await original_marker(db, *args)
        pids.append(await _pid(db))
        held.set()
        await release.wait()
        return changed_at

    monkeypatch.setattr(run_history_module, "load_locked_change_marker", hold_after_marker)
    _record_pid(monkeypatch, account_deletion_module, "check_account_access", pids, entered)

    undone, removed = await _overlap(
        lambda: client.post(f"/transactions/import/runs/{run_id}/undo", headers=headers),
        lambda: client.delete(f"/accounts/{account_id}", headers=headers),
        first_held=held, release=release, second_entered=entered, pids=pids,
    )

    assert undone.status_code in (200, 409), undone.text
    assert removed.status_code == 204, removed.text
