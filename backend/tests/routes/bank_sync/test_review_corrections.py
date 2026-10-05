"""Deciding a bank correction to a transaction already in the ledger: accepting the bank's change or keeping the current value

Accepting writes the bank's values for the changed fields to the same ledger transaction, which
keeps its id and bank source, and rebuilds its balances from the earliest date it touches. Keeping
leaves the ledger as it is and remembers the values declined. Either closes the correction in one
save with the cache mark last. A decision applied twice moves money twice or overwrites the first,
one that loses a sync's write made at the same moment decides values the bank no longer sends, and
one reaching another user's item changes their ledger
"""

import asyncio
import uuid
from dataclasses import dataclass
from datetime import date

import pytest
from sqlalchemy import func, select

from app.models.account import AccountBalanceSnapshot
from app.models.bank_connection import BankAccountLink
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition, OpenReviewKind
from app.services.bank_sync import review_decisions
from tests.conftest import TestSession
from tests.routes.support.account_helpers import _current_balance
from tests.routes.support.bank_sync_helpers import (
    BANK_DATE,
    EMPTY_REVIEW_PAGE,
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
from tests.routes.transactions._helpers import _refund

_BLUE_BOTTLE = "SQ *BLUE BOTTLE"

# Both decisions, by the path each posts to
_DECISIONS = ["accept-change", "keep-current"]

_NOT_IN_LEDGER = "This item isn't in the ledger, so it has no bank change to decide"


@dataclass(frozen=True)
class _Correction:
    """A signed-up user's coffee in Everyday's ledger, and the bank's correction to it waiting"""

    ledger: _Ledger
    transaction_id: str
    item_id: uuid.UUID

    @property
    def headers(self) -> dict:
        """The user's auth headers"""
        return self.ledger.headers

    @property
    def account_id(self) -> str:
        """Everyday, where the coffee is"""
        return self.ledger.everyday_id


async def _correction_waiting(client, *, ledger_date: date = BANK_DATE, **item_values) -> _Correction:
    """Sign up with the bank's SQ *BLUE BOTTLE -4.50 on 3 October in Everyday's ledger, and the bank's change to -4.75 waiting

    The ledger transaction is on the date given, and any of the item's values are replaced
    """
    ledger = await _ledger(client)
    created = await _create_transaction(client, ledger.headers, ledger.everyday_id, ledger.category_id, dt=ledger_date.isoformat(), amount=-450)
    assert created.status_code == 201, created.text
    values = {
        "disposition": BankTransactionDisposition.ACCEPTED,
        "transaction_id": uuid.UUID(created.json()["id"]),
        "description": _BLUE_BOTTLE,
        "aligned_date": BANK_DATE,
        "aligned_amount": -450,
        "observed_amount": -475,
        "open_kind": OpenReviewKind.CORRECTION,
        "previous_values": {"amount": -450},
    }
    item_id = await _commit_review_item(ledger.everyday_id, **(values | item_values))
    return _Correction(ledger, created.json()["id"], item_id)


async def _decide(client, correction: _Correction, decision: str, item_id: uuid.UUID | None = None):
    """Post a decision on the correction, or on another item"""
    return await client.post(f"/bank-review/items/{item_id or correction.item_id}/{decision}", headers=correction.headers)


def _blue_bottle_source(*, amount: int | None = -475, raw_amount: str | None = None, edited_fields: list[str] | None = None) -> dict:
    """Return the bank source of the coffee once the correction is decided"""
    return {
        "provider": "simplefin",
        "provider_name": "SimpleFIN",
        "bank_values": {
            "date": BANK_DATE.isoformat(),
            "amount": amount,
            "raw_amount": raw_amount,
            "description": _BLUE_BOTTLE,
            "merchant_name": None,
            "category_hint": None,
        },
        "edited_fields": edited_fields or [],
        "review_item_id": None,
    }


async def _balances(account_id: str) -> list[tuple[date, int]]:
    """Return the account's end-of-day balances, earliest first, read as the table owner"""
    async with TestSession() as session:
        rows = await session.execute(
            select(AccountBalanceSnapshot.dt, AccountBalanceSnapshot.balance)
            .where(AccountBalanceSnapshot.account_id == uuid.UUID(account_id))
            .order_by(AccountBalanceSnapshot.dt)
        )
        return [tuple(row) for row in rows]


async def test_accepting_a_correction_that_would_over_refund_the_expense_is_refused_and_keeping_the_current_value_still_clears_it(client):
    """A $1.00 refund is linked to the coffee and the bank's change to -0.50 waits

    Accepting is refused with the link's own wording, which says to unlink first, and changes nothing. Keeping
    the current -4.50 is not refused, so the correction can always be cleared
    """
    correction = await _correction_waiting(client, observed_amount=-50)
    refund = await _refund(
        client, correction.headers, correction.account_id, correction.ledger.category_id, correction.transaction_id, amount=100
    )
    assert refund["refund_of_transaction_id"] == correction.transaction_id

    refused = await _decide(client, correction, "accept-change")
    kept = await _decide(client, correction, "keep-current")

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Refunds can't total more than the expense they refund. Unlink one first to make this change"
    assert kept.status_code == 200, kept.text
    assert kept.json()["amount"] == -450
    assert (await _stored_item(correction.item_id)).open_kind is None


async def test_accepting_writes_the_banks_amount_to_the_same_transaction_and_keeps_the_date_the_user_chose(client):
    """The user moved the coffee to 2 October, and accepting the bank's -4.75 changes only the amount

    The transaction keeps its id and bank source, the balance moves by 0.25, the date stays edited,
    the review list empties and the cache mark is the last write
    """
    correction = await _correction_waiting(client, ledger_date=date(2026, 10, 2))
    before = await _changed_at(client, correction.headers)

    with _recorded_statements() as statements:
        accepted = await _decide(client, correction, "accept-change")

    assert accepted.status_code == 200, accepted.text
    body = accepted.json()
    assert (body["id"], body["dt"], body["amount"]) == (correction.transaction_id, "2026-10-02", -475)
    assert body["bank_source"] == _blue_bottle_source(edited_fields=["date"])
    assert await _ledger_rows(correction.account_id) == [(date(2026, 10, 2), -475)]
    stored = await _stored_item(correction.item_id)
    assert (stored.open_kind, stored.previous_values, stored.aligned_date, stored.aligned_amount) == (None, None, BANK_DATE, -475)
    assert await _review_page(client, correction.headers) == EMPTY_REVIEW_PAGE
    assert await _current_balance(client, correction.headers, correction.account_id) == -475
    assert await _changed_at(client, correction.headers) != before
    assert "user_cache_states" in _writes(statements)[-1]


async def test_accepting_a_new_date_on_a_linked_account_moves_the_transaction_and_its_balances(client):
    """The bank moves the coffee from 3 to 1 October on linked Everyday, and accepting it moves the balance back to 1 October too"""
    correction = await _correction_waiting(
        client, observed_date=date(2026, 10, 1), observed_amount=-450, previous_values={"date": BANK_DATE.isoformat()}
    )
    await _commit_link(correction.ledger, correction.account_id)
    balances_before = await _balances(correction.account_id)

    accepted = await _decide(client, correction, "accept-change")

    assert accepted.status_code == 200, accepted.text
    assert (accepted.json()["id"], accepted.json()["dt"], accepted.json()["bank_source"]["edited_fields"]) == (
        correction.transaction_id,
        "2026-10-01",
        [],
    )
    assert balances_before == [(BANK_DATE, -450)]
    assert await _balances(correction.account_id) == [(date(2026, 10, 1), -450)]


async def test_keeping_the_current_value_leaves_the_ledger_and_remembers_the_values_declined(client):
    """Kept at -4.50, the ledger is unchanged, the amount now counts as edited against the bank's -4.75, and the correction closes"""
    correction = await _correction_waiting(client)
    before = await _changed_at(client, correction.headers)

    with _recorded_statements() as statements:
        kept = await _decide(client, correction, "keep-current")

    assert kept.status_code == 200, kept.text
    assert (kept.json()["id"], kept.json()["dt"], kept.json()["amount"]) == (correction.transaction_id, BANK_DATE.isoformat(), -450)
    assert kept.json()["bank_source"] == _blue_bottle_source(edited_fields=["amount"])
    assert await _ledger_rows(correction.account_id) == [(BANK_DATE, -450)]
    stored = await _stored_item(correction.item_id)
    assert (stored.open_kind, stored.previous_values, stored.aligned_amount, stored.declined_observation) == (
        None,
        None,
        -475,
        {"date": BANK_DATE.isoformat(), "amount": -475, "description": _BLUE_BOTTLE},
    )
    assert await _review_page(client, correction.headers) == EMPTY_REVIEW_PAGE
    assert await _current_balance(client, correction.headers, correction.account_id) == -450
    assert await _changed_at(client, correction.headers) != before
    assert "user_cache_states" in _writes(statements)[-1]


@pytest.mark.parametrize(("decision", "amount"), [("accept-change", -475), ("keep-current", -450)])
async def test_a_decision_submitted_twice_at_once_is_applied_once(client, decision, amount):
    """Both submissions queue behind a lock on the item and answer with the same transaction, which the second leaves as the first did"""
    correction = await _correction_waiting(client)

    async with asyncio.timeout(10), TestSession() as holder:
        await holder.execute(select(BankTransaction.id).where(BankTransaction.id == correction.item_id).with_for_update())
        holder_pid = await holder.scalar(select(func.pg_backend_pid()))
        both = asyncio.gather(_decide(client, correction, decision), _decide(client, correction, decision))
        await _wait_until_waiting_on(holder_pid, both, waiters=2)
        await holder.commit()
        first, second = await both

    assert (first.status_code, second.status_code) == (200, 200), (first.text, second.text)
    assert [(response.json()["id"], response.json()["amount"]) for response in (first, second)] == [(correction.transaction_id, amount)] * 2
    assert first.json()["bank_source"] == second.json()["bank_source"]
    assert await _ledger_rows(correction.account_id) == [(BANK_DATE, amount)]
    assert await _current_balance(client, correction.headers, correction.account_id) == amount

    # Created at version 1 and written once
    assert (await _stored_item(correction.item_id)).version == 2


@pytest.mark.parametrize(
    ("decision", "ledger_amount", "declined"),
    [
        ("accept-change", -500, None),
        ("keep-current", -450, {"date": BANK_DATE.isoformat(), "amount": -500, "description": _BLUE_BOTTLE}),
    ],
)
async def test_a_decision_waiting_on_a_sync_decides_the_value_the_sync_stored(client, decision, ledger_amount, declined):
    """A sync storing the bank's change from -4.75 to -5.00 holds the item, and the decision waits for it and then decides -5.00"""
    correction = await _correction_waiting(client)
    await _commit_link(correction.ledger, correction.account_id)

    async with asyncio.timeout(10), TestSession() as syncing:
        # The sync's order: the link, then the bank transactions
        await syncing.execute(
            select(BankAccountLink.id).where(BankAccountLink.account_id == uuid.UUID(correction.account_id)).with_for_update()
        )
        record = await syncing.scalar(select(BankTransaction).where(BankTransaction.id == correction.item_id).with_for_update())
        record.observed_amount = -500
        await syncing.flush()
        syncing_pid = await syncing.scalar(select(func.pg_backend_pid()))
        deciding = asyncio.create_task(_decide(client, correction, decision))
        await _wait_until_waiting_on(syncing_pid, deciding)
        await syncing.commit()
        decided = await deciding

    assert decided.status_code == 200, decided.text
    assert decided.json()["amount"] == ledger_amount
    assert await _ledger_rows(correction.account_id) == [(BANK_DATE, ledger_amount)]
    stored = await _stored_item(correction.item_id)
    assert (stored.open_kind, stored.aligned_amount, stored.declined_observation) == (None, -500, declined)


@pytest.mark.parametrize("decision", _DECISIONS)
async def test_deciding_another_users_item_or_one_on_a_group_account_is_not_found(client, decision):
    """Neither item is the user's own on their own personal account, so both read as not found and stay as they were"""
    correction = await _correction_waiting(client)
    theirs = await _commit_other_users_account()
    their_item = await _commit_review_item(theirs.id)
    joint_id = await _new_group_account(client, correction.headers)
    joint_item = await _commit_review_item(joint_id, owner_id=correction.ledger.user_id)

    responses = [await _decide(client, correction, decision, item_id) for item_id in (their_item, joint_item, uuid.uuid4())]

    assert [(response.status_code, response.json()["detail"]) for response in responses] == [(404, "Review item not found")] * 3
    assert [(await _stored_item(item_id)).version for item_id in (their_item, joint_item)] == [1, 1]


@pytest.mark.parametrize("decision", _DECISIONS)
async def test_deciding_a_correction_on_an_item_not_in_the_ledger_is_refused(client, decision):
    """A new item waiting to be added has no ledger value to compare, so it stays waiting"""
    correction = await _correction_waiting(client)
    new_item = await _commit_review_item(correction.account_id, "TRN-1002")

    refused = await _decide(client, correction, decision, new_item)

    assert (refused.status_code, refused.json()["detail"]) == (409, _NOT_IN_LEDGER)
    assert (await _stored_item(new_item)).disposition == BankTransactionDisposition.AWAITING_REVIEW


async def test_accepting_an_amount_that_cant_be_stored_is_refused_and_keeping_the_current_value_closes_it(client):
    """The bank now says -4.755, more decimal places than CAD holds, so accepting leaves the item open and the ledger at -4.50

    Keeping the current value, as the refusal suggests, closes it with the amount counted as edited
    """
    correction = await _correction_waiting(client, observed_amount=None, raw_amount="-4.755")

    refused = await _decide(client, correction, "accept-change")
    still_open = (await _stored_item(correction.item_id)).open_kind
    kept = await _decide(client, correction, "keep-current")

    assert (refused.status_code, refused.json()["detail"]) == (
        422,
        "The bank's amount has more decimal places than CAD allows. Keep your current value and edit the amount instead",
    )
    assert still_open == OpenReviewKind.CORRECTION
    assert kept.status_code == 200, kept.text
    assert kept.json()["bank_source"] == _blue_bottle_source(amount=None, raw_amount="-4.755", edited_fields=["amount"])
    assert await _ledger_rows(correction.account_id) == [(BANK_DATE, -450)]
    assert await _review_page(client, correction.headers) == EMPTY_REVIEW_PAGE


async def test_accepting_writes_nothing_when_the_save_fails_after_the_ledger_row(client, monkeypatch):
    """A failure once the ledger row and its balances are written leaves the coffee at -4.50 and the correction open"""

    async def fail(db, user_id):
        """Fail where the cache is marked, after every other write"""
        raise RuntimeError("cache mark failed")

    correction = await _correction_waiting(client)
    monkeypatch.setattr(review_decisions, "mark_user_cache_changed", fail)

    with pytest.raises(RuntimeError, match="cache mark failed"):
        await _decide(client, correction, "accept-change")

    assert await _ledger_rows(correction.account_id) == [(BANK_DATE, -450)]
    assert await _balances(correction.account_id) == [(BANK_DATE, -450)]
    assert (await _stored_item(correction.item_id)).open_kind == OpenReviewKind.CORRECTION
