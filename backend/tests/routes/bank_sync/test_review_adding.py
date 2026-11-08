"""Adding a new bank item to the ledger

The ledger transaction and the accepted bank transaction are written in one save, so neither exists
without the other, and the transaction passes the checks a hand-entered one does except the days a
linked account's bank supplies, since it is the bank's own. A date or amount the user changed counts
as edited. A double submission or a sync writing the item at the same moment adds it once, with the
bank values the sync left, and only the user's own items on their own personal accounts can be added.
An add that leaves 50 or fewer new items waiting resumes the account's paused sync at once
"""

import asyncio
import uuid
from dataclasses import dataclass
from datetime import date, timedelta
from unittest.mock import ANY

import pytest
from sqlalchemy import func, select

from app.models.account import Account
from app.models.bank_connection import BankAccountLink
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition
from app.models.transaction import Transaction
from app.services.bank_sync import manual_entries, review_decisions, review_pause
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    BANK_DATE,
    EMPTY_REVIEW_PAGE,
    _balances,
    _changed_at,
    _commit_other_users_account,
    _commit_paused_link,
    _commit_review_item,
    _commit_waiting_items,
    _ledger_rows,
    _new_account,
    _new_group_account,
    _pause_state,
    _review_page,
    _stored_item,
)
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.routes.support.manual_entry_helpers import NOW, SUPPLIED, _commit_link, _Ledger, _ledger
from tests.routes.support.merchant_helpers import _get_system_merchant_id
from tests.routes.support.query_helpers import _recorded_statements, _writes
from tests.routes.support.transaction_helpers import _create_transaction, _get_system_category_id

_TESCO = "TESCO STORES 3297"


@dataclass(frozen=True)
class _Inbox:
    """A signed-up user's ledger, the Tesco merchant and Groceries, and one item waiting on Everyday"""

    ledger: _Ledger
    merchant_id: str
    category_id: str
    item_id: uuid.UUID

    @property
    def headers(self) -> dict:
        """The user's auth headers"""
        return self.ledger.headers

    @property
    def account_id(self) -> str:
        """The Everyday account that holds the waiting item"""
        return self.ledger.everyday_id


async def _tesco_waiting(client, **item_values) -> _Inbox:
    """Sign up and leave the bank's TESCO STORES 3297 -23.40 on 3 October waiting on Everyday, with any of its values replaced"""
    ledger = await _ledger(client)
    tesco = await client.post("/merchants", json={"name": "Tesco"}, headers=ledger.headers)
    assert tesco.status_code == 201, tesco.text
    groceries_id = await _get_system_category_id(client, ledger.headers, "Groceries")
    item_id = await _commit_review_item(ledger.everyday_id, description=_TESCO, observed_amount=-2340, **item_values)
    return _Inbox(ledger, tesco.json()["id"], groceries_id, item_id)


async def _add(client, inbox: _Inbox, item_id: uuid.UUID | None = None, **changes):
    """Add the item to the ledger as Tesco and Groceries on the bank's date and amount, with any of those changed"""
    payload = {"dt": BANK_DATE.isoformat(), "amount": -2340, "merchant_id": inbox.merchant_id, "category_id": inbox.category_id, **changes}
    payload = {field: value for field, value in payload.items() if value is not None}
    return await client.post(f"/bank-review/items/{item_id or inbox.item_id}/add", json=payload, headers=inbox.headers)


def _tesco_source(*, amount: int | None = -2340, raw_amount: str | None = None, edited_fields: list[str] | None = None) -> dict:
    """Return the bank source of a transaction added from the TESCO item"""
    return {
        "provider": "fake",
        "provider_name": "Fake Bank",
        "bank_values": {
            "date": BANK_DATE.isoformat(),
            "amount": amount,
            "raw_amount": raw_amount,
            "description": _TESCO,
        },
        # The record was received when the test committed it
        "received_at": ANY,
        "edited_fields": edited_fields or [],
        "review_item_id": None,
    }


async def test_adding_tesco_writes_one_bank_sourced_transaction_and_empties_the_inbox(client):
    """Added as Tesco and Groceries, the -23.40 is in the ledger from Fake Bank, the balance moves and the cache mark is the last write"""
    inbox = await _tesco_waiting(client)
    before = await _changed_at(client, inbox.headers)

    with _recorded_statements() as statements:
        added = await _add(client, inbox)

    assert added.status_code == 201, added.text
    body = added.json()
    assert (body["account_id"], body["dt"], body["amount"], body["currency"]) == (inbox.account_id, "2026-10-03", -2340, "CAD")
    assert (body["merchant_id"], body["category_id"], body["counterparty_account_id"]) == (inbox.merchant_id, inbox.category_id, None)
    assert body["bank_source"] == _tesco_source()
    assert await _ledger_rows(inbox.account_id) == [(BANK_DATE, -2340)]
    stored = await _stored_item(inbox.item_id)
    assert (stored.disposition, stored.transaction_id, stored.aligned_date, stored.aligned_amount) == (
        BankTransactionDisposition.ACCEPTED,
        uuid.UUID(body["id"]),
        BANK_DATE,
        -2340,
    )
    assert await _review_page(client, inbox.headers) == EMPTY_REVIEW_PAGE
    assert await _balances(inbox.account_id) == [(BANK_DATE, -2340)]
    assert await _changed_at(client, inbox.headers) != before
    assert "user_cache_states" in _writes(statements)[-1]


async def test_adding_writes_nothing_when_the_save_fails_after_the_ledger_row(client, monkeypatch):
    """A failure once the transaction and the acceptance are written leaves neither, so the item still waits"""

    async def fail(db, user_id):
        """Fail where the cache is marked, after every other write"""
        raise RuntimeError("cache mark failed")

    inbox = await _tesco_waiting(client)
    monkeypatch.setattr(review_decisions, "mark_user_cache_changed", fail)

    with pytest.raises(RuntimeError, match="cache mark failed"):
        await _add(client, inbox)

    assert await _ledger_rows(inbox.account_id) == []
    assert (await _stored_item(inbox.item_id)).disposition == BankTransactionDisposition.AWAITING_REVIEW


@pytest.mark.parametrize("missing", ["category_id", "merchant_id"])
async def test_adding_without_a_category_or_merchant_is_refused_with_a_field_error(client, missing):
    """The item stays waiting and nothing reaches the ledger"""
    inbox = await _tesco_waiting(client)

    refused = await _add(client, inbox, **{missing: None})

    assert refused.status_code == 422, refused.text
    assert [error["loc"] for error in refused.json()["detail"]] == [["body", missing]]
    assert [item["id"] for item in (await _review_page(client, inbox.headers))["items"]] == [str(inbox.item_id)]
    assert await _ledger_rows(inbox.account_id) == []


async def test_adding_with_a_changed_amount_marks_the_amount_edited_and_keeps_the_banks(client):
    """Added as -20.00, the ledger row is -20.00 with the bank's -23.40 beside it, and the date isn't edited"""
    inbox = await _tesco_waiting(client)

    added = await _add(client, inbox, amount=-2000)

    assert added.status_code == 201, added.text
    assert added.json()["amount"] == -2000
    assert added.json()["bank_source"] == _tesco_source(edited_fields=["amount"])


async def test_adding_on_another_day_marks_the_date_edited(client):
    """Added on 2 October, the bank's 3 October stays beside it"""
    inbox = await _tesco_waiting(client)

    added = await _add(client, inbox, dt="2026-10-02")

    assert added.status_code == 201, added.text
    assert added.json()["dt"] == "2026-10-02"
    assert added.json()["bank_source"] == _tesco_source(edited_fields=["date"])


async def test_adding_a_usd_item_the_bank_sent_to_a_tenth_of_a_cent_needs_an_amount(client):
    """Without an amount -12.345 is refused, and with -12.35 entered it is added with the amount edited"""
    inbox = await _tesco_waiting(client)
    usd_id = await _new_account(client, inbox.headers, "US Chequing", currency="USD")
    item_id = await _commit_review_item(usd_id, description=_TESCO, observed_amount=None, raw_amount="-12.345")

    refused = await _add(client, inbox, item_id, amount=None)
    added = await _add(client, inbox, item_id, amount=-1235)

    assert refused.status_code == 422, refused.text
    assert [error["loc"] for error in refused.json()["detail"]] == [["body", "amount"]]
    assert added.status_code == 201, added.text
    assert (added.json()["account_id"], added.json()["amount"], added.json()["currency"]) == (usd_id, -1235, "USD")
    assert added.json()["bank_source"] == _tesco_source(amount=None, raw_amount="-12.345", edited_fields=["amount"])
    assert (await _stored_item(item_id)).aligned_amount is None


@pytest.mark.parametrize(
    ("amount", "wording"),
    [(2**63, "a larger balance than an account can hold"), (-(2**63) - 1, "a balance further below zero than an account can hold")],
)
async def test_adding_an_amount_outside_the_stored_range_is_refused_and_leaves_the_item_waiting(client, amount, wording):
    """An amount entered past what the column holds is refused as for a hand-entered one, and nothing is written"""
    inbox = await _tesco_waiting(client)

    refused = await _add(client, inbox, amount=amount)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == f"Everyday would end up with {wording}"
    assert (await _stored_item(inbox.item_id)).disposition == BankTransactionDisposition.AWAITING_REVIEW
    assert await _ledger_rows(inbox.account_id) == []


@pytest.mark.parametrize("amount", [2**63 - 1, -(2**63)])
async def test_adding_an_amount_at_the_edge_of_the_stored_range_is_added(client, amount):
    """The largest amount the column holds, and the smallest, are added as for a hand-entered one"""
    inbox = await _tesco_waiting(client)

    added = await _add(client, inbox, amount=amount)

    assert added.status_code == 201, added.text
    assert (await _stored_item(inbox.item_id)).disposition == BankTransactionDisposition.ACCEPTED
    assert [row[1] for row in await _ledger_rows(inbox.account_id)] == [amount]


async def test_adding_as_a_transfer_to_savings_writes_the_row_a_manual_transfer_does(client):
    """Marked as a Transfer to the tracked Savings account, the row matches the same transfer entered by hand"""
    inbox = await _tesco_waiting(client)
    savings_id = inbox.ledger.savings_id
    transfer = {
        "category_id": await _get_system_category_id(client, inbox.headers, "Transfer"),
        "merchant_id": await _get_system_merchant_id(client, inbox.headers),
        "counterparty_account_id": savings_id,
        "counterparty_account_scope": "tracked",
    }

    added = await _add(client, inbox, **transfer)
    by_hand = await _create_transaction(
        client,
        inbox.headers,
        inbox.account_id,
        transfer["category_id"],
        dt="2026-10-03",
        amount=-2340,
        **{field: value for field, value in transfer.items() if field != "category_id"},
    )

    assert added.status_code == 201, added.text
    assert by_hand.status_code == 201, by_hand.text
    fields = [
        "account_id",
        "dt",
        "amount",
        "currency",
        "fx_rate",
        "category_id",
        "merchant_id",
        "counterparty_account_id",
        "counterparty_account_scope",
    ]
    assert [added.json()[field] for field in fields] == [by_hand.json()[field] for field in fields]
    assert (added.json()["counterparty_account_id"], added.json()["counterparty_account_scope"]) == (savings_id, "tracked")


async def test_adding_as_a_transfer_to_a_group_or_another_users_account_is_refused(client):
    """The Smith Family's Joint account is the user's to read but not their own, and another user's Theirs isn't theirs to read"""
    inbox = await _tesco_waiting(client)
    joint_id = await _new_group_account(client, inbox.headers)
    theirs = await _commit_other_users_account()
    transfer = {
        "category_id": await _get_system_category_id(client, inbox.headers, "Transfer"),
        "merchant_id": await _get_system_merchant_id(client, inbox.headers),
        "counterparty_account_scope": "tracked",
    }

    to_joint = await _add(client, inbox, counterparty_account_id=joint_id, **transfer)
    to_theirs = await _add(client, inbox, counterparty_account_id=str(theirs.id), **transfer)

    assert to_joint.status_code == 403, to_joint.text
    assert to_joint.json()["detail"] == "Transfers from a bank item can't go to an account shared with a group"
    assert to_theirs.status_code == 404, to_theirs.text
    assert to_theirs.json()["detail"] == "Account not found"
    assert (await _stored_item(inbox.item_id)).disposition == BankTransactionDisposition.AWAITING_REVIEW
    assert await _ledger_rows(inbox.account_id) == []


async def test_adding_to_a_linked_account_takes_a_day_its_bank_supplies(client, pin_clock):
    """Everyday's bank supplies 12 July. A hand-entered transaction is refused on it, but the bank's own is taken"""
    pin_clock(NOW, manual_entries)
    inbox = await _tesco_waiting(client, observed_date=date(2026, 7, 12))
    await _commit_link(inbox.ledger, inbox.account_id)

    by_hand = await _create_transaction(client, inbox.headers, inbox.account_id, inbox.category_id, dt="2026-07-12", amount=-2340)
    added = await _add(client, inbox, dt="2026-07-12")

    assert by_hand.status_code == 422, by_hand.text
    assert by_hand.json()["detail"] == SUPPLIED
    assert added.status_code == 201, added.text
    assert await _ledger_rows(inbox.account_id) == [(date(2026, 7, 12), -2340)]


async def test_a_double_submitted_add_adds_the_item_once(client):
    """Both requests queue behind the item, and the second answers with the transaction the first wrote"""
    inbox = await _tesco_waiting(client)

    async with asyncio.timeout(10), TestSession() as holder:
        await holder.execute(select(BankTransaction.id).where(BankTransaction.id == inbox.item_id).with_for_update())
        holder_pid = await holder.scalar(select(func.pg_backend_pid()))
        both = asyncio.gather(_add(client, inbox), _add(client, inbox))
        await _wait_until_waiting_on(holder_pid, both, waiters=2)
        await holder.commit()
        first, second = await both

    assert (first.status_code, second.status_code) == (201, 201), (first.text, second.text)
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["bank_source"] == second.json()["bank_source"] == _tesco_source()
    assert await _ledger_rows(inbox.account_id) == [(BANK_DATE, -2340)]
    assert await _balances(inbox.account_id) == [(BANK_DATE, -2340)]


async def test_an_add_waiting_on_a_sync_aligns_with_the_amount_the_sync_stored(client):
    """The bank now says -23.45, so the -23.40 the user saw and added counts as edited against it"""
    inbox = await _tesco_waiting(client)
    await _commit_link(inbox.ledger, inbox.account_id)

    async with asyncio.timeout(10), TestSession() as syncing:
        # The sync's order: the link, then the bank transactions
        await syncing.execute(select(BankAccountLink.id).where(BankAccountLink.account_id == uuid.UUID(inbox.account_id)).with_for_update())
        record = await syncing.scalar(select(BankTransaction).where(BankTransaction.id == inbox.item_id).with_for_update())
        record.observed_amount = -2345
        await syncing.flush()
        syncing_pid = await syncing.scalar(select(func.pg_backend_pid()))
        adding = asyncio.create_task(_add(client, inbox))
        await _wait_until_waiting_on(syncing_pid, adding)
        await syncing.commit()
        added = await adding

    assert added.status_code == 201, added.text
    assert added.json()["amount"] == -2340
    assert added.json()["bank_source"] == _tesco_source(amount=-2345, edited_fields=["amount"])


async def test_adding_another_users_item_or_one_on_a_group_account_is_not_found(client):
    """Neither item is the user's own on their own personal account, so both read as not found and stay"""
    inbox = await _tesco_waiting(client)
    theirs = await _commit_other_users_account()
    their_item = await _commit_review_item(theirs.id)
    joint_id = await _new_group_account(client, inbox.headers)
    joint_item = await _commit_review_item(joint_id, owner_id=inbox.ledger.user_id)

    responses = [await _add(client, inbox, item_id) for item_id in (their_item, joint_item, uuid.uuid4())]

    assert [(response.status_code, response.json()["detail"]) for response in responses] == [(404, "Review item not found")] * 3
    assert [(await _stored_item(item_id)).disposition for item_id in (their_item, joint_item)] == [
        BankTransactionDisposition.AWAITING_REVIEW
    ] * 2
    async with TestSession() as session:
        assert (
            await session.scalar(
                select(func.count()).select_from(Transaction).where(Transaction.account_id.in_([theirs.id, uuid.UUID(joint_id)]))
            )
            == 0
        )


async def test_adding_a_dismissed_item_is_refused(client):
    """An item dismissed in another tab stays dismissed and out of the ledger"""
    inbox = await _tesco_waiting(client)
    dismissed = await client.post(f"/bank-review/items/{inbox.item_id}/dismiss", headers=inbox.headers)
    assert dismissed.status_code == 204, dismissed.text

    refused = await _add(client, inbox)

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == "This item was dismissed, so it can't be added to the ledger"
    assert await _ledger_rows(inbox.account_id) == []


async def test_adding_to_an_archived_account_is_refused_as_for_a_hand_entered_transaction(client):
    """Everyday was unlinked and archived with the item still waiting, so it can't take the transaction"""
    inbox = await _tesco_waiting(client)
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(inbox.account_id))
        account.is_archived = True
        await session.commit()

    refused = await _add(client, inbox)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Account is archived"
    assert (await _stored_item(inbox.item_id)).disposition == BankTransactionDisposition.AWAITING_REVIEW
    assert await _ledger_rows(inbox.account_id) == []


@pytest.mark.parametrize(
    ("waiting", "pause_state"),
    [(52, (True, NOW + timedelta(days=1), [])), (51, (False, NOW, ["scheduled"]))],
    ids=["leaves_51", "leaves_50"],
)
async def test_adding_the_item_that_leaves_50_new_items_waiting_resumes_the_paused_sync_at_once(client, pin_clock, waiting, pause_state):
    """Everyday is paused for review with the Tesco item among its new items waiting, its next sync set for tomorrow

    Adding it leaves 51 and Everyday stays paused. Leaving 50 lifts the pause, makes Everyday due now and
    queues its connection's sync, with the cache mark still the last write
    """
    pin_clock(NOW, review_pause)
    inbox = await _tesco_waiting(client)
    link = await _commit_paused_link(inbox.account_id, NOW)
    await _commit_waiting_items(link, waiting - 1)

    with _recorded_statements() as statements:
        added = await _add(client, inbox)

    assert added.status_code == 201, added.text
    assert await _pause_state(link) == pause_state
    assert "user_cache_states" in _writes(statements)[-1]
