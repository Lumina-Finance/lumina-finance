"""Dismissing a new bank item

A dismissed item keeps only its identity and the dismissal, enough to stay dismissed when the bank
sends it again, so the bank's values are cleared. It changes nothing in the ledger, so a file
imported just before it can still be undone. A double-clicked Dismiss dismisses it once, and
only the user's own items on their own personal accounts can be dismissed. A dismissal that leaves
50 or fewer new items waiting resumes the account's paused sync at once. One that took the item
before the link could deadlock with a sync storing it, and one that took the link before the
connection with a disconnect
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection
from app.models.bank_transaction import OBSERVATION_COLUMNS, BankTransaction, BankTransactionDisposition, OpenReviewKind
from app.services.bank_sync import review_pause
from app.services.bank_sync.transaction_hash import hash_bank_transaction_id
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    BANK_ACCOUNT_ID,
    EMPTY_REVIEW_PAGE,
    _build_category,
    _build_ledger_transaction,
    _changed_at,
    _commit_other_users_account,
    _commit_paused_link,
    _commit_review_item,
    _commit_waiting_items,
    _import_a_file,
    _new_account,
    _new_group_account,
    _pause_state,
    _review_page,
    _sign_up,
    _stored_item,
    _undoable_import,
)
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.routes.support.query_helpers import _recorded_statements, _writes
from tests.services.bank_sync.fake_provider import FAKE_PROVIDER

# The instant a lifted pause makes the account due at, as its clock is pinned
_NOW = datetime(2026, 10, 4, 9, 0, tzinfo=UTC)


async def _dismiss(client, headers, item_id: uuid.UUID):
    """Dismiss the item through the route"""
    return await client.post(f"/bank-review/items/{item_id}/dismiss", headers=headers)


async def test_dismissing_keeps_only_the_items_identity_and_leaves_the_inbox(client):
    """HARBOUR COFFEE 0412 leaves the list with its bank values cleared and its identity kept, and the cache mark is the last write"""
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    item_id = await _commit_review_item(account_id)
    before = await _changed_at(client, headers)

    with _recorded_statements() as statements:
        dismissed = await _dismiss(client, headers, item_id)

    assert dismissed.status_code == 204, dismissed.text
    assert dismissed.content == b""
    stored = await _stored_item(item_id)
    assert (stored.account_id, stored.provider, stored.external_account_id, stored.external_transaction_hash, stored.disposition) == (
        uuid.UUID(account_id),
        FAKE_PROVIDER,
        BANK_ACCOUNT_ID,
        hash_bank_transaction_id(FAKE_PROVIDER, BANK_ACCOUNT_ID, "TRN-1001"),
        BankTransactionDisposition.DISMISSED,
    )
    assert {column: getattr(stored, column) for column in OBSERVATION_COLUMNS} == dict.fromkeys(OBSERVATION_COLUMNS)
    assert stored.transaction_id is None
    assert await _review_page(client, headers) == EMPTY_REVIEW_PAGE
    assert await _changed_at(client, headers) != before
    assert "user_cache_states" in _writes(statements)[-1]


async def test_dismissing_leaves_a_file_imported_just_before_undoable(client):
    """A dismissal changes nothing in the ledger, so the Wallet file imported before it can still be undone"""
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    item_id = await _commit_review_item(account_id)
    await _import_a_file(client, headers)
    assert await _undoable_import(client, headers) is not None

    dismissed = await _dismiss(client, headers, item_id)

    assert dismissed.status_code == 204, dismissed.text
    assert await _undoable_import(client, headers) is not None


async def test_a_double_clicked_dismiss_dismisses_the_item_once(client):
    """Both requests queue behind the item and both answer done, and the second writes nothing"""
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    item_id = await _commit_review_item(account_id)

    async with asyncio.timeout(10), TestSession() as holder:
        await holder.execute(select(BankTransaction.id).where(BankTransaction.id == item_id).with_for_update())
        holder_pid = await holder.scalar(select(func.pg_backend_pid()))
        both = asyncio.gather(_dismiss(client, headers, item_id), _dismiss(client, headers, item_id))
        await _wait_until_waiting_on(holder_pid, both, waiters=2)
        await holder.commit()
        first, second = await both

    assert (first.status_code, second.status_code) == (204, 204), (first.text, second.text)
    stored = await _stored_item(item_id)
    assert stored.disposition == BankTransactionDisposition.DISMISSED

    # The item started at version 1, and only one dismissal wrote it
    assert stored.version == 2


async def test_dismissing_an_item_already_in_the_ledger_is_refused(client):
    """A correction waiting on an accepted transaction can't be dismissed, which would orphan its ledger row"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(account_id))
        category = _build_category(user_id)
        session.add(category)
        await session.flush()
        txn = _build_ledger_transaction(account, category.id)
        session.add(txn)
        await session.commit()
    item_id = await _commit_review_item(
        account_id,
        disposition=BankTransactionDisposition.ACCEPTED,
        transaction_id=txn.id,
        aligned_date=txn.dt,
        aligned_amount=txn.amount,
        observed_amount=-1300,
        open_kind=OpenReviewKind.CORRECTION,
        previous_values={"amount": -1250},
    )

    refused = await _dismiss(client, headers, item_id)

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == "This item is already in the ledger, so it can't be dismissed"
    assert (await _stored_item(item_id)).disposition == BankTransactionDisposition.ACCEPTED


async def test_dismissing_another_users_item_or_one_on_a_group_account_is_not_found(client):
    """Neither item is the user's own on their own personal account, so both read as not found and stay"""
    headers, user_id = await _sign_up(client)
    theirs = await _commit_other_users_account()
    their_item = await _commit_review_item(theirs.id)
    joint_id = await _new_group_account(client, headers)
    joint_item = await _commit_review_item(joint_id, owner_id=user_id)

    responses = [await _dismiss(client, headers, item_id) for item_id in (their_item, joint_item)]

    assert [(response.status_code, response.json()["detail"]) for response in responses] == [(404, "Review item not found")] * 2
    assert [(await _stored_item(item_id)).disposition for item_id in (their_item, joint_item)] == [
        BankTransactionDisposition.AWAITING_REVIEW
    ] * 2


@pytest.mark.parametrize(
    ("waiting", "pause_state"),
    [(52, (True, _NOW + timedelta(days=1), [])), (51, (False, _NOW, ["scheduled"]))],
    ids=["leaves_51", "leaves_50"],
)
async def test_a_dismissal_leaving_50_new_items_waiting_resumes_the_paused_sync_at_once(client, pin_clock, waiting, pause_state):
    """Everyday is paused for review with HARBOUR COFFEE 0412 among its new items waiting, its next sync set for tomorrow

    Dismissing it leaves 51, which stays paused, or 50, which lifts the pause, makes Everyday due now
    and queues its connection's sync, with the cache mark still the last write
    """
    pin_clock(_NOW, review_pause)
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    link = await _commit_paused_link(account_id, _NOW)
    item_id = await _commit_review_item(account_id)
    await _commit_waiting_items(link, waiting - 1)

    with _recorded_statements() as statements:
        dismissed = await _dismiss(client, headers, item_id)

    assert dismissed.status_code == 204, dismissed.text
    assert await _pause_state(link) == pause_state
    assert "user_cache_states" in _writes(statements)[-1]


async def test_a_dismissal_waits_for_a_sync_holding_the_link_before_locking_the_item(client):
    """A sync holds Everyday's link, as it does while storing the bank's values: the dismissal waits for it without holding the item

    So the sync can still lock the item, as storing it does, rather than the two waiting on each other
    """
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    link = await _commit_paused_link(account_id, _NOW)
    item_id = await _commit_review_item(account_id)

    async with asyncio.timeout(10), TestSession() as syncing:
        await syncing.execute(select(BankAccountLink.id).where(BankAccountLink.id == link.id).with_for_update())
        syncing_pid = await syncing.scalar(select(func.pg_backend_pid()))
        dismissing = asyncio.create_task(_dismiss(client, headers, item_id))
        await _wait_until_waiting_on(syncing_pid, dismissing)
        await syncing.execute(select(BankTransaction.id).where(BankTransaction.id == item_id).with_for_update(nowait=True))
        await syncing.commit()
        dismissed = await dismissing

    assert dismissed.status_code == 204, dismissed.text
    assert (await _stored_item(item_id)).disposition == BankTransactionDisposition.DISMISSED


async def test_a_dismissal_that_queues_a_sync_waits_for_a_disconnect_holding_the_connection_before_locking_the_link(client, pin_clock):
    """Everyday is paused for review, and a disconnect of its connection holds the connection, as it does before the links

    Dismissing HARBOUR COFFEE 0412 leaves 50, so the dismissal queues a sync, which needs the
    connection: it waits for the disconnect without holding the link, so the disconnect can still
    lock it rather than the two waiting on each other, then lifts the pause
    """
    pin_clock(_NOW, review_pause)
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    link = await _commit_paused_link(account_id, _NOW)
    item_id = await _commit_review_item(account_id)
    await _commit_waiting_items(link, 50)

    async with asyncio.timeout(10), TestSession() as disconnecting:
        await disconnecting.execute(select(BankConnection.id).where(BankConnection.id == link.connection_id).with_for_update())
        disconnecting_pid = await disconnecting.scalar(select(func.pg_backend_pid()))
        dismissing = asyncio.create_task(_dismiss(client, headers, item_id))
        await _wait_until_waiting_on(disconnecting_pid, dismissing)
        await disconnecting.execute(select(BankAccountLink.id).where(BankAccountLink.id == link.id).with_for_update(nowait=True))
        await disconnecting.commit()
        dismissed = await dismissing

    assert dismissed.status_code == 204, dismissed.text
    assert await _pause_state(link) == (False, _NOW, ["scheduled"])
