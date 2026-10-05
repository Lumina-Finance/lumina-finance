"""Deciding a bank removal of a transaction in the ledger: removing it from the ledger or keeping it

Removing deletes the ledger transaction, its bank transaction with it, and rebuilds its balances,
and works while the account is linked. Keeping leaves the ledger as it is and closes the removal,
which stays remembered so the same removal sent again opens nothing. Either is one save with the
cache mark last. A removal applied after a sync brought the transaction back deletes one the bank
still lists, one taking the ledger row before the bank transaction can deadlock with a sync, and one
reaching another user's item deletes from their ledger
"""

import asyncio
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select, text

from app.models.bank_connection import BankAccountLink
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition, OpenReviewKind
from app.models.transaction import Transaction
from app.services.bank_sync import review_decisions
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    BANK_DATE,
    EMPTY_REVIEW_PAGE,
    _balances,
    _changed_at,
    _commit_other_users_account,
    _commit_review_item,
    _ledger_rows,
    _new_group_account,
    _review_page,
    _stored_item,
)
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.routes.support.manual_entry_helpers import _commit_link, _Ledger, _ledger
from tests.routes.support.query_helpers import _recorded_statements, _writes
from tests.routes.support.transaction_helpers import _create_transaction

_GROCERIES = "FRESHCO GROCERIES"

# Both decisions, by the path each posts to
_DECISIONS = ["remove-from-ledger", "keep-transaction"]

_NOT_IN_LEDGER = "This item isn't in the ledger, so it has no bank change to decide"
_NO_REMOVAL = "This transaction has no bank removal waiting, so it stays in the ledger"

# When the sync stored the bank's removal of the groceries
_REPORTED_AT = datetime(2026, 10, 4, 9, tzinfo=UTC)


@dataclass(frozen=True)
class _Removal:
    """A signed-up user's groceries in linked Everyday's ledger, and the bank's removal of them waiting"""

    ledger: _Ledger
    transaction_id: str
    item_id: uuid.UUID

    @property
    def headers(self) -> dict:
        """The user's auth headers"""
        return self.ledger.headers

    @property
    def account_id(self) -> str:
        """Everyday, where the groceries are"""
        return self.ledger.everyday_id


async def _removal_waiting(client, **item_values) -> _Removal:
    """Sign up with the bank's FRESHCO GROCERIES -40.00 on 3 October in Everyday's ledger as -42.00, and the bank's removal of them waiting

    Everyday is linked to the bank, and any of the item's values are replaced
    """
    ledger = await _ledger(client)
    created = await _create_transaction(client, ledger.headers, ledger.everyday_id, ledger.category_id, dt=BANK_DATE.isoformat(), amount=-4200)
    assert created.status_code == 201, created.text
    await _commit_link(ledger, ledger.everyday_id)
    values = {
        "disposition": BankTransactionDisposition.ACCEPTED,
        "transaction_id": uuid.UUID(created.json()["id"]),
        "description": _GROCERIES,
        "aligned_date": BANK_DATE,
        "aligned_amount": -4000,
        "observed_amount": -4000,
        "open_kind": OpenReviewKind.REMOVAL,
        "removed_at": _REPORTED_AT,
    }
    item_id = await _commit_review_item(ledger.everyday_id, **(values | item_values))
    return _Removal(ledger, created.json()["id"], item_id)


async def _decide(client, removal: _Removal, decision: str, item_id: uuid.UUID | None = None):
    """Post a decision on the removal, or on another item"""
    return await client.post(f"/bank-review/items/{item_id or removal.item_id}/{decision}", headers=removal.headers)


async def _still_stored(item_id: uuid.UUID) -> bool:
    """Return whether the item's bank transaction is still stored, read as the table owner"""
    async with TestSession() as session:
        return await session.get(BankTransaction, item_id) is not None


async def _end_of_day_balances(account_id: str) -> list[int]:
    """Return the account's end-of-day balances without their days, since an emptied account keeps a zero on the day it opened"""
    return [balance for _, balance in await _balances(account_id)]


def _review_items(page: dict) -> list[tuple]:
    """Return each item's kind, ledger transaction, bank and ledger amounts, and the fields it changes"""
    return [
        (item["kind"], item["transaction_id"], item["bank"]["amount"], item["current"]["amount"], item["changed_fields"])
        for item in page["items"]
    ]


async def test_removing_deletes_the_transaction_the_bank_removed_and_rebuilds_its_balances(client):
    """The removal offers to remove the user's -42.00 rather than the bank's -40.00, and the groceries show Needs review

    Removing deletes them and their bank transaction, the balance rises by 42.00, the review list
    empties and the cache mark is the last write
    """
    removal = await _removal_waiting(client)
    offered = _review_items(await _review_page(client, removal.headers))
    shown = await client.get(f"/transactions/{removal.transaction_id}", headers=removal.headers)
    balances_before = await _balances(removal.account_id)
    before = await _changed_at(client, removal.headers)

    with _recorded_statements() as statements:
        removed = await _decide(client, removal, "remove-from-ledger")

    assert removed.status_code == 204, removed.text
    assert offered == [("removal", removal.transaction_id, -4000, -4200, [])]
    assert shown.status_code == 200, shown.text
    assert shown.json()["bank_source"]["review_item_id"] == str(removal.item_id)
    assert balances_before == [(BANK_DATE, -4200)]
    assert await _ledger_rows(removal.account_id) == []
    assert await _end_of_day_balances(removal.account_id) == [0]
    assert not await _still_stored(removal.item_id)
    assert await _review_page(client, removal.headers) == EMPTY_REVIEW_PAGE
    assert await _changed_at(client, removal.headers) != before
    assert "user_cache_states" in _writes(statements)[-1]


async def test_keeping_the_transaction_leaves_the_ledger_and_remembers_the_removal(client):
    """Kept, the groceries stay at -42.00 with their balance, no longer need review, and the removal stays recorded so it opens nothing again"""
    removal = await _removal_waiting(client)
    before = await _changed_at(client, removal.headers)

    with _recorded_statements() as statements:
        kept = await _decide(client, removal, "keep-transaction")

    assert kept.status_code == 200, kept.text
    assert (kept.json()["id"], kept.json()["dt"], kept.json()["amount"]) == (removal.transaction_id, BANK_DATE.isoformat(), -4200)
    assert kept.json()["bank_source"] == {
        "provider": "simplefin",
        "provider_name": "SimpleFIN",
        "bank_values": {
            "date": BANK_DATE.isoformat(),
            "amount": -4000,
            "raw_amount": None,
            "description": _GROCERIES,
            "merchant_name": None,
            "category_hint": None,
        },
        "edited_fields": ["amount"],
        "review_item_id": None,
    }
    stored = await _stored_item(removal.item_id)
    assert (stored.open_kind, stored.previous_values, stored.removed_at) == (None, None, _REPORTED_AT)
    assert await _ledger_rows(removal.account_id) == [(BANK_DATE, -4200)]
    assert await _balances(removal.account_id) == [(BANK_DATE, -4200)]
    assert await _review_page(client, removal.headers) == EMPTY_REVIEW_PAGE
    assert await _changed_at(client, removal.headers) != before
    assert "user_cache_states" in _writes(statements)[-1]


async def test_keeping_the_transaction_brings_back_the_correction_the_removal_took_the_place_of(client):
    """A correction of the groceries to -41.00 was waiting when the bank removed them, and keeping them leaves that correction to decide"""
    removal = await _removal_waiting(client, observed_amount=-4100, previous_values={"amount": -4000})

    kept = await _decide(client, removal, "keep-transaction")

    assert kept.status_code == 200, kept.text
    assert kept.json()["bank_source"]["review_item_id"] == str(removal.item_id)
    stored = await _stored_item(removal.item_id)
    assert (stored.open_kind, stored.previous_values) == (OpenReviewKind.CORRECTION, {"amount": -4000})
    assert _review_items(await _review_page(client, removal.headers)) == [
        ("correction", removal.transaction_id, -4100, -4200, ["amount"]),
    ]
    assert await _ledger_rows(removal.account_id) == [(BANK_DATE, -4200)]


async def test_removing_submitted_twice_at_once_deletes_once_and_the_second_finds_nothing(client):
    """Both submissions queue behind a lock on the item, the first deletes the groceries, and the second finds no item left"""
    removal = await _removal_waiting(client)

    async with asyncio.timeout(10), TestSession() as holder:
        await holder.execute(select(BankTransaction.id).where(BankTransaction.id == removal.item_id).with_for_update())
        holder_pid = await holder.scalar(select(func.pg_backend_pid()))
        both = asyncio.gather(_decide(client, removal, "remove-from-ledger"), _decide(client, removal, "remove-from-ledger"))
        await _wait_until_waiting_on(holder_pid, both, waiters=2)
        await holder.commit()

        # Either submission may reach the item first
        removed, refused = sorted(await both, key=lambda response: response.status_code)

    assert (removed.status_code, refused.status_code, refused.json()["detail"]) == (204, 404, "Review item not found")
    assert await _ledger_rows(removal.account_id) == []
    assert await _end_of_day_balances(removal.account_id) == [0]


async def test_keeping_submitted_twice_at_once_closes_the_removal_once(client):
    """Both submissions queue behind a lock on the item and answer with the same transaction, which the second leaves as the first did"""
    removal = await _removal_waiting(client)

    async with asyncio.timeout(10), TestSession() as holder:
        await holder.execute(select(BankTransaction.id).where(BankTransaction.id == removal.item_id).with_for_update())
        holder_pid = await holder.scalar(select(func.pg_backend_pid()))
        both = asyncio.gather(_decide(client, removal, "keep-transaction"), _decide(client, removal, "keep-transaction"))
        await _wait_until_waiting_on(holder_pid, both, waiters=2)
        await holder.commit()
        first, second = await both

    assert (first.status_code, second.status_code) == (200, 200), (first.text, second.text)
    assert first.json() == second.json()
    assert await _ledger_rows(removal.account_id) == [(BANK_DATE, -4200)]

    # Created at version 1 and written once
    assert (await _stored_item(removal.item_id)).version == 2


@pytest.mark.parametrize(("decision", "status_code", "detail"), [("remove-from-ledger", 409, _NO_REMOVAL), ("keep-transaction", 200, None)])
async def test_a_decision_waiting_on_a_sync_that_brings_the_transaction_back_keeps_it(client, decision, status_code, detail):
    """A sync storing the bank sending the groceries again holds the item, and closes the removal before the decision gets it

    Removing is refused, since the bank lists the groceries again, and keeping answers with them as
    they are, so the groceries stay in the ledger either way
    """
    removal = await _removal_waiting(client)

    async with asyncio.timeout(10), TestSession() as syncing:
        # The sync's order: the link, then the bank transactions
        await syncing.execute(select(BankAccountLink.id).where(BankAccountLink.account_id == uuid.UUID(removal.account_id)).with_for_update())
        record = await syncing.scalar(select(BankTransaction).where(BankTransaction.id == removal.item_id).with_for_update())
        record.open_kind = None
        record.removed_at = None
        await syncing.flush()
        syncing_pid = await syncing.scalar(select(func.pg_backend_pid()))
        deciding = asyncio.create_task(_decide(client, removal, decision))
        await _wait_until_waiting_on(syncing_pid, deciding)
        await syncing.commit()
        decided = await deciding

    # A transaction answered has no detail
    assert (decided.status_code, decided.json().get("detail")) == (status_code, detail)
    assert await _ledger_rows(removal.account_id) == [(BANK_DATE, -4200)]
    stored = await _stored_item(removal.item_id)
    assert (stored.open_kind, stored.removed_at, stored.version) == (None, None, 2)


async def test_removing_locks_the_bank_transaction_before_the_ledger_transaction(client):
    """A sync holds the groceries' bank transaction while removing waits for it, then locks their ledger row, as a trusted correction does

    Removing hasn't taken the ledger row while it waits, so the sync gets it at once rather than
    deadlocking, and removing goes ahead once the sync commits
    """
    removal = await _removal_waiting(client)

    async with asyncio.timeout(10), TestSession() as syncing:
        await syncing.execute(text("SET LOCAL lock_timeout = '2s'"))
        await syncing.execute(select(BankTransaction.id).where(BankTransaction.id == removal.item_id).with_for_update())
        syncing_pid = await syncing.scalar(select(func.pg_backend_pid()))
        removing = asyncio.create_task(_decide(client, removal, "remove-from-ledger"))
        await _wait_until_waiting_on(syncing_pid, removing)
        await syncing.execute(select(Transaction.id).where(Transaction.id == uuid.UUID(removal.transaction_id)).with_for_update())
        await syncing.commit()
        removed = await removing

    assert removed.status_code == 204, removed.text
    assert await _ledger_rows(removal.account_id) == []


@pytest.mark.parametrize("decision", _DECISIONS)
async def test_deciding_another_users_item_or_one_on_a_group_account_is_not_found(client, decision):
    """Neither item is the user's own on their own personal account, so both read as not found and stay as they were"""
    removal = await _removal_waiting(client)
    theirs = await _commit_other_users_account()
    their_item = await _commit_review_item(theirs.id)
    joint_id = await _new_group_account(client, removal.headers)
    joint_item = await _commit_review_item(joint_id, owner_id=removal.ledger.user_id)

    responses = [await _decide(client, removal, decision, item_id) for item_id in (their_item, joint_item, uuid.uuid4())]

    assert [(response.status_code, response.json()["detail"]) for response in responses] == [(404, "Review item not found")] * 3
    assert [(await _stored_item(item_id)).version for item_id in (their_item, joint_item)] == [1, 1]


@pytest.mark.parametrize("decision", _DECISIONS)
async def test_deciding_a_removal_on_an_item_not_in_the_ledger_is_refused(client, decision):
    """A new item waiting to be added has no ledger transaction to remove or keep, so it stays waiting"""
    removal = await _removal_waiting(client)
    new_item = await _commit_review_item(removal.account_id, "TRN-1002")

    refused = await _decide(client, removal, decision, new_item)

    assert (refused.status_code, refused.json()["detail"]) == (409, _NOT_IN_LEDGER)
    assert (await _stored_item(new_item)).disposition == BankTransactionDisposition.AWAITING_REVIEW


@pytest.mark.parametrize(
    "item_values",
    [
        {"open_kind": OpenReviewKind.CORRECTION, "observed_amount": -4100, "previous_values": {"amount": -4000}, "removed_at": None},
        {"open_kind": None},
    ],
    ids=["correction waiting", "removal kept"],
)
async def test_removing_a_transaction_with_no_removal_waiting_is_refused_and_keeping_it_changes_nothing(client, item_values):
    """The groceries have a correction waiting, or the user already kept them through a removal

    Removing is refused, since the bank hasn't asked for it, and keeping answers with the groceries
    as they are. Both leave the ledger and the item as they were
    """
    removal = await _removal_waiting(client, **item_values)

    refused = await _decide(client, removal, "remove-from-ledger")
    kept = await _decide(client, removal, "keep-transaction")

    assert (refused.status_code, refused.json()["detail"]) == (409, _NO_REMOVAL)
    assert kept.status_code == 200, kept.text
    assert (kept.json()["id"], kept.json()["amount"]) == (removal.transaction_id, -4200)
    stored = await _stored_item(removal.item_id)
    assert (stored.open_kind, stored.version) == (item_values["open_kind"], 1)
    assert await _ledger_rows(removal.account_id) == [(BANK_DATE, -4200)]


async def test_removing_writes_nothing_when_the_save_fails_after_the_ledger_row(client, monkeypatch):
    """A failure once the ledger row is deleted and its balances rebuilt leaves the groceries, their balance and the removal as they were"""

    async def fail(db, user_id):
        """Fail where the cache is marked, after every other write"""
        raise RuntimeError("cache mark failed")

    removal = await _removal_waiting(client)
    monkeypatch.setattr(review_decisions, "mark_user_cache_changed", fail)

    with pytest.raises(RuntimeError, match="cache mark failed"):
        await _decide(client, removal, "remove-from-ledger")

    assert await _ledger_rows(removal.account_id) == [(BANK_DATE, -4200)]
    assert await _balances(removal.account_id) == [(BANK_DATE, -4200)]
    assert (await _stored_item(removal.item_id)).open_kind == OpenReviewKind.REMOVAL
