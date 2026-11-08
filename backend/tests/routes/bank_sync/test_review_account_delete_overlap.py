"""Deleting an account while a bank review decision is saving to it

The decision is held where it has written its changes, an account delete queues behind it on the
database, then the decision is released. It must answer with its transaction before the delete takes
the account and everything in it, rather than reading the row after the delete has removed it.
"""

import asyncio
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_transaction import BankTransactionDisposition, OpenReviewKind
from app.routes.accounts import deletion_helpers as account_deletion_module
from app.services.bank_sync import review_decisions
from tests.routes.accounts.test_account_deletion_overlap import _held_request, _overlap, _pid, _record_pid
from tests.routes.support.bank_sync_helpers import BANK_DATE, _commit_review_item
from tests.routes.support.manual_entry_helpers import _Ledger, _ledger
from tests.routes.support.merchant_helpers import _get_system_merchant_id
from tests.routes.support.transaction_helpers import _create_transaction

# Each decision and the step it takes just before it commits
_DECISIONS = [
    ("add", "mark_user_cache_changed"),
    ("accept-change", "mark_user_cache_changed"),
    ("keep-current", "mark_user_status_changed"),
    ("keep-transaction", "mark_user_status_changed"),
    ("restore", "mark_user_cache_changed"),
]


async def _commit_item(client, ledger: _Ledger, decision: str) -> tuple[str, dict | None]:
    """Commit the bank item the decision acts on, returning the path that decides it and its body"""
    if decision == "add":
        merchant_id = await _get_system_merchant_id(client, ledger.headers)
        payload = {"dt": BANK_DATE.isoformat(), "amount": -2340, "merchant_id": merchant_id, "category_id": ledger.category_id}
        item_id = await _commit_review_item(ledger.everyday_id, observed_amount=-2340)
        return f"/bank-review/items/{item_id}/add", payload

    created = await _create_transaction(
        client, ledger.headers, ledger.everyday_id, ledger.category_id, dt=BANK_DATE.isoformat(), amount=-4000
    )
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


@pytest.mark.parametrize(("decision", "step"), _DECISIONS)
async def test_an_account_delete_waits_for_a_review_decision_saving_to_the_account_and_the_decision_still_answers(
    client, monkeypatch, decision, step
):
    """The decision commits and answers with its transaction, then the delete takes the account."""
    ledger = await _ledger(client)
    path, body = await _commit_item(client, ledger, decision)
    held, release, entered, deleted = asyncio.Event(), asyncio.Event(), asyncio.Event(), asyncio.Event()
    pids = []
    original_step = getattr(review_decisions, step)
    original_commit = AsyncSession.commit

    async def hold_before_the_step(db, *args, **kwargs):
        if _held_request.get():
            pids.append(await _pid(db))
            held.set()
            await release.wait()
        return await original_step(db, *args, **kwargs)

    async def commit_then_wait_for_the_delete(session):
        await original_commit(session)
        # The delete goes ahead the moment this commits, so the decision answers only once the
        # account and the rows it saved are gone
        if _held_request.get():
            await deleted.wait()

    async def decide():
        _held_request.set(True)
        return await client.post(path, json=body, headers=ledger.headers)

    async def delete_account():
        try:
            return await client.delete(f"/accounts/{ledger.everyday_id}", headers=ledger.headers)
        finally:
            deleted.set()

    monkeypatch.setattr(review_decisions, step, hold_before_the_step)
    monkeypatch.setattr(AsyncSession, "commit", commit_then_wait_for_the_delete)
    _record_pid(monkeypatch, account_deletion_module, "check_account_access", pids, entered)

    decided, removed = await _overlap(decide, delete_account, first_held=held, release=release, second_entered=entered, pids=pids)

    assert decided.status_code == (201 if decision == "add" else 200), decided.text
    assert removed.status_code == 204, removed.text
    assert (await client.get(f"/accounts/{ledger.everyday_id}", headers=ledger.headers)).status_code == 404
