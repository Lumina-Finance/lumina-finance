"""Dismissing a new bank item

A dismissed item keeps only its identity and the dismissal, enough to stay dismissed when the bank
sends it again, so the bank's values are cleared. A double-clicked Dismiss dismisses it once, and
only the user's own items on their own personal accounts can be dismissed
"""

import asyncio
import uuid

from sqlalchemy import func, select

from app.models.account import Account
from app.models.bank_connection import BankProvider
from app.models.bank_transaction import OBSERVATION_COLUMNS, BankTransaction, BankTransactionDisposition, OpenReviewKind
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    BANK_ACCOUNT_ID,
    _build_account,
    _build_category,
    _build_ledger_transaction,
    _build_user,
    _changed_at,
    _commit_review_item,
    _new_account,
    _review_page,
    _sign_up,
)
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.routes.support.query_helpers import _recorded_statements, _writes

_NONE_WAITING = {"new": 0, "correction": 0, "removal": 0}


async def _dismiss(client, headers, item_id: uuid.UUID):
    """Dismiss the item through the route"""
    return await client.post(f"/bank-review/items/{item_id}/dismiss", headers=headers)


async def _stored_item(item_id: uuid.UUID) -> BankTransaction:
    """Return the item's bank transaction as stored, read as the table owner"""
    async with TestSession() as session:
        return await session.get_one(BankTransaction, item_id)


async def test_dismissing_keeps_only_the_items_identity_and_leaves_the_inbox(client):
    """HARBOUR COFFEE 0412 leaves the list with its bank values cleared and its identity kept, and the cache mark is the last write"""
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    item_id = await _commit_review_item(account_id, merchant_name="Harbour Coffee", category_hint="Coffee", extras={"memo": "card 0412"})
    before = await _changed_at(client, headers)

    with _recorded_statements() as statements:
        dismissed = await _dismiss(client, headers, item_id)

    assert dismissed.status_code == 204, dismissed.text
    assert dismissed.content == b""
    stored = await _stored_item(item_id)
    assert (stored.account_id, stored.provider, stored.external_account_id, stored.external_transaction_id, stored.disposition) == (
        uuid.UUID(account_id),
        BankProvider.SIMPLEFIN,
        BANK_ACCOUNT_ID,
        "TRN-1001",
        BankTransactionDisposition.DISMISSED,
    )
    assert {column: getattr(stored, column) for column in OBSERVATION_COLUMNS} == dict.fromkeys(OBSERVATION_COLUMNS)
    assert stored.transaction_id is None
    assert await _review_page(client, headers) == {"items": [], "counts": _NONE_WAITING, "next_cursor": None}
    assert await _changed_at(client, headers) != before
    assert "user_cache_states" in _writes(statements)[-1]


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
        proposed_fields={"amount": -1250},
    )

    refused = await _dismiss(client, headers, item_id)

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == "This item is already in the ledger, so it can't be dismissed"
    assert (await _stored_item(item_id)).disposition == BankTransactionDisposition.ACCEPTED


async def test_dismissing_another_users_item_or_one_on_a_group_account_is_not_found(client):
    """Neither item is the user's own on their own personal account, so both read as not found and stay"""
    headers, user_id = await _sign_up(client)
    async with TestSession() as session:
        other = _build_user("other@example.com")
        session.add(other)
        await session.flush()
        theirs = _build_account(other.id, name="Theirs")
        session.add(theirs)
        await session.commit()
    their_item = await _commit_review_item(theirs.id)
    group = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    assert group.status_code == 201, group.text
    joint_id = await _new_account(client, headers, "Joint", group_id=group.json()["id"])
    joint_item = await _commit_review_item(joint_id, owner_id=user_id)

    responses = [await _dismiss(client, headers, item_id) for item_id in (their_item, joint_item)]

    assert [(response.status_code, response.json()["detail"]) for response in responses] == [(404, "Review item not found")] * 2
    assert [(await _stored_item(item_id)).disposition for item_id in (their_item, joint_item)] == [
        BankTransactionDisposition.AWAITING_REVIEW
    ] * 2
