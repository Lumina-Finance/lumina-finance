import asyncio
import uuid
from datetime import date

import pytest
from sqlalchemy import func, select, text

from app.models.account import AccountBalanceSnapshot
from app.models.base import TransferCounterpartyScope
from app.models.tag import TransactionTag
from app.models.transaction import Transaction
from app.services.accounts import snapshots as account_snapshots_module
from app.services.importers.firefly import service as firefly_import_module
from app.services.importers.generic import service as generic_import_module
from app.services.transactions import bulk_update as bulk_update_module
from app.services.transactions import creation as creation_module
from app.services.transactions import deletion as deletion_module
from app.services.transactions import snapshots as transaction_snapshots_module
from tests.conftest import TestSession
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import (
    _create_account,
    _create_category,
    _create_merchant,
    _create_tag,
    _create_transaction,
    _get_system_category_id,
    _import_transactions,
    _seed_usd_currency,
    _setup_user_with_deps,
)

# --- PATCH /transactions/bulk ---


async def _clear_merchant(transaction_id):
    """Take the merchant off a transaction, as rows recorded before the rule have it."""
    async with TestSession() as session:
        txn = await session.get(Transaction, uuid.UUID(transaction_id))
        txn.merchant_id = None
        await session.commit()


async def _clear_counterparty(transaction_id):
    """Take the recorded counterparty off a transfer, as rows predating the field have it."""
    async with TestSession() as session:
        txn = await session.get(Transaction, uuid.UUID(transaction_id))
        txn.counterparty_account_id = None
        txn.counterparty_account_scope = None
        await session.commit()


async def _read_transaction(transaction_id):
    """Return a transaction row straight from the database."""
    async with TestSession() as session:
        return await session.get(Transaction, uuid.UUID(transaction_id))


async def _read_snapshots(account_id):
    """Return an account's stored running balances, oldest first."""
    async with TestSession() as session:
        rows = await session.execute(
            select(AccountBalanceSnapshot.dt, AccountBalanceSnapshot.balance)
            .where(AccountBalanceSnapshot.account_id == uuid.UUID(account_id))
            .order_by(AccountBalanceSnapshot.dt),
        )
        return list(rows.all())


async def _read_transaction_total(account_id):
    """Return the persisted transaction total for an account."""
    async with TestSession() as session:
        return await session.scalar(
            select(func.coalesce(func.sum(Transaction.amount), 0)).where(
                Transaction.account_id == uuid.UUID(account_id),
            ),
        )


async def _wait_until_blocked(blocker_pid, blocked_pid):
    """Wait until PostgreSQL reports one backend blocked by another."""
    async with asyncio.timeout(5):
        async with TestSession() as observer:
            while blocker_pid not in await observer.scalar(
                text("SELECT pg_blocking_pids(:pid)"),
                {"pid": blocked_pid},
            ):
                await asyncio.sleep(0.01)


async def _run_bulk_with_blocked_writer(
    client,
    headers,
    transaction_id,
    monkeypatch,
    writer_module,
    writer_request,
):
    """Hold a real bulk rebuild while another writer waits on its advisory lock."""
    original_recompute = bulk_update_module.recompute_account_snapshots
    first_rebuilt = asyncio.Event()
    release_first = asyncio.Event()
    writer_started = asyncio.Event()
    backend_pids = []

    async def hold_bulk_rebuild(db, snapshot_starts):
        """Hold the bulk request after its real rebuild and before its commit."""
        backend_pids.append(await db.scalar(text("SELECT pg_backend_pid()")))
        await original_recompute(db, snapshot_starts)
        first_rebuilt.set()
        await release_first.wait()

    async def observe_writer_rebuild(db, snapshot_starts):
        """Record the other writer's backend before entering the real rebuild."""
        backend_pids.append(await db.scalar(text("SELECT pg_backend_pid()")))
        writer_started.set()
        await original_recompute(db, snapshot_starts)

    monkeypatch.setattr(bulk_update_module, "recompute_account_snapshots", hold_bulk_rebuild)
    monkeypatch.setattr(writer_module, "recompute_account_snapshots", observe_writer_rebuild)
    requests = []
    try:
        async with asyncio.timeout(10):
            requests.append(asyncio.create_task(client.patch(
                "/transactions/bulk",
                json={"transaction_ids": [transaction_id], "direction": "credit"},
                headers=headers,
            )))
            await first_rebuilt.wait()
            requests.append(asyncio.create_task(writer_request()))
            await writer_started.wait()
            await _wait_until_blocked(backend_pids[0], backend_pids[1])
            release_first.set()
            results = await asyncio.gather(*requests, return_exceptions=True)
    finally:
        release_first.set()
        for request in requests:
            if not request.done():
                request.cancel()
        await asyncio.gather(*requests, return_exceptions=True)

    for result in results:
        assert not isinstance(result, BaseException), repr(result)
    return results


async def _setup_transfer_user(client):
    """Sign up a user with an account, an expense category, a second account and the Transfer category."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_account_id = (await _create_account(client, headers, name="Savings")).json()["id"]
    transfer_id = await _get_system_category_id(client, headers, "Transfer")
    return headers, account_id, category_id, other_account_id, transfer_id


async def test_bulk_update_sets_a_category_on_every_selected_transaction(client):
    """One request applies the chosen category to each transaction it names."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    first = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    second = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    dining_id = (await _create_category(client, headers, name="Bulk Dining", kind="expense")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [first, second], "category_id": dining_id},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["transactions_updated"] == 2
    assert resp.json()["affected_account_ids"] == [account_id]
    assert str((await _read_transaction(first)).category_id) == dining_id
    assert str((await _read_transaction(second)).category_id) == dining_id


async def test_bulk_update_refuses_a_set_holding_a_transaction_with_no_merchant(client):
    """A row recorded before a merchant was required refuses any other change until it has one."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    first = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    second = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    await _clear_merchant(first)
    dining_id = (await _create_category(client, headers, name="Bulk Dining", kind="expense")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [first, second], "category_id": dining_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert "missing merchant information" in resp.json()["detail"]
    assert str((await _read_transaction(second)).category_id) == category_id


async def test_bulk_update_setting_a_merchant_leaves_a_transfer_counterparty_alone(client):
    """A set holding one transfer and one expense keeps the transfer's recorded account."""
    headers, account_id, category_id, other_account_id, transfer_id = await _setup_transfer_user(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    transfer = (
        await _create_transaction(
            client,
            headers,
            account_id,
            transfer_id,
            counterparty_account_scope="tracked",
            counterparty_account_id=other_account_id,
        )
    ).json()["id"]
    merchant_id = (await _create_merchant(client, headers, name="Costco")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [expense, transfer], "merchant_id": merchant_id},
        headers=headers,
    )

    assert resp.status_code == 200
    transfer_row = await _read_transaction(transfer)
    assert str(transfer_row.counterparty_account_id) == other_account_id
    assert transfer_row.counterparty_account_scope == TransferCounterpartyScope.TRACKED
    assert str(transfer_row.merchant_id) == merchant_id
    assert str((await _read_transaction(expense)).merchant_id) == merchant_id


async def test_bulk_update_refuses_a_transfer_that_records_no_other_account(client):
    """Setting only a merchant still answers the transfer question, as a single edit does."""
    headers, account_id, _, _, transfer_id = await _setup_transfer_user(client)
    transfer = (
        await _create_transaction(client, headers, account_id, transfer_id, counterparty_account_scope="outside")
    ).json()["id"]
    await _clear_counterparty(transfer)
    merchant_before = (await _read_transaction(transfer)).merchant_id
    merchant_id = (await _create_merchant(client, headers, name="Costco")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [transfer], "merchant_id": merchant_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert "missing the To or From account" in resp.json()["detail"]

    # The row keeps the merchant it had, which is what proves the refusal ran before any write
    assert (await _read_transaction(transfer)).merchant_id == merchant_before


async def test_bulk_update_refuses_a_transfer_category_over_a_row_recording_nothing(client):
    """Moving an expense onto a transfer category needs the other account, which the bar cannot set."""
    headers, account_id, category_id, _, transfer_id = await _setup_transfer_user(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [expense], "category_id": transfer_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert str((await _read_transaction(expense)).category_id) == category_id


async def test_bulk_update_clears_the_counterparty_when_the_new_category_records_none(client):
    """A transfer moved onto an expense category drops the account it recorded."""
    headers, account_id, category_id, other_account_id, transfer_id = await _setup_transfer_user(client)
    transfer = (
        await _create_transaction(
            client,
            headers,
            account_id,
            transfer_id,
            counterparty_account_scope="tracked",
            counterparty_account_id=other_account_id,
        )
    ).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [transfer], "category_id": category_id},
        headers=headers,
    )

    assert resp.status_code == 200
    row = await _read_transaction(transfer)
    assert row.counterparty_account_id is None
    assert row.counterparty_account_scope is None


async def test_bulk_update_adding_a_tag_clears_a_counterparty_the_category_does_not_record(client):
    """A tags-only edit normalises the row the same way a single edit does."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    async with TestSession() as session:
        row = await session.get(Transaction, uuid.UUID(txn))
        row.counterparty_account_scope = TransferCounterpartyScope.OUTSIDE
        await session.commit()
    tag_id = (await _create_tag(client, headers, name="vacation")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "add_tag_ids": [tag_id]},
        headers=headers,
    )

    assert resp.status_code == 200
    assert (await _read_transaction(txn)).counterparty_account_scope is None


async def test_bulk_update_rejects_a_transaction_belonging_to_another_user(client):
    """An unreachable identifier answers 404 rather than reporting a change it never made."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    mine = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    other_headers, other_account_id, other_category_id = await _setup_user_with_deps(
        client, email="stranger@example.com", name_prefix="Stranger",
    )
    theirs = (
        await _create_transaction(client, other_headers, other_account_id, other_category_id)
    ).json()["id"]
    dining_id = (await _create_category(client, headers, name="Bulk Dining", kind="expense")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [mine, theirs], "category_id": dining_id},
        headers=headers,
    )

    assert resp.status_code == 404
    assert str((await _read_transaction(mine)).category_id) == category_id
    assert str((await _read_transaction(theirs)).category_id) == other_category_id


async def test_bulk_update_refuses_a_set_holding_an_archived_account(client):
    """An archived account takes no edits, so the whole set is refused."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    archived_account_id = (await _create_account(client, headers, name="Old Chequing")).json()["id"]
    kept = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    archived = (await _create_transaction(client, headers, archived_account_id, category_id)).json()["id"]
    archive_resp = await client.patch(
        f"/accounts/{archived_account_id}", json={"is_archived": True}, headers=headers,
    )
    assert archive_resp.status_code == 200
    dining_id = (await _create_category(client, headers, name="Bulk Dining", kind="expense")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [kept, archived], "category_id": dining_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert str((await _read_transaction(kept)).category_id) == category_id


async def test_bulk_update_adds_a_tag_without_disturbing_the_tags_already_there(client):
    """Adding a tag leaves every tag the transaction already carries in place."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    travel_id = (await _create_tag(client, headers, name="travel")).json()["id"]
    reimbursable_id = (await _create_tag(client, headers, name="reimbursable")).json()["id"]
    txn = (
        await _create_transaction(client, headers, account_id, category_id, tag_ids=[travel_id])
    ).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "add_tag_ids": [reimbursable_id]},
        headers=headers,
    )

    assert resp.status_code == 200
    detail = await client.get(f"/transactions/{txn}", headers=headers)
    assert set(detail.json()["tag_ids"]) == {travel_id, reimbursable_id}


async def test_bulk_update_adding_a_tag_the_transaction_already_has_changes_nothing(client):
    """A tag already attached is left as it is rather than failing the request."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    travel_id = (await _create_tag(client, headers, name="travel")).json()["id"]
    txn = (
        await _create_transaction(client, headers, account_id, category_id, tag_ids=[travel_id])
    ).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "add_tag_ids": [travel_id]},
        headers=headers,
    )

    assert resp.status_code == 200
    # The request still reached this row, so it counts even though nothing about it changed
    assert resp.json()["transactions_updated"] == 1
    async with TestSession() as session:
        rows = await session.execute(
            select(TransactionTag).where(TransactionTag.transaction_id == uuid.UUID(txn)),
        )
        assert len(list(rows.scalars().all())) == 1


async def test_bulk_update_refuses_more_tags_than_one_request_may_add(client):
    """add_tag_ids is bounded, since past a few dozen tags.py would issue one statement per id."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    tag_ids = [(await _create_tag(client, headers, name=f"tag{i}")).json()["id"] for i in range(33)]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "add_tag_ids": tag_ids},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_bulk_update_accepts_the_same_transaction_named_twice(client):
    """A repeated identifier is one transaction, not one found and one missing."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    first = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    second = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    dining_id = (await _create_category(client, headers, name="Bulk Dining", kind="expense")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [first, second, first], "category_id": dining_id},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["transactions_updated"] == 2
    assert str((await _read_transaction(first)).category_id) == dining_id
    assert str((await _read_transaction(second)).category_id) == dining_id


async def test_bulk_update_refuses_more_transactions_than_one_request_may_carry(client):
    """The request is bounded, so a selection past the cap is refused before any work."""
    headers, _account_id, category_id = await _setup_user_with_deps(client)

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [str(uuid.uuid4()) for _ in range(1001)], "category_id": category_id},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_bulk_update_refuses_an_empty_selection(client):
    """A request naming no transaction has nothing to apply to."""
    headers, _account_id, category_id = await _setup_user_with_deps(client)

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [], "category_id": category_id},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_bulk_update_refuses_a_request_that_sets_nothing(client):
    """Naming transactions without a field to set would report a count for no write."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch("/transactions/bulk", json={"transaction_ids": [txn]}, headers=headers)

    assert resp.status_code == 422


async def test_bulk_update_refuses_a_request_carrying_only_an_empty_tag_list(client):
    """An empty tag list sets no field, so it is not a change either."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "add_tag_ids": []},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_bulk_update_leaves_the_account_balances_where_they_were(client):
    """A category or a note moves no money, so every stored balance stays as it was."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    dining_id = (await _create_category(client, headers, name="Bulk Dining", kind="expense")).json()["id"]
    before = await _read_snapshots(account_id)
    assert before, "the account should carry balances before the edit, or this proves nothing"

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "category_id": dining_id, "notes": "Corrected"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert await _read_snapshots(account_id) == before


async def test_bulk_update_leaves_the_balances_alone_for_a_merchant_and_tag_edit(client):
    """A merchant and a tag move no money either, and they are the most common bulk edit there is."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    merchant_id = (await _create_merchant(client, headers, name="Costco")).json()["id"]
    tag_id = (await _create_tag(client, headers, name="vacation")).json()["id"]
    before = await _read_snapshots(account_id)
    assert before, "the account should carry balances before the edit, or this proves nothing"

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "merchant_id": merchant_id, "add_tag_ids": [tag_id]},
        headers=headers,
    )

    assert resp.status_code == 200
    assert await _read_snapshots(account_id) == before


# --- A field sent as null ---


async def test_bulk_update_refuses_a_null_date(client):
    """The date column takes no null, so sending one is refused rather than reaching the database."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "dt": None},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_bulk_update_refuses_a_null_merchant(client):
    """Clearing the merchant would leave a row the edit rules require to have one."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "merchant_id": None},
        headers=headers,
    )

    assert resp.status_code == 422
    assert (await _read_transaction(txn)).merchant_id is not None


# --- The note ---


async def test_bulk_update_sets_a_note_on_every_selected_transaction(client):
    """A note replaces whatever each transaction carried."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    first = (await _create_transaction(client, headers, account_id, category_id, notes="Weekly shop")).json()["id"]
    second = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [first, second], "notes": "Corrected"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert (await _read_transaction(first)).notes == "Corrected"
    assert (await _read_transaction(second)).notes == "Corrected"


async def test_bulk_update_clears_a_note_sent_as_null(client):
    """Null is a real answer for a note, meaning take it off."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id, notes="Weekly shop")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "notes": None},
        headers=headers,
    )

    assert resp.status_code == 200
    assert (await _read_transaction(txn)).notes is None


async def test_bulk_update_leaves_a_note_alone_when_the_request_omits_it(client):
    """A field the request did not carry is left as it was."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id, notes="Weekly shop")).json()["id"]
    dining_id = (await _create_category(client, headers, name="Bulk Dining", kind="expense")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "category_id": dining_id},
        headers=headers,
    )

    assert resp.status_code == 200
    assert (await _read_transaction(txn)).notes == "Weekly shop"


async def test_bulk_update_accepts_a_note_only_edit_on_a_row_with_no_stored_rate(client):
    """A row that keeps its own account is not asked to justify a currency mismatch it did not cause."""
    await _seed_usd_currency()
    headers, _account_id, category_id = await _setup_user_with_deps(client)
    usd_account_id = (await _create_account(client, headers, name="US Savings", currency="USD")).json()["id"]
    txn = (
        await _create_transaction(client, headers, usd_account_id, category_id, currency="CAD", fx_rate=1.35)
    ).json()["id"]
    cleared = await client.patch(f"/transactions/{txn}", json={"fx_rate": None}, headers=headers)
    assert cleared.status_code == 200

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "notes": "Corrected"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert (await _read_transaction(txn)).notes == "Corrected"


# --- Moving to another account ---


async def test_bulk_update_moves_transactions_and_rebuilds_both_accounts(client):
    """A move rebuilds the account the rows left and the one they arrived in."""
    headers, source_id, category_id = await _setup_user_with_deps(client)
    target_id = (await _create_account(client, headers, name="Savings")).json()["id"]

    # Stays behind, so the source account still has history after the move
    await _create_transaction(client, headers, source_id, category_id, dt="2026-07-15", amount=-400)
    first = (
        await _create_transaction(client, headers, source_id, category_id, dt="2026-08-01", amount=-1000)
    ).json()["id"]
    second = (
        await _create_transaction(client, headers, source_id, category_id, dt="2026-08-20", amount=-2500)
    ).json()["id"]

    # Already in the target, bracketing the arrival date, so its later balances have to be rebuilt
    await _create_transaction(client, headers, target_id, category_id, dt="2026-08-10", amount=-800)

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [first, second], "account_id": target_id},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["affected_account_ids"] == sorted([source_id, target_id])

    source_balances = dict(await _read_snapshots(source_id))
    assert source_balances[date(2026, 7, 15)] == -400
    assert max(source_balances) == date(2026, 7, 15)

    target_balances = dict(await _read_snapshots(target_id))
    assert target_balances[date(2026, 8, 1)] == -1000
    assert target_balances[date(2026, 8, 10)] == -1800
    assert target_balances[date(2026, 8, 20)] == -4300


async def test_bulk_update_rebuilds_every_account_a_date_change_touches(client):
    """A selection spans accounts, so a date change rebuilds each one it reaches."""
    headers, first_account, category_id = await _setup_user_with_deps(client)
    second_account = (await _create_account(client, headers, name="Savings")).json()["id"]
    first = (
        await _create_transaction(client, headers, first_account, category_id, dt="2026-08-20", amount=-1000)
    ).json()["id"]
    second = (
        await _create_transaction(client, headers, second_account, category_id, dt="2026-08-20", amount=-2000)
    ).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [first, second], "dt": "2026-08-14"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert dict(await _read_snapshots(first_account))[date(2026, 8, 14)] == -1000
    assert date(2026, 8, 20) not in dict(await _read_snapshots(first_account))
    assert dict(await _read_snapshots(second_account))[date(2026, 8, 14)] == -2000
    assert date(2026, 8, 20) not in dict(await _read_snapshots(second_account))


async def test_bulk_update_rebuilds_the_target_from_a_row_that_was_already_there(client):
    """A row already in the target account contributes its own earlier date to the rebuild."""
    headers, source_id, category_id = await _setup_user_with_deps(client)
    target_id = (await _create_account(client, headers, name="Savings")).json()["id"]
    moving = (
        await _create_transaction(client, headers, source_id, category_id, dt="2026-08-20", amount=-1000)
    ).json()["id"]
    already_there = (
        await _create_transaction(client, headers, target_id, category_id, dt="2026-08-01", amount=-500)
    ).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [moving, already_there], "account_id": target_id, "dt": "2026-08-25"},
        headers=headers,
    )

    assert resp.status_code == 200
    target_balances = dict(await _read_snapshots(target_id))

    # Rebuilt from 2026-08-01, so the row that used to sit there is gone from that date
    assert date(2026, 8, 1) not in target_balances
    assert target_balances[date(2026, 8, 25)] == -1500


async def test_bulk_update_refuses_a_move_that_leaves_a_row_without_an_exchange_rate(client):
    """A row keeps its stored rate across a move, and without one it cannot change currency."""
    await _seed_usd_currency()
    headers, source_id, category_id = await _setup_user_with_deps(client)
    target_id = (await _create_account(client, headers, name="US Savings", currency="USD")).json()["id"]
    txn = (
        await _create_transaction(client, headers, source_id, category_id, currency="CAD")
    ).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "account_id": target_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert "exchange rate" in resp.json()["detail"]
    assert str((await _read_transaction(txn)).account_id) == source_id


async def test_bulk_update_moves_a_row_that_carries_an_exchange_rate(client):
    """The same move is accepted once the row records a rate."""
    await _seed_usd_currency()
    headers, source_id, category_id = await _setup_user_with_deps(client)
    target_id = (await _create_account(client, headers, name="US Savings", currency="USD")).json()["id"]
    txn = (
        await _create_transaction(client, headers, source_id, category_id, currency="CAD", fx_rate=1.35)
    ).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "account_id": target_id},
        headers=headers,
    )

    assert resp.status_code == 200
    assert str((await _read_transaction(txn)).account_id) == target_id


async def test_bulk_update_refuses_a_move_to_an_archived_account(client):
    """An archived account takes no history."""
    headers, source_id, category_id = await _setup_user_with_deps(client)
    target_id = (await _create_account(client, headers, name="Old Savings")).json()["id"]
    txn = (await _create_transaction(client, headers, source_id, category_id)).json()["id"]
    await client.patch(f"/accounts/{target_id}", json={"is_archived": True}, headers=headers)

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "account_id": target_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert str((await _read_transaction(txn)).account_id) == source_id


async def test_bulk_update_refuses_a_move_to_a_closed_account(client):
    """A closed account is a second state that takes no new transactions."""
    headers, source_id, category_id = await _setup_user_with_deps(client)
    target_id = (await _create_account(client, headers, name="Closed Savings")).json()["id"]
    txn = (await _create_transaction(client, headers, source_id, category_id)).json()["id"]
    await client.patch(f"/accounts/{target_id}", json={"closed_at": "2026-03-01"}, headers=headers)

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "account_id": target_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert str((await _read_transaction(txn)).account_id) == source_id


# --- The other account a transfer records ---


async def test_bulk_transfer_to_answers_a_transfer_category_change(client):
    """One request can move rows onto a transfer category and answer what that category asks."""
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    category_id = (await _create_category(client, headers, name="Bulk Dining", kind="expense")).json()["id"]
    first = (await _create_transaction(client, headers, chequing_id, category_id)).json()["id"]
    second = (await _create_transaction(client, headers, chequing_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [first, second],
            "category_id": transfer_id,
            "transfer_to": {"scope": "tracked", "account_id": savings_id},
        },
        headers=headers,
    )

    assert resp.status_code == 200
    # Written twice each, once for the category and once for the end, but a row counts once
    assert resp.json()["transactions_updated"] == 2
    for txn in (first, second):
        row = await _read_transaction(txn)
        assert str(row.category_id) == transfer_id
        assert str(row.account_id) == chequing_id
        assert str(row.counterparty_account_id) == savings_id


async def test_bulk_transfer_to_outside_over_a_mixed_selection_counts_only_the_transfer(client):
    """A count built from a plain rowcount would report every selected row, not just the one written."""
    headers, chequing_id, category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    transfer = (await _make_transfer(
        client, headers, chequing_id, transfer_id, savings_id, amount=-1000,
    )).json()["id"]
    first_expense = (await _create_transaction(client, headers, chequing_id, category_id)).json()["id"]
    second_expense = (await _create_transaction(client, headers, chequing_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [transfer, first_expense, second_expense],
            "transfer_to": {"scope": "outside"},
        },
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["transactions_updated"] == 1
    assert (await _read_transaction(transfer)).counterparty_account_scope == TransferCounterpartyScope.OUTSIDE


async def test_bulk_transfer_to_reports_the_previous_and_new_far_side_accounts(client):
    """Moving a transfer's far side affects both the account it left and the one it now records."""
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    rrsp_id = (await _create_account(client, headers, name="RRSP")).json()["id"]
    first = (await _make_transfer(
        client, headers, chequing_id, transfer_id, savings_id, amount=-2000,
    )).json()["id"]
    second = (await _make_transfer(
        client, headers, chequing_id, transfer_id, savings_id, amount=-3000,
    )).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [first, second],
            "transfer_to": {"scope": "tracked", "account_id": rrsp_id},
        },
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["affected_account_ids"] == sorted([chequing_id, savings_id, rrsp_id])


async def test_bulk_transfer_from_refuses_a_selection_with_no_transfer(client):
    """An end that reaches no row would report a count for a write it never made, so it is refused."""
    headers, chequing_id, category_id = await _setup_user_with_deps(client)
    cash_id = (await _create_account(client, headers, name="Cash")).json()["id"]
    first = (await _create_transaction(client, headers, chequing_id, category_id)).json()["id"]
    second = (await _create_transaction(client, headers, chequing_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [first, second],
            "transfer_from": {"scope": "tracked", "account_id": cash_id},
        },
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == (
        "From and To apply to transfers only, and none of the selected transactions end up as one"
    )


async def test_bulk_transfer_to_refuses_a_selection_with_no_transfer(client):
    """The same refusal applies whichever end the request answers."""
    headers, chequing_id, category_id = await _setup_user_with_deps(client)
    savings_id = (await _create_account(client, headers, name="Savings")).json()["id"]
    first = (await _create_transaction(client, headers, chequing_id, category_id)).json()["id"]
    second = (await _create_transaction(client, headers, chequing_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [first, second],
            "transfer_to": {"scope": "tracked", "account_id": savings_id},
        },
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == (
        "From and To apply to transfers only, and none of the selected transactions end up as one"
    )


async def test_bulk_transfer_from_reads_each_rows_resulting_category_not_its_stored_one(client):
    """An end resolves against what a row ends up under, so recategorizing it away drops the end too."""
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    cash_id = (await _create_account(client, headers, name="Cash")).json()["id"]
    expense_category_id = (await _create_category(client, headers, name="Bulk Dining", kind="expense")).json()["id"]
    transfer = (await _make_transfer(client, headers, chequing_id, transfer_id, savings_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [transfer],
            "category_id": expense_category_id,
            "transfer_from": {"scope": "tracked", "account_id": cash_id},
        },
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == (
        "From and To apply to transfers only, and none of the selected transactions end up as one"
    )


async def test_bulk_update_refuses_a_move_into_the_account_a_transfer_already_records(client):
    """The move makes the recorded account the row's own, which a check on the sent value would miss."""
    headers, account_id, _, other_account_id, transfer_id = await _setup_transfer_user(client)
    txn = (
        await _create_transaction(
            client,
            headers,
            account_id,
            transfer_id,
            counterparty_account_scope="tracked",
            counterparty_account_id=other_account_id,
        )
    ).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "account_id": other_account_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert "with the same account on both sides" in resp.json()["detail"]
    assert str((await _read_transaction(txn)).account_id) == account_id


async def test_bulk_update_refuses_a_transfer_end_that_contradicts_its_own_scope(client):
    """A tracked end needs an account and any other scope forbids one."""
    headers, chequing_id, category_id = await _setup_user_with_deps(client)
    savings_id = (await _create_account(client, headers, name="Savings")).json()["id"]
    txn = (await _create_transaction(client, headers, chequing_id, category_id)).json()["id"]

    tracked_without_account = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "transfer_from": {"scope": "tracked"}},
        headers=headers,
    )
    outside_with_account = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [txn],
            "transfer_from": {"scope": "outside", "account_id": savings_id},
        },
        headers=headers,
    )

    assert tracked_without_account.status_code == 422
    assert outside_with_account.status_code == 422


async def test_bulk_update_refuses_a_null_transfer_end(client):
    """An end has no null to write, so sending one is refused rather than read as clear."""
    headers, chequing_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, chequing_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "transfer_from": None},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_bulk_update_refuses_an_account_move_sent_with_a_transfer_end(client):
    """A move and an end both decide the account a row sits in, so they cannot travel together."""
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    transfer = (await _make_transfer(client, headers, chequing_id, transfer_id, savings_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [transfer],
            "account_id": savings_id,
            "transfer_from": {"scope": "tracked", "account_id": savings_id},
        },
        headers=headers,
    )

    assert resp.status_code == 422


async def _make_transfer(client, headers, account_id, transfer_id, other_account_id, **overrides):
    """Create a transfer recording another tracked account as its other side."""
    return await _create_transaction(
        client,
        headers,
        account_id,
        transfer_id,
        counterparty_account_id=other_account_id,
        counterparty_account_scope="tracked",
        **overrides,
    )


async def _make_transfer_pair(client, headers, chequing_id, savings_id, transfer_id):
    """Create both rows of one transfer: money out of Chequing, money in to Savings, on 2026-08-23."""
    out_id = (await _make_transfer(
        client, headers, chequing_id, transfer_id, savings_id, dt="2026-08-23", amount=-20000,
    )).json()["id"]
    in_id = (await _make_transfer(
        client, headers, savings_id, transfer_id, chequing_id, dt="2026-08-23", amount=20000,
    )).json()["id"]
    return out_id, in_id


async def test_bulk_transfer_ends_move_and_record_by_each_rows_own_direction(client):
    """Both ends apply per row: the money-out half moves into From and the money-in half records it."""
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    cash_id = (await _create_account(client, headers, name="Cash")).json()["id"]
    out_id, in_id = await _make_transfer_pair(client, headers, chequing_id, savings_id, transfer_id)

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [out_id, in_id],
            "transfer_from": {"scope": "tracked", "account_id": cash_id},
            "transfer_to": {"scope": "tracked", "account_id": savings_id},
        },
        headers=headers,
    )

    assert resp.status_code == 200
    out_row = await _read_transaction(out_id)
    assert str(out_row.account_id) == cash_id
    assert str(out_row.counterparty_account_id) == savings_id
    in_row = await _read_transaction(in_id)
    assert str(in_row.account_id) == savings_id
    assert str(in_row.counterparty_account_id) == cash_id


async def test_bulk_transfer_from_alone_moves_the_money_out_half_and_records_on_the_other(client):
    """Only From answered: it moves the row whose direction makes it the own end and records on the rest."""
    headers, chequing_id, category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    cash_id = (await _create_account(client, headers, name="Cash")).json()["id"]
    await _create_transaction(client, headers, chequing_id, category_id, dt="2026-08-01", amount=-400)
    await _create_transaction(client, headers, cash_id, category_id, dt="2026-08-10", amount=-800)
    out_id, in_id = await _make_transfer_pair(client, headers, chequing_id, savings_id, transfer_id)

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [out_id, in_id],
            "transfer_from": {"scope": "tracked", "account_id": cash_id},
        },
        headers=headers,
    )

    assert resp.status_code == 200
    out_row = await _read_transaction(out_id)
    assert str(out_row.account_id) == cash_id
    assert str(out_row.counterparty_account_id) == savings_id
    in_row = await _read_transaction(in_id)
    assert str(in_row.account_id) == savings_id
    assert str(in_row.counterparty_account_id) == cash_id

    chequing_balances = dict(await _read_snapshots(chequing_id))
    assert date(2026, 8, 23) not in chequing_balances
    assert max(chequing_balances) == date(2026, 8, 1)

    cash_balances = dict(await _read_snapshots(cash_id))
    assert cash_balances[date(2026, 8, 10)] == -800
    assert cash_balances[date(2026, 8, 23)] == -20800


async def test_bulk_transfer_to_alone_answers_two_money_out_rows_recording_outside(client):
    """Only To answered: it records on rows that recorded outside, without moving either."""
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    first = (await _create_transaction(
        client, headers, chequing_id, transfer_id, counterparty_account_scope="outside",
    )).json()["id"]
    second = (await _create_transaction(
        client, headers, chequing_id, transfer_id, counterparty_account_scope="outside",
    )).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [first, second],
            "transfer_to": {"scope": "tracked", "account_id": savings_id},
        },
        headers=headers,
    )

    assert resp.status_code == 200
    for txn_id in (first, second):
        row = await _read_transaction(txn_id)
        assert str(row.account_id) == chequing_id
        assert str(row.counterparty_account_id) == savings_id


async def test_bulk_direction_reverse_flips_the_pair_and_rebuilds_both_accounts(client):
    """Reverse flips each row's own sign, leaving the accounts and far sides untouched."""
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    out_id, in_id = await _make_transfer_pair(client, headers, chequing_id, savings_id, transfer_id)

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [out_id, in_id], "direction": "reverse"},
        headers=headers,
    )

    assert resp.status_code == 200
    out_row = await _read_transaction(out_id)
    assert out_row.amount == 20000
    assert str(out_row.account_id) == chequing_id
    assert str(out_row.counterparty_account_id) == savings_id
    in_row = await _read_transaction(in_id)
    assert in_row.amount == -20000
    assert str(in_row.account_id) == savings_id
    assert str(in_row.counterparty_account_id) == chequing_id

    assert dict(await _read_snapshots(chequing_id))[date(2026, 8, 23)] == 20000
    assert dict(await _read_snapshots(savings_id))[date(2026, 8, 23)] == -20000


async def test_bulk_transfer_ends_with_reverse_use_each_rows_resulting_direction(client):
    """Reverse changes which end is a row's own before the ends are applied, not after."""
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    cash_id = (await _create_account(client, headers, name="Cash")).json()["id"]
    out_id, in_id = await _make_transfer_pair(client, headers, chequing_id, savings_id, transfer_id)

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [out_id, in_id],
            "direction": "reverse",
            "transfer_from": {"scope": "tracked", "account_id": cash_id},
            "transfer_to": {"scope": "tracked", "account_id": savings_id},
        },
        headers=headers,
    )

    assert resp.status_code == 200
    out_row = await _read_transaction(out_id)
    assert out_row.amount == 20000
    assert str(out_row.account_id) == savings_id
    assert str(out_row.counterparty_account_id) == cash_id
    in_row = await _read_transaction(in_id)
    assert in_row.amount == -20000
    assert str(in_row.account_id) == cash_id
    assert str(in_row.counterparty_account_id) == savings_id


async def test_bulk_transfer_ends_with_an_absolute_direction_apply_the_same_end_to_every_row(client):
    """An absolute direction makes every row's own end the same one, whatever its own sign was."""
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    cash_id = (await _create_account(client, headers, name="Cash")).json()["id"]
    out_id, in_id = await _make_transfer_pair(client, headers, chequing_id, savings_id, transfer_id)

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [out_id, in_id],
            "direction": "debit",
            "transfer_from": {"scope": "tracked", "account_id": cash_id},
            "transfer_to": {"scope": "tracked", "account_id": savings_id},
        },
        headers=headers,
    )

    assert resp.status_code == 200
    for txn_id in (out_id, in_id):
        row = await _read_transaction(txn_id)
        assert str(row.account_id) == cash_id
        assert str(row.counterparty_account_id) == savings_id
        assert row.amount < 0


async def test_bulk_transfer_from_outside_refuses_a_money_out_row(client):
    """A row cannot sit outside this app, so From cannot resolve to outside for its own end."""
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    transfer = (await _make_transfer(client, headers, chequing_id, transfer_id, savings_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [transfer], "transfer_from": {"scope": "outside"}},
        headers=headers,
    )

    assert resp.status_code == 422
    assert "1 that would sit outside this app" in resp.json()["detail"]
    assert str((await _read_transaction(transfer)).account_id) == chequing_id


async def test_bulk_transfer_from_outside_on_a_money_in_row_records_outside(client):
    """Outside is valid as a far end, so it is only refused when a row's direction makes it own."""
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    transfer = (await _make_transfer(
        client, headers, savings_id, transfer_id, chequing_id, amount=4000,
    )).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [transfer], "transfer_from": {"scope": "outside"}},
        headers=headers,
    )

    assert resp.status_code == 200
    row = await _read_transaction(transfer)
    assert str(row.account_id) == savings_id
    assert row.counterparty_account_scope == TransferCounterpartyScope.OUTSIDE
    assert row.counterparty_account_id is None


async def test_bulk_transfer_from_alone_leaves_a_selected_expense_untouched(client):
    """An end reaches only rows whose resulting category records a far side, so others sit still."""
    headers, chequing_id, category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    cash_id = (await _create_account(client, headers, name="Cash")).json()["id"]
    expense = (await _create_transaction(client, headers, chequing_id, category_id)).json()["id"]
    before = await _read_transaction(expense)
    transfer = (await _make_transfer(client, headers, chequing_id, transfer_id, savings_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [expense, transfer],
            "transfer_from": {"scope": "tracked", "account_id": cash_id},
        },
        headers=headers,
    )

    assert resp.status_code == 200
    after = await _read_transaction(expense)
    assert str(after.account_id) == chequing_id
    assert after.category_id == before.category_id
    assert after.amount == before.amount
    assert after.counterparty_account_id == before.counterparty_account_id
    assert after.counterparty_account_scope == before.counterparty_account_scope
    assert str((await _read_transaction(transfer)).account_id) == cash_id


async def test_bulk_transfer_to_alone_leaves_a_selected_balance_adjustment_untouched(client):
    """Balance Adjustment records no far side, so an end passes over it the way any far-side field does."""
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    adjustment_id = await _get_system_category_id(client, headers, "Balance Adjustment")
    adjustment = (await _create_transaction(client, headers, chequing_id, adjustment_id)).json()["id"]
    transfer = (await _create_transaction(
        client, headers, chequing_id, transfer_id, counterparty_account_scope="outside",
    )).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [adjustment, transfer],
            "transfer_to": {"scope": "tracked", "account_id": savings_id},
        },
        headers=headers,
    )

    assert resp.status_code == 200
    transfer_row = await _read_transaction(transfer)
    assert str(transfer_row.counterparty_account_id) == savings_id
    adjustment_row = await _read_transaction(adjustment)
    assert adjustment_row.counterparty_account_id is None
    assert adjustment_row.counterparty_account_scope is None


async def test_bulk_transfer_from_refuses_a_move_with_no_exchange_rate(client):
    """A tracked own end is a move, so it needs a rate across currencies exactly as a plain move does."""
    await _seed_usd_currency()
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    us_savings_id = (await _create_account(client, headers, name="US Savings", currency="USD")).json()["id"]
    transfer = (await _make_transfer(client, headers, chequing_id, transfer_id, savings_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [transfer],
            "transfer_from": {"scope": "tracked", "account_id": us_savings_id},
        },
        headers=headers,
    )

    assert resp.status_code == 422
    assert "exchange rate" in resp.json()["detail"]
    assert str((await _read_transaction(transfer)).account_id) == chequing_id


async def test_bulk_transfer_from_moves_a_row_that_carries_an_exchange_rate(client):
    """The same move is accepted once the row records a rate, exactly as a plain move is."""
    await _seed_usd_currency()
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    us_savings_id = (await _create_account(client, headers, name="US Savings", currency="USD")).json()["id"]
    transfer = (await _make_transfer(
        client, headers, chequing_id, transfer_id, savings_id, fx_rate=1.35,
    )).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [transfer],
            "transfer_from": {"scope": "tracked", "account_id": us_savings_id},
        },
        headers=headers,
    )

    assert resp.status_code == 200
    assert str((await _read_transaction(transfer)).account_id) == us_savings_id


async def test_bulk_transfer_to_records_an_account_in_another_currency(client):
    """A far end only records, so it needs no rate even where a move to it would."""
    await _seed_usd_currency()
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    us_savings_id = (await _create_account(client, headers, name="US Savings", currency="USD")).json()["id"]
    transfer = (await _make_transfer(client, headers, chequing_id, transfer_id, savings_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [transfer],
            "transfer_to": {"scope": "tracked", "account_id": us_savings_id},
        },
        headers=headers,
    )

    assert resp.status_code == 200
    row = await _read_transaction(transfer)
    assert str(row.account_id) == chequing_id
    assert str(row.counterparty_account_id) == us_savings_id


async def test_bulk_transfer_from_refuses_a_row_that_would_record_its_own_account(client):
    """An end that lands a row's far side on the account it already sits in is refused, like a move is."""
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    out_id, in_id = await _make_transfer_pair(client, headers, chequing_id, savings_id, transfer_id)

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [out_id, in_id],
            "transfer_from": {"scope": "tracked", "account_id": savings_id},
        },
        headers=headers,
    )

    assert resp.status_code == 422
    assert "2 of these transactions cannot be changed" in resp.json()["detail"]
    assert "with the same account on both sides" in resp.json()["detail"]
    assert str((await _read_transaction(out_id)).account_id) == chequing_id
    assert str((await _read_transaction(in_id)).account_id) == savings_id


async def test_bulk_transfer_from_refuses_a_move_to_an_archived_account(client):
    """An archived account takes no history, whether a move reaches it through account_id or an end."""
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    cash_id = (await _create_account(client, headers, name="Cash")).json()["id"]
    transfer = (await _make_transfer(client, headers, chequing_id, transfer_id, savings_id)).json()["id"]
    await client.patch(f"/accounts/{cash_id}", json={"is_archived": True}, headers=headers)

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [transfer],
            "transfer_from": {"scope": "tracked", "account_id": cash_id},
        },
        headers=headers,
    )

    assert resp.status_code == 422
    assert str((await _read_transaction(transfer)).account_id) == chequing_id


async def test_bulk_transfer_from_on_a_zero_amount_row_records_it_as_the_far_side(client):
    """Zero is money in, so a zero-amount transfer records From rather than moving into it."""
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    cash_id = (await _create_account(client, headers, name="Cash")).json()["id"]
    transfer = (await _make_transfer(
        client, headers, chequing_id, transfer_id, savings_id, amount=0,
    )).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [transfer],
            "transfer_from": {"scope": "tracked", "account_id": cash_id},
        },
        headers=headers,
    )

    assert resp.status_code == 200
    row = await _read_transaction(transfer)
    assert str(row.account_id) == chequing_id
    assert str(row.counterparty_account_id) == cash_id


@pytest.mark.parametrize("direction_field", ["direction", "transfer_direction"])
@pytest.mark.parametrize("direction", ["debit", "reverse"])
async def test_bulk_zero_amount_keeps_credit_end_resolution_with_a_direction(
    client,
    direction_field,
    direction,
):
    """Debit and reverse leave zero credit for resolving From, whichever direction field carries it."""
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    cash_id = (await _create_account(client, headers, name="Cash")).json()["id"]
    transfer = (await _make_transfer(
        client, headers, chequing_id, transfer_id, savings_id, amount=0,
    )).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [transfer],
            direction_field: direction,
            "transfer_from": {"scope": "tracked", "account_id": cash_id},
        },
        headers=headers,
    )

    assert resp.status_code == 200
    row = await _read_transaction(transfer)
    assert row.amount == 0
    assert str(row.account_id) == chequing_id
    assert str(row.counterparty_account_id) == cash_id


@pytest.mark.parametrize("zero_sorts_first", [True, False])
@pytest.mark.parametrize("direction_field", ["direction", "transfer_direction"])
@pytest.mark.parametrize("direction", ["debit", "reverse"])
async def test_bulk_zero_and_positive_transfers_apply_their_own_resulting_ends(
    client,
    zero_sorts_first,
    direction_field,
    direction,
):
    """A batched end write keeps each row's result when zero and positive started as credit."""
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    cash_id = (await _create_account(client, headers, name="Cash")).json()["id"]
    zero_id = (await _make_transfer(
        client, headers, chequing_id, transfer_id, savings_id, amount=0,
    )).json()["id"]
    positive_id = (await _make_transfer(
        client, headers, chequing_id, transfer_id, savings_id, amount=4000,
    )).json()["id"]
    case_offset = (
        (0 if direction_field == "direction" else 4)
        + (0 if direction == "debit" else 2)
        + (0 if zero_sorts_first else 1)
    )
    low_id = uuid.UUID(int=10_000 + case_offset)
    high_id = uuid.UUID(int=20_000 + case_offset)
    fixed_zero_id, fixed_positive_id = (
        (low_id, high_id) if zero_sorts_first else (high_id, low_id)
    )
    async with TestSession() as session:
        zero_row = await session.get(Transaction, uuid.UUID(zero_id))
        positive_row = await session.get(Transaction, uuid.UUID(positive_id))
        zero_row.id = fixed_zero_id
        positive_row.id = fixed_positive_id
        await session.commit()

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [str(fixed_zero_id), str(fixed_positive_id)],
            direction_field: direction,
            "transfer_from": {"scope": "tracked", "account_id": cash_id},
        },
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["transactions_updated"] == 2
    assert resp.json()["affected_account_ids"] == sorted([chequing_id, savings_id, cash_id])
    zero_row = await _read_transaction(str(fixed_zero_id))
    assert zero_row.amount == 0
    assert str(zero_row.account_id) == chequing_id
    assert str(zero_row.counterparty_account_id) == cash_id
    positive_row = await _read_transaction(str(fixed_positive_id))
    assert positive_row.amount == -4000
    assert str(positive_row.account_id) == cash_id
    assert str(positive_row.counterparty_account_id) == savings_id


async def test_bulk_transfer_to_on_a_zero_amount_row_moves_it_and_keeps_its_far_side(client):
    """Zero is money in, so To changes its own account and leaves the recorded From account alone."""
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    cash_id = (await _create_account(client, headers, name="Cash")).json()["id"]
    transfer = (await _make_transfer(
        client, headers, chequing_id, transfer_id, savings_id, amount=0,
    )).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [transfer],
            "transfer_to": {"scope": "tracked", "account_id": cash_id},
        },
        headers=headers,
    )

    assert resp.status_code == 200
    row = await _read_transaction(transfer)
    assert row.amount == 0
    assert str(row.account_id) == cash_id
    assert str(row.counterparty_account_id) == savings_id


async def test_bulk_transfer_from_records_a_read_only_account_without_moving_into_it(client):
    """A far end only has to be readable, since recording an account writes nothing to it."""
    admin_signup = await _create_user(client)
    admin_headers = _get_auth_header(admin_signup)
    group_id = (await client.post("/groups", json={"name": "Household"}, headers=admin_headers)).json()["id"]
    cash_id = (await _create_account(client, admin_headers, name="Cash", group_id=group_id)).json()["id"]

    member_signup = await client.post("/auth/signup", json={
        "email": "member@example.com",
        "password": "SecurePassword123!",
        "first_name": "Member",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    member_headers = _get_auth_header(member_signup)
    member_id = member_signup.json()["user"]["id"]
    await client.post(f"/groups/{group_id}/members", json={"user_id": member_id}, headers=admin_headers)
    await client.post(
        f"/accounts/{cash_id}/permissions",
        json={"user_id": member_id, "level": "read"},
        headers=admin_headers,
    )

    chequing_id = (await _create_account(client, member_headers, name="Member Chequing")).json()["id"]
    savings_id = (await _create_account(client, member_headers, name="Member Savings")).json()["id"]
    transfer_id = await _get_system_category_id(client, member_headers, "Transfer")
    transfer = (await _make_transfer(
        client, member_headers, savings_id, transfer_id, chequing_id, amount=4000,
    )).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [transfer],
            "transfer_from": {"scope": "tracked", "account_id": cash_id},
        },
        headers=member_headers,
    )

    assert resp.status_code == 200
    row = await _read_transaction(transfer)
    assert str(row.account_id) == savings_id
    assert str(row.counterparty_account_id) == cash_id


async def test_bulk_transfer_from_leaves_an_expense_out_of_the_group_write_check(client):
    """An expense resolves no end at all, so it never needs write access to the account From names."""
    admin_signup = await _create_user(client)
    admin_headers = _get_auth_header(admin_signup)
    group_id = (await client.post("/groups", json={"name": "Household"}, headers=admin_headers)).json()["id"]
    cash_id = (await _create_account(client, admin_headers, name="Cash", group_id=group_id)).json()["id"]

    member_signup = await client.post("/auth/signup", json={
        "email": "member2@example.com",
        "password": "SecurePassword123!",
        "first_name": "Member",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    member_headers = _get_auth_header(member_signup)
    member_id = member_signup.json()["user"]["id"]
    await client.post(f"/groups/{group_id}/members", json={"user_id": member_id}, headers=admin_headers)
    await client.post(
        f"/accounts/{cash_id}/permissions",
        json={"user_id": member_id, "level": "read"},
        headers=admin_headers,
    )

    chequing_id = (await _create_account(client, member_headers, name="Member Chequing")).json()["id"]
    savings_id = (await _create_account(client, member_headers, name="Member Savings")).json()["id"]
    category_id = (await _create_category(client, member_headers, name="Member Groceries")).json()["id"]
    transfer_id = await _get_system_category_id(client, member_headers, "Transfer")
    expense = (await _create_transaction(
        client, member_headers, chequing_id, category_id, amount=-1200,
    )).json()["id"]
    transfer = (await _make_transfer(
        client, member_headers, savings_id, transfer_id, chequing_id, amount=20000,
    )).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [expense, transfer],
            "transfer_from": {"scope": "tracked", "account_id": cash_id},
        },
        headers=member_headers,
    )

    assert resp.status_code == 200
    transfer_row = await _read_transaction(transfer)
    assert str(transfer_row.account_id) == savings_id
    assert str(transfer_row.counterparty_account_id) == cash_id
    expense_row = await _read_transaction(expense)
    assert str(expense_row.account_id) == chequing_id
    assert str(expense_row.category_id) == category_id


async def test_bulk_transfer_from_refuses_a_row_another_session_holds(client, monkeypatch):
    """A row another session already holds answers 409 rather than waiting behind it."""
    monkeypatch.setattr(bulk_update_module, "_BULK_UPDATE_LOCK_WAIT", "100ms")
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    cash_id = (await _create_account(client, headers, name="Cash")).json()["id"]
    transfer = (await _make_transfer(
        client, headers, chequing_id, transfer_id, savings_id, amount=-4000,
    )).json()["id"]

    # Held open for the length of the request below, which is what the request has to wait on. The
    # request is bounded so that a wait that never gives up fails this test rather than hanging it
    async with TestSession() as holder:
        await holder.execute(
            text("SELECT id FROM transactions WHERE id = :id FOR UPDATE"), {"id": uuid.UUID(transfer)},
        )
        async with asyncio.timeout(5):
            resp = await client.patch(
                "/transactions/bulk",
                json={
                    "transaction_ids": [transfer],
                    "transfer_from": {"scope": "tracked", "account_id": cash_id},
                },
                headers=headers,
            )
        await holder.rollback()

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Another change reached one of these transactions first"
    assert str((await _read_transaction(transfer)).account_id) == chequing_id


async def test_bulk_direction_reverse_refuses_a_row_another_session_holds(client, monkeypatch):
    """Reverse, which names no absolute answer, still cannot write onto a row another session holds."""
    monkeypatch.setattr(bulk_update_module, "_BULK_UPDATE_LOCK_WAIT", "100ms")
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    transfer = (await _make_transfer(
        client, headers, chequing_id, transfer_id, savings_id, amount=-4000,
    )).json()["id"]

    async with TestSession() as holder:
        await holder.execute(
            text("SELECT id FROM transactions WHERE id = :id FOR UPDATE"), {"id": uuid.UUID(transfer)},
        )
        async with asyncio.timeout(5):
            resp = await client.patch(
                "/transactions/bulk",
                json={"transaction_ids": [transfer], "direction": "reverse"},
                headers=headers,
            )
        await holder.rollback()

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Another change reached one of these transactions first"
    assert (await _read_transaction(transfer)).amount == -4000


async def test_bulk_edits_to_different_rows_in_one_account_preserve_both_balances(client, monkeypatch):
    """Overlapping edits to different rows must both save and rebuild the shared balance correctly."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    transaction_ids = []
    for amount in (-1000, -2000):
        response = await _create_transaction(
            client, headers, account_id, category_id, amount=amount, dt="2026-08-01",
        )
        assert response.status_code == 201
        transaction_ids.append(response.json()["id"])
    assert await _read_snapshots(account_id) == [(date(2026, 8, 1), -3000)]

    original_recompute = bulk_update_module.recompute_account_snapshots
    first_rebuilt = asyncio.Event()
    release_first = asyncio.Event()
    second_started = asyncio.Event()
    backend_pids = []

    async def hold_first_rebuild(db, snapshot_starts):
        """Keep the first rebuild uncommitted until the other request waits on its database lock."""
        backend_pids.append(await db.scalar(text("SELECT pg_backend_pid()")))
        if len(backend_pids) == 1:
            await original_recompute(db, snapshot_starts)
            first_rebuilt.set()
            await release_first.wait()
        else:
            second_started.set()
            await original_recompute(db, snapshot_starts)

    monkeypatch.setattr(bulk_update_module, "recompute_account_snapshots", hold_first_rebuild)
    requests = []
    try:
        async with asyncio.timeout(10):
            requests.append(asyncio.create_task(client.patch(
                "/transactions/bulk",
                json={"transaction_ids": [transaction_ids[0]], "direction": "credit"},
                headers=headers,
            )))
            await first_rebuilt.wait()
            requests.append(asyncio.create_task(client.patch(
                "/transactions/bulk",
                json={"transaction_ids": [transaction_ids[1]], "direction": "credit"},
                headers=headers,
            )))
            await second_started.wait()

            await _wait_until_blocked(backend_pids[0], backend_pids[1])
            release_first.set()
            results = await asyncio.gather(*requests, return_exceptions=True)
    finally:
        release_first.set()
        for request in requests:
            if not request.done():
                request.cancel()
        await asyncio.gather(*requests, return_exceptions=True)

    assert len(set(backend_pids)) == 2
    for result in results:
        assert not isinstance(result, BaseException), repr(result)
        assert result.status_code == 200, result.text
        assert result.json()["transactions_updated"] == 1
        assert result.json()["affected_account_ids"] == [account_id]
    assert (await _read_transaction(transaction_ids[0])).amount == 1000
    assert (await _read_transaction(transaction_ids[1])).amount == 2000
    assert await _read_snapshots(account_id) == [(date(2026, 8, 1), 3000)]
    response = await client.get(f"/accounts/{account_id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["current_balance"] == 3000


async def test_waiting_bulk_rebuild_reads_anchor_after_the_earlier_request_commits(client, monkeypatch):
    """A waiting rebuild reads the committed earlier day's balance before rebuilding later days."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    first = (await _create_transaction(
        client, headers, account_id, category_id, amount=-1000, dt="2026-08-01",
    )).json()["id"]
    second = (await _create_transaction(
        client, headers, account_id, category_id, amount=-2000, dt="2026-08-02",
    )).json()["id"]

    original_recompute = bulk_update_module.recompute_account_snapshots
    first_rebuilt = asyncio.Event()
    release_first = asyncio.Event()
    second_started = asyncio.Event()
    backend_pids = []

    async def hold_first_rebuild(db, snapshot_starts):
        """Hold the first real rebuild while the second waits for its account lock."""
        backend_pids.append(await db.scalar(text("SELECT pg_backend_pid()")))
        if len(backend_pids) == 1:
            await original_recompute(db, snapshot_starts)
            first_rebuilt.set()
            await release_first.wait()
        else:
            second_started.set()
            await original_recompute(db, snapshot_starts)

    monkeypatch.setattr(bulk_update_module, "recompute_account_snapshots", hold_first_rebuild)
    requests = []
    try:
        async with asyncio.timeout(10):
            requests.append(asyncio.create_task(client.patch(
                "/transactions/bulk",
                json={"transaction_ids": [first], "direction": "credit"},
                headers=headers,
            )))
            await first_rebuilt.wait()
            requests.append(asyncio.create_task(client.patch(
                "/transactions/bulk",
                json={"transaction_ids": [second], "direction": "credit"},
                headers=headers,
            )))
            await second_started.wait()
            await _wait_until_blocked(backend_pids[0], backend_pids[1])
            release_first.set()
            results = await asyncio.gather(*requests, return_exceptions=True)
    finally:
        release_first.set()
        for request in requests:
            if not request.done():
                request.cancel()
        await asyncio.gather(*requests, return_exceptions=True)

    for result in results:
        assert not isinstance(result, BaseException), repr(result)
        assert result.status_code == 200, result.text
    assert await _read_snapshots(account_id) == [
        (date(2026, 8, 1), 1000),
        (date(2026, 8, 2), 3000),
    ]


async def test_reverse_account_maps_wait_on_the_same_first_lock(client, monkeypatch):
    """Bulk and single moves lock the same first account despite reversed source maps."""
    headers, first_account_id, category_id = await _setup_user_with_deps(client)
    second_account_id = (await _create_account(client, headers, name="Savings")).json()["id"]
    first_transaction = (await _create_transaction(
        client, headers, first_account_id, category_id, amount=-1000, dt="2026-08-01",
    )).json()["id"]
    second_transaction = (await _create_transaction(
        client, headers, second_account_id, category_id, amount=-2000, dt="2026-08-01",
    )).json()["id"]

    controlled_keys = {
        uuid.UUID(first_account_id): 1,
        uuid.UUID(second_account_id): 2,
    }

    def controlled_lock_key(account_id):
        """Give the two accounts predictable increasing advisory keys."""
        return controlled_keys[account_id]

    monkeypatch.setattr(account_snapshots_module, "_snapshot_lock_key", controlled_lock_key)
    original_recompute = bulk_update_module.recompute_account_snapshots
    first_locked = asyncio.Event()
    release_first = asyncio.Event()
    backend_pids = []

    async def pause_first_request_after_first_lock(db, snapshot_starts):
        """Pause the first request after acquiring its real first advisory lock."""
        backend_pids.append(await db.scalar(text("SELECT pg_backend_pid()")))
        if len(backend_pids) == 1:
            first_key = min(controlled_keys[account_id] for account_id in snapshot_starts)
            await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": first_key})
            first_locked.set()
            await release_first.wait()
        await original_recompute(db, snapshot_starts)

    monkeypatch.setattr(
        bulk_update_module,
        "recompute_account_snapshots",
        pause_first_request_after_first_lock,
    )
    monkeypatch.setattr(
        transaction_snapshots_module,
        "recompute_account_snapshots",
        pause_first_request_after_first_lock,
    )

    requests = []
    try:
        async with asyncio.timeout(10):
            requests.append(asyncio.create_task(client.patch(
                "/transactions/bulk",
                json={"transaction_ids": [first_transaction], "account_id": second_account_id},
                headers=headers,
            )))
            await first_locked.wait()
            requests.append(asyncio.create_task(client.patch(
                f"/transactions/{second_transaction}",
                json={"account_id": first_account_id},
                headers=headers,
            )))
            async with asyncio.timeout(5):
                while len(backend_pids) < 2:
                    await asyncio.sleep(0)
            await _wait_until_blocked(backend_pids[0], backend_pids[1])
            release_first.set()
            results = await asyncio.gather(*requests, return_exceptions=True)
    finally:
        release_first.set()
        for request in requests:
            if not request.done():
                request.cancel()
        await asyncio.gather(*requests, return_exceptions=True)

    for result in results:
        assert not isinstance(result, BaseException), repr(result)
        assert result.status_code == 200, result.text
    assert await _read_snapshots(first_account_id) == [(date(2026, 8, 1), -2000)]
    assert await _read_snapshots(second_account_id) == [(date(2026, 8, 1), -1000)]


async def test_bulk_move_of_last_transaction_restores_source_zero_anchor(client):
    """Moving the source's last row restores its creation-day zero snapshot."""
    headers, source_id, category_id = await _setup_user_with_deps(client)
    target_id = (await _create_account(client, headers, name="Savings")).json()["id"]
    transaction_id = (await _create_transaction(
        client, headers, source_id, category_id, amount=-1000, dt="2026-08-01",
    )).json()["id"]

    response = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [transaction_id], "account_id": target_id},
        headers=headers,
    )

    assert response.status_code == 200
    source_snapshots = await _read_snapshots(source_id)
    assert len(source_snapshots) == 1
    assert source_snapshots[0][1] == 0
    assert await _read_snapshots(target_id) == [(date(2026, 8, 1), -1000)]


async def test_bulk_date_move_rebuilds_from_earlier_date_without_stale_snapshot(client):
    """Moving a row to an earlier date removes its old later-day snapshot."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    transaction_id = (await _create_transaction(
        client, headers, account_id, category_id, amount=-1000, dt="2026-08-02",
    )).json()["id"]

    response = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [transaction_id], "dt": "2026-08-01"},
        headers=headers,
    )

    assert response.status_code == 200
    assert await _read_snapshots(account_id) == [(date(2026, 8, 1), -1000)]


async def test_bulk_note_only_edit_skips_snapshot_rebuild(client, monkeypatch):
    """Changing only a note does not enter the snapshot rebuild path."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    transaction_id = (await _create_transaction(
        client, headers, account_id, category_id, amount=-1000, dt="2026-08-01",
    )).json()["id"]

    async def refuse_rebuild(_db, _snapshot_starts):
        """Fail if a note-only request reaches snapshot recomputation."""
        raise AssertionError("note-only edit rebuilt account snapshots")

    monkeypatch.setattr(bulk_update_module, "recompute_account_snapshots", refuse_rebuild)

    response = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [transaction_id], "notes": "Corrected"},
        headers=headers,
    )

    assert response.status_code == 200
    assert (await _read_transaction(transaction_id)).notes == "Corrected"


async def test_concurrent_create_waits_for_bulk_rebuild_and_preserves_total(client, monkeypatch):
    """A create waiting on a bulk rebuild contributes to the final account balance."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    transaction_id = (await _create_transaction(
        client, headers, account_id, category_id, amount=-1000, dt="2026-08-01",
    )).json()["id"]

    async def create_other_transaction():
        """Create the second transaction through the real route."""
        return await _create_transaction(
            client,
            headers,
            account_id,
            category_id,
            amount=-2000,
            dt="2026-08-01",
        )

    bulk_response, create_response = await _run_bulk_with_blocked_writer(
        client,
        headers,
        transaction_id,
        monkeypatch,
        creation_module,
        create_other_transaction,
    )

    assert bulk_response.status_code == 200, bulk_response.text
    assert create_response.status_code == 201, create_response.text
    assert await _read_snapshots(account_id) == [(date(2026, 8, 1), -1000)]
    assert await _read_transaction_total(account_id) == -1000


async def test_concurrent_delete_waits_for_bulk_rebuild_and_preserves_total(client, monkeypatch):
    """A delete waiting on a bulk rebuild is reflected in the final account balance."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    transaction_id = (await _create_transaction(
        client, headers, account_id, category_id, amount=-1000, dt="2026-08-01",
    )).json()["id"]
    deleted_id = (await _create_transaction(
        client, headers, account_id, category_id, amount=-2000, dt="2026-08-01",
    )).json()["id"]

    async def delete_other_transaction():
        """Delete the second transaction through the real route."""
        return await client.delete(f"/transactions/{deleted_id}", headers=headers)

    bulk_response, delete_response = await _run_bulk_with_blocked_writer(
        client,
        headers,
        transaction_id,
        monkeypatch,
        deletion_module,
        delete_other_transaction,
    )

    assert bulk_response.status_code == 200, bulk_response.text
    assert delete_response.status_code == 204, delete_response.text
    assert await _read_snapshots(account_id) == [(date(2026, 8, 1), 1000)]
    assert await _read_transaction_total(account_id) == 1000


async def test_concurrent_generic_import_waits_for_bulk_rebuild_and_preserves_total(
    client, monkeypatch,
):
    """A generic import waiting on a bulk rebuild contributes to the final balance."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    transaction_id = (await _create_transaction(
        client, headers, account_id, category_id, amount=-1000, dt="2026-08-01",
    )).json()["id"]

    async def import_other_transaction():
        """Import the second transaction through the real staged-import route."""
        return await _import_transactions(client, headers, {
            "accounts": [{"source": "Main Chequing", "account_id": account_id}],
            "categories": [{"source": "Groceries", "category_id": category_id}],
            "rows": [{
                "account_source": "Main Chequing",
                "category_source": "Groceries",
                "dt": "2026-08-01",
                "amount": "-20.00",
                "merchant_name": "Neighbourhood Market",
                "tag_names": [],
            }],
        })

    bulk_response, import_response = await _run_bulk_with_blocked_writer(
        client,
        headers,
        transaction_id,
        monkeypatch,
        generic_import_module,
        import_other_transaction,
    )

    assert bulk_response.status_code == 200, bulk_response.text
    assert import_response.status_code == 201, import_response.text
    assert await _read_snapshots(account_id) == [(date(2026, 8, 1), -1000)]
    assert await _read_transaction_total(account_id) == -1000


async def test_concurrent_firefly_import_waits_for_bulk_rebuild_and_preserves_total(
    client, monkeypatch,
):
    """A Firefly import waiting on a bulk rebuild contributes to the final balance."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    transaction_id = (await _create_transaction(
        client, headers, account_id, category_id, amount=-1000, dt="2026-08-01",
    )).json()["id"]

    async def import_other_transaction():
        """Import the second transaction through the real Firefly route."""
        return await client.post("/transactions/import/firefly", json={
            "accounts": [{"source": "Main Chequing", "account_id": account_id}],
            "categories": [{"source": "Groceries", "category_id": category_id}],
            "rows": [{
                "journal_id": "bulk-concurrency",
                "type": "Withdrawal",
                "dt": "2026-08-01",
                "amount": "-20.00",
                "currency_code": "CAD",
                "description": "Weekly groceries",
                "source_name": "Main Chequing",
                "source_type": "Asset account",
                "destination_name": "Neighbourhood Market",
                "destination_type": "Expense account",
                "category": "Groceries",
                "tag_names": [],
            }],
        }, headers=headers)

    bulk_response, import_response = await _run_bulk_with_blocked_writer(
        client,
        headers,
        transaction_id,
        monkeypatch,
        firefly_import_module,
        import_other_transaction,
    )

    assert bulk_response.status_code == 200, bulk_response.text
    assert import_response.status_code == 201, import_response.text
    assert await _read_snapshots(account_id) == [(date(2026, 8, 1), -1000)]
    assert await _read_transaction_total(account_id) == -1000


async def test_bulk_direction_reverse_with_no_other_session_flips_the_stored_amount(client):
    """With nothing else holding the row, reverse still flips its stored amount as it always did."""
    headers, chequing_id, _category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    transfer = (await _make_transfer(
        client, headers, chequing_id, transfer_id, savings_id, amount=-20000,
    )).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [transfer], "direction": "reverse"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert (await _read_transaction(transfer)).amount == 20000


async def _setup_transfer_into_a_group_account(client):
    """Put a member's transfer in their own account, recording a group account they can reach.

    The member is granted write access first so the transfer can be recorded, which is what a real
    one looks like before access is narrowed.
    """
    admin_signup = await _create_user(client)
    admin_headers = _get_auth_header(admin_signup)
    group_id = (await client.post("/groups", json={"name": "Smith Family"}, headers=admin_headers)).json()["id"]
    shared_id = (await _create_account(
        client, admin_headers, name="Shared Savings", group_id=group_id,
    )).json()["id"]

    member_signup = await client.post("/auth/signup", json={
        "email": "member@example.com",
        "password": "SecurePassword123!",
        "first_name": "Member",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    member_headers = _get_auth_header(member_signup)
    member_id = member_signup.json()["user"]["id"]
    await client.post(f"/groups/{group_id}/members", json={"user_id": member_id}, headers=admin_headers)
    await client.post(
        f"/accounts/{shared_id}/permissions",
        json={"user_id": member_id, "level": "write"},
        headers=admin_headers,
    )

    own_account_id = (await _create_account(client, member_headers, name="Member Chequing")).json()["id"]
    own_category_id = (await _create_category(client, member_headers, name="Member Groceries")).json()["id"]
    transfer_id = await _get_system_category_id(client, member_headers, "Transfer")
    transfer = (await _create_transaction(
        client,
        member_headers,
        own_account_id,
        transfer_id,
        counterparty_account_id=shared_id,
        counterparty_account_scope="tracked",
    )).json()["id"]

    return (
        admin_headers, member_headers, member_id, group_id, shared_id,
        own_account_id, own_category_id, transfer,
    )


async def test_bulk_transfer_from_refuses_a_group_account_the_caller_cannot_write(client):
    """An own end writes into the account it names, so reading it is not enough."""
    admin_headers, member_headers, member_id, _group_id, shared_id, own_account_id, _cat, transfer = (
        await _setup_transfer_into_a_group_account(client)
    )
    await client.post(
        f"/accounts/{shared_id}/permissions",
        json={"user_id": member_id, "level": "read"},
        headers=admin_headers,
    )

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [transfer],
            "transfer_from": {"scope": "tracked", "account_id": shared_id},
        },
        headers=member_headers,
    )

    assert resp.status_code == 403
    assert str((await _read_transaction(transfer)).account_id) == own_account_id


async def test_bulk_transfer_from_checks_a_chosen_category_against_the_group_it_lands_in(client):
    """An end leaves its source account behind, so only the group it lands in has to reach the category."""
    admin_headers, member_headers, _member_id, group_id, shared_id, own_account_id, _own_cat, transfer = (
        await _setup_transfer_into_a_group_account(client)
    )

    # Owned by the group, so it reaches the account the row lands in and nothing else. Checking it
    # against the personal account the row is leaving as well would turn a valid request down
    family_transfer = (await _create_category(
        client, admin_headers, name="Family Transfer", kind="transfer", group_id=group_id,
    )).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [transfer],
            "transfer_from": {"scope": "tracked", "account_id": shared_id},
            "transfer_to": {"scope": "tracked", "account_id": own_account_id},
            "category_id": family_transfer,
        },
        headers=member_headers,
    )

    assert resp.status_code == 200
    row = await _read_transaction(transfer)
    assert str(row.category_id) == family_transfer
    assert str(row.account_id) == shared_id
    assert str(row.counterparty_account_id) == own_account_id


async def test_bulk_direction_turns_a_row_the_way_it_is_asked(client):
    """Setting money in makes every amount positive and rebuilds the balance behind it."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    first = (await _create_transaction(
        client, headers, account_id, category_id, dt="2026-08-01", amount=-4000,
    )).json()["id"]
    await _create_transaction(client, headers, account_id, category_id, dt="2026-08-10", amount=-800)

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [first], "direction": "credit"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert (await _read_transaction(first)).amount == 4000
    assert [(dt, balance) for dt, balance in await _read_snapshots(account_id)] == [
        (date(2026, 8, 1), 4000),
        (date(2026, 8, 10), 3200),
    ]


async def test_bulk_direction_leaves_a_row_already_pointing_that_way(client):
    """Money out on a row that already goes out changes nothing."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    row = (await _create_transaction(client, headers, account_id, category_id, amount=-4000)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [row], "direction": "debit"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert (await _read_transaction(row)).amount == -4000


async def test_bulk_direction_applies_to_every_kind(client):
    """Direction is the sign of the amount, which a transfer and an expense both carry."""
    headers, account_id, category_id, other_account_id, transfer_id = await _setup_transfer_user(client)
    expense = (await _create_transaction(client, headers, account_id, category_id, amount=5000)).json()["id"]
    transfer = (await _make_transfer(
        client, headers, account_id, transfer_id, other_account_id, amount=4000,
    )).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [expense, transfer], "direction": "debit"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert (await _read_transaction(expense)).amount == -5000
    assert (await _read_transaction(transfer)).amount == -4000


async def test_bulk_update_refuses_a_null_direction(client):
    """Direction writes a sign, so it has no null to write."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    row = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [row], "direction": None},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_bulk_direction_reverse_turns_an_expense_around(client):
    """Reverse is not limited to transfers, and an expense flips exactly as a set direction allows."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    row = (await _create_transaction(client, headers, account_id, category_id, amount=-4000)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [row], "direction": "reverse"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert (await _read_transaction(row)).amount == 4000


async def test_bulk_direction_leaves_a_zero_amount_alone(client):
    """A zero amount has no sign to set, so a direction leaves it as it is."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    row = (await _create_transaction(client, headers, account_id, category_id, amount=0)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [row], "direction": "debit"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert (await _read_transaction(row)).amount == 0


async def test_bulk_direction_leaves_the_accounts_alone(client):
    """Direction writes a sign and nothing else, so a transfer stays where it is and keeps its far side."""
    headers, account_id, _category_id, other_account_id, transfer_id = await _setup_transfer_user(client)
    transfer = (await _make_transfer(
        client, headers, account_id, transfer_id, other_account_id, amount=4000,
    )).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [transfer], "direction": "debit"},
        headers=headers,
    )

    assert resp.status_code == 200
    row = await _read_transaction(transfer)
    assert row.amount == -4000
    assert str(row.account_id) == account_id
    assert str(row.counterparty_account_id) == other_account_id
    assert row.counterparty_account_scope is TransferCounterpartyScope.TRACKED


# --- transfer_direction, applied only to the rows recording a far side ---


async def test_bulk_transfer_direction_turns_only_the_transfer_and_leaves_the_expense(client):
    """transfer_direction reaches the transfer and skips a plain expense in the same selection."""
    headers, chequing_id, category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    transfer = (await _make_transfer(
        client, headers, chequing_id, transfer_id, savings_id, dt="2026-08-23", amount=-20000,
    )).json()["id"]
    expense = (
        await _create_transaction(client, headers, savings_id, category_id, dt="2026-08-22", amount=-1200)
    ).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [transfer, expense], "transfer_direction": "credit"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert (await _read_transaction(transfer)).amount == 20000
    assert (await _read_transaction(expense)).amount == -1200
    assert dict(await _read_snapshots(chequing_id))[date(2026, 8, 23)] == 20000


async def test_bulk_transfer_direction_combines_with_an_end_on_the_row_it_reaches(client):
    """transfer_from sets the far side transfer_direction resolves to, and stays off the expense."""
    headers, chequing_id, category_id, savings_id, transfer_id = await _setup_transfer_user(client)
    cash_id = (await _create_account(client, headers, name="Cash")).json()["id"]
    transfer = (await _make_transfer(
        client, headers, chequing_id, transfer_id, savings_id, dt="2026-08-23", amount=-20000,
    )).json()["id"]
    expense = (
        await _create_transaction(client, headers, savings_id, category_id, dt="2026-08-22", amount=-1200)
    ).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [transfer, expense],
            "transfer_direction": "credit",
            "transfer_from": {"scope": "tracked", "account_id": cash_id},
        },
        headers=headers,
    )

    assert resp.status_code == 200
    transfer_row = await _read_transaction(transfer)
    assert transfer_row.amount == 20000
    assert str(transfer_row.account_id) == chequing_id
    assert str(transfer_row.counterparty_account_id) == cash_id
    expense_row = await _read_transaction(expense)
    assert expense_row.amount == -1200
    assert str(expense_row.account_id) == savings_id


async def test_bulk_update_refuses_direction_and_transfer_direction_together(client):
    """Both set the sign of the same amount, so sending both is two answers for one column."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "direction": "credit", "transfer_direction": "credit"},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_bulk_update_refuses_a_null_transfer_direction(client):
    """transfer_direction writes a sign like direction does, so it has no null to write."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "transfer_direction": None},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_bulk_transfer_direction_refuses_a_selection_with_no_transfer(client):
    """transfer_direction reaches only rows recording a far side, so two expenses reach none."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    first = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    second = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [first, second], "transfer_direction": "credit"},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == (
        "The direction applies to transfers only, and none of the selected transactions end up as one"
    )


async def test_bulk_transfer_direction_with_an_end_refuses_a_selection_with_no_transfer(client):
    """An end sent alongside the direction keeps the From and To wording, since an end was sent."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    cash_id = (await _create_account(client, headers, name="Cash")).json()["id"]
    first = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    second = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [first, second],
            "transfer_direction": "credit",
            "transfer_from": {"scope": "tracked", "account_id": cash_id},
        },
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == (
        "From and To apply to transfers only, and none of the selected transactions end up as one"
    )
