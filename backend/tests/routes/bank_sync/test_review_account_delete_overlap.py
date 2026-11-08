"""Deleting an account while a bank sync change to it is saving

The change is held where it has written its changes, an account delete queues behind it on the
database, then the change is released. It must answer before the delete takes the account and
everything in it, rather than reading the row after the delete has removed it. That covers the
review decisions and the changes to an account's bank link.
"""

import asyncio
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_transaction import BankTransactionDisposition, OpenReviewKind
from app.routes.accounts import deletion_helpers as account_deletion_module
from app.services.bank_sync import account_link, history_reminder, import_range, links, opening_adjustment, review_decisions
from tests.routes.bank_sync.test_history_reminder import _CUT_SHORT, _FELL_SHORT, _SHOWN
from tests.routes.bank_sync.test_history_reminder import _linked_everyday as _history_everyday
from tests.routes.bank_sync.test_link import _linkable
from tests.routes.bank_sync.test_opening_adjustment import _offering_everyday
from tests.routes.support.bank_sync_helpers import BANK_DATE, _commit_review_item
from tests.routes.support.lock_helpers import _held_request, _overlap, _pid, _record_pid
from tests.routes.support.manual_entry_helpers import _Ledger, _ledger
from tests.routes.support.merchant_helpers import _get_system_merchant_id
from tests.routes.support.transaction_helpers import _create_transaction

# Noon UTC on October 5, a morning in Toronto, the zone the tests sign up in
_NOW = datetime(2026, 10, 5, 12, 0, tzinfo=UTC)

# Each review decision and the step it takes just before it commits
_DECISIONS = [
    ("add", "mark_user_cache_changed"),
    ("accept-change", "mark_user_cache_changed"),
    ("keep-current", "mark_user_status_changed"),
    ("keep-transaction", "mark_user_status_changed"),
    ("restore", "mark_user_cache_changed"),
]


@pytest.fixture(autouse=True)
def _pinned_now(pin_clock):
    """Pin the time the link routes read"""
    pin_clock(_NOW, links, import_range, account_link)


async def _commit_item(client, ledger: _Ledger, decision: str) -> tuple[str, dict | None]:
    """Commit the bank item the decision acts on, returning the path that decides it and its body"""
    if decision == "add":
        merchant_id = await _get_system_merchant_id(client, ledger.headers)
        payload = {"dt": BANK_DATE.isoformat(), "amount": -2340, "merchant_id": merchant_id, "category_id": ledger.category_id}
        item_id = await _commit_review_item(ledger.everyday_id, observed_amount=-2340)
        return f"/bank-review/items/{item_id}/add", payload

    created = await _create_transaction(client, ledger.headers, ledger.everyday_id, ledger.category_id, dt=BANK_DATE.isoformat(), amount=-4000)
    assert created.status_code == 201, created.text
    values = {
        "disposition": BankTransactionDisposition.ACCEPTED,
        "transaction_id": uuid.UUID(created.json()["id"]),
        "observed_amount": -4210,
        "aligned_date": BANK_DATE,
        "aligned_amount": -4210,
    }
    if decision in ("accept-change", "keep-current"):
        values |= {"open_kind": OpenReviewKind.CORRECTION, "previous_values": {"amount": -4000}}
    if decision == "keep-transaction":
        values |= {"open_kind": OpenReviewKind.REMOVAL, "removed_at": datetime(2026, 10, 4, 9, tzinfo=UTC)}
    item_id = await _commit_review_item(ledger.everyday_id, **values)
    if decision == "restore":
        return f"/bank-sync/transaction-sources/{created.json()['id']}/restore", {"field": "amount"}
    return f"/bank-review/items/{item_id}/{decision}", None


async def _delete_while_saving(client, monkeypatch, module, step, headers, account_id, path, body, status):
    """Hold the change at the step before its commit, queue a delete of the account behind it, then release both"""
    held, release, entered, deleted = asyncio.Event(), asyncio.Event(), asyncio.Event(), asyncio.Event()
    pids = []
    original_step = getattr(module, step)
    original_commit = AsyncSession.commit

    async def hold_before_the_step(db, *args, **kwargs):
        if _held_request.get():
            pids.append(await _pid(db))
            held.set()
            await release.wait()
        return await original_step(db, *args, **kwargs)

    async def commit_then_wait_for_the_delete(session):
        await original_commit(session)
        # The delete goes ahead the moment this commits, so the change answers only once the
        # account and the rows it saved are gone
        if _held_request.get():
            await deleted.wait()

    async def change():
        _held_request.set(True)
        return await client.post(path, json=body, headers=headers)

    async def delete_account():
        try:
            return await client.delete(f"/accounts/{account_id}", headers=headers)
        finally:
            deleted.set()

    monkeypatch.setattr(module, step, hold_before_the_step)
    monkeypatch.setattr(AsyncSession, "commit", commit_then_wait_for_the_delete)
    _record_pid(monkeypatch, account_deletion_module, "check_account_access", pids, entered)

    changed, removed = await _overlap(change, delete_account, first_held=held, release=release, second_entered=entered, pids=pids)

    assert changed.status_code == status, changed.text
    assert removed.status_code == 204, removed.text
    assert (await client.get(f"/accounts/{account_id}", headers=headers)).status_code == 404


@pytest.mark.parametrize(("decision", "step"), _DECISIONS)
async def test_an_account_delete_waits_for_a_review_decision_saving_to_the_account_and_the_decision_still_answers(
    client, monkeypatch, decision, step
):
    """The decision commits and answers with its transaction, then the delete takes the account."""
    ledger = await _ledger(client)
    path, body = await _commit_item(client, ledger, decision)

    await _delete_while_saving(
        client, monkeypatch, review_decisions, step, ledger.headers, ledger.everyday_id, path, body, 201 if decision == "add" else 200
    )


@pytest.mark.parametrize("change", ["link", "dismiss-history-reminder", "dismiss-cut-off-day", "record-opening-adjustment"])
async def test_an_account_delete_waits_for_a_bank_link_change_saving_to_the_account_and_the_change_still_answers(client, monkeypatch, change):
    """The link change commits and answers with the link, then the delete takes the account."""
    if change == "link":
        headers, _, account_id, connection = await _linkable(client)
        module, step, status = links, "mark_user_cache_changed", 201
        path = f"/accounts/{account_id}/bank-link"
        body = {"connection_id": str(connection.id), "external_account_id": "ACT-1", "start_date": "2026-09-05"}
    elif change == "record-opening-adjustment":
        everyday = await _offering_everyday(client, ("2026-09-15", 100000))
        headers, account_id = everyday.headers, everyday.account_id
        module, step, status = opening_adjustment, "mark_user_cache_changed", 200
        path, body = f"/accounts/{account_id}/bank-link/opening-adjustment/record", {"amount": 25000}
    else:
        history = change == "dismiss-history-reminder"
        headers, account_id, _ = await _history_everyday(client, **(_FELL_SHORT if history else _CUT_SHORT))
        module, step, status = history_reminder, "mark_user_status_changed", 200
        path = f"/accounts/{account_id}/bank-link/" + ("history-reminder" if history else "cut-off-day") + "/dismiss"
        body = _SHOWN if history else {"day": "2026-10-02"}

    await _delete_while_saving(client, monkeypatch, module, step, headers, account_id, path, body, status)
