"""Adding or dismissing many new bank items at once

A bulk add writes every item it takes with the merchant, category, tags and note sent, each at its
own bank amount and, unless a date is sent, its own bank date, in one save. An item that changed
since the list showed it, was decided elsewhere, is gone or isn't the user's is skipped and reported.
One whose bank amount the account's currency can't hold refuses the whole add, as does any other
refusal. A double submission decides each item once, and a decision that leaves 50 or fewer
new items waiting resumes the account's paused sync at once
"""

import asyncio
import uuid
from datetime import date, timedelta

import pytest
from fastapi import HTTPException, status
from sqlalchemy import func, select

from app.models.bank_transaction import OBSERVATION_COLUMNS, BankTransaction, BankTransactionDisposition
from app.models.transaction import Transaction
from app.services.bank_sync import bulk_review, review_pause
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
    _import_a_file,
    _ledger_rows,
    _new_group_account,
    _pause_state,
    _review_page,
    _stored_item,
    _undoable_import,
)
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.routes.support.manual_entry_helpers import NOW, _Ledger, _ledger
from tests.routes.support.query_helpers import _recorded_statements, _writes
from tests.routes.support.transaction_helpers import _get_system_category_id


async def _tesco(client, ledger: _Ledger) -> str:
    """Create the Tesco merchant and return its id"""
    tesco = await client.post("/merchants", json={"name": "Tesco"}, headers=ledger.headers)
    assert tesco.status_code == 201, tesco.text
    return tesco.json()["id"]


async def _three_waiting(client) -> tuple[_Ledger, str, list[uuid.UUID]]:
    """Sign up with -23.40 and -4.50 waiting on Everyday and -120.00 waiting on Savings, each on the bank's date

    Returns:
        The ledger, the Tesco merchant's id and the items' ids in that order
    """
    ledger = await _ledger(client)
    merchant_id = await _tesco(client, ledger)
    item_ids = [
        await _commit_review_item(ledger.everyday_id, "TRN-1001", observed_amount=-2340),
        await _commit_review_item(ledger.everyday_id, "TRN-1002", observed_amount=-450),
        await _commit_review_item(ledger.savings_id, "TRN-1003", observed_amount=-12000),
    ]
    return ledger, merchant_id, item_ids


def _sent(*item_ids: uuid.UUID, version: int = 1) -> list[dict]:
    """Return the items as a bulk request sends them, each at the version given"""
    return [{"id": str(item_id), "version": version} for item_id in item_ids]


async def _bulk_add(client, ledger: _Ledger, merchant_id: str, items: list[dict], **values):
    """Add the items through the route as Tesco and Coffee, with any values added or replaced"""
    payload = {"items": items, "merchant_id": merchant_id, "category_id": ledger.category_id, **values}
    return await client.post("/bank-review/items/bulk-add", json=payload, headers=ledger.headers)


async def _bulk_dismiss(client, headers, items: list[dict]):
    """Dismiss the items through the route"""
    return await client.post("/bank-review/items/bulk-dismiss", json={"items": items}, headers=headers)


async def _ledger_values(account_id: str) -> list[tuple]:
    """Return each of the account's ledger transactions' date, amount, merchant, category and note, by amount"""
    async with TestSession() as session:
        rows = await session.execute(
            select(Transaction.dt, Transaction.amount, Transaction.merchant_id, Transaction.category_id, Transaction.notes)
            .where(Transaction.account_id == uuid.UUID(account_id))
            .order_by(Transaction.amount)
        )
        return [(dt, amount, str(merchant_id), str(category_id), notes) for dt, amount, merchant_id, category_id, notes in rows]


async def test_adding_three_items_writes_each_at_its_bank_amount_with_the_values_sent(client):
    """Each item becomes a Tesco and Coffee transaction with the note at its own amount and date, and the cache mark is the last write"""
    ledger, merchant_id, item_ids = await _three_waiting(client)
    before = await _changed_at(client, ledger.headers)

    with _recorded_statements() as statements:
        added = await _bulk_add(client, ledger, merchant_id, _sent(*item_ids), notes="Weekly shop")

    assert added.status_code == 200, added.text
    assert added.json() == {"decided_ids": [str(item_id) for item_id in item_ids], "skipped_ids": []}
    coffee = ledger.category_id
    assert await _ledger_values(ledger.everyday_id) == [
        (BANK_DATE, -2340, merchant_id, coffee, "Weekly shop"),
        (BANK_DATE, -450, merchant_id, coffee, "Weekly shop"),
    ]
    assert await _ledger_values(ledger.savings_id) == [(BANK_DATE, -12000, merchant_id, coffee, "Weekly shop")]
    assert await _balances(ledger.everyday_id) == [(BANK_DATE, -2790)]
    for item_id in item_ids:
        stored = await _stored_item(item_id)
        assert stored.disposition == BankTransactionDisposition.ACCEPTED
        assert (stored.aligned_date, stored.aligned_amount) == (stored.observed_date, stored.observed_amount)
    assert await _review_page(client, ledger.headers) == EMPTY_REVIEW_PAGE
    assert await _changed_at(client, ledger.headers) != before
    assert "user_cache_states" in _writes(statements)[-1]


async def test_adding_with_a_date_writes_every_item_on_that_date_and_marks_it_edited(client):
    """Sent 1 October, both Everyday items land on it, still at their own amounts, aligned with the bank's date"""
    ledger, merchant_id, item_ids = await _three_waiting(client)

    added = await _bulk_add(client, ledger, merchant_id, _sent(*item_ids[:2]), dt="2026-10-01")

    assert added.status_code == 200, added.text
    assert sorted(await _ledger_rows(ledger.everyday_id)) == [(date(2026, 10, 1), -2340), (date(2026, 10, 1), -450)]
    assert (await _stored_item(item_ids[0])).aligned_date == BANK_DATE


async def test_adding_skips_an_item_that_changed(client):
    """The -4.50 moved to version 2 since the list showed it, so only the -23.40 is added"""
    ledger, merchant_id, (tesco_id, coffee_id, _) = await _three_waiting(client)
    async with TestSession() as session:
        changed = await session.get_one(BankTransaction, coffee_id)
        changed.observed_amount = -500
        await session.commit()

    added = await _bulk_add(client, ledger, merchant_id, _sent(tesco_id, coffee_id))

    assert added.status_code == 200, added.text
    assert added.json() == {"decided_ids": [str(tesco_id)], "skipped_ids": [str(coffee_id)]}
    assert await _ledger_rows(ledger.everyday_id) == [(BANK_DATE, -2340)]
    assert (await _stored_item(coffee_id)).disposition == BankTransactionDisposition.AWAITING_REVIEW


async def test_adding_an_item_the_currency_cant_hold_adds_none(client):
    """The bank's -12.345 can't be stored in cents, so its amount has to be typed in, and the -23.40 sent with it waits too"""
    ledger, merchant_id, (tesco_id, _, _) = await _three_waiting(client)
    unstorable_id = await _commit_review_item(ledger.everyday_id, "TRN-1004", observed_amount=None, raw_amount="-12.345")

    added = await _bulk_add(client, ledger, merchant_id, _sent(tesco_id, unstorable_id))

    assert added.status_code == 422, added.text
    assert added.json()["detail"] == "An item needs its amount entered on its own, so nothing was saved. Add it by itself or untick it"
    assert await _ledger_rows(ledger.everyday_id) == []
    for item_id in (tesco_id, unstorable_id):
        assert (await _stored_item(item_id)).disposition == BankTransactionDisposition.AWAITING_REVIEW


async def test_a_refusal_after_the_first_add_undoes_every_item(client, monkeypatch):
    """The second item's write is refused once the first is written, so neither is in the ledger and both still wait"""
    ledger, merchant_id, item_ids = await _three_waiting(client)
    write_new_item = bulk_review.write_new_item
    calls = 0

    async def refuse_the_second(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Refused")
        return await write_new_item(*args, **kwargs)

    monkeypatch.setattr(bulk_review, "write_new_item", refuse_the_second)

    added = await _bulk_add(client, ledger, merchant_id, _sent(*item_ids[:2]))

    assert added.status_code == 422, added.text
    assert await _ledger_rows(ledger.everyday_id) == []
    for item_id in item_ids[:2]:
        assert (await _stored_item(item_id)).disposition == BankTransactionDisposition.AWAITING_REVIEW


async def test_adding_with_a_transfer_category_is_refused_whole(client):
    """A transfer needs the account on its other side, which a bulk add has none of, so neither item is added"""
    ledger, merchant_id, item_ids = await _three_waiting(client)
    transfer_id = await _get_system_category_id(client, ledger.headers, "Transfer")

    added = await _bulk_add(client, ledger, merchant_id, _sent(*item_ids[:2]), category_id=transfer_id)

    assert added.status_code == 422, added.text
    assert await _ledger_rows(ledger.everyday_id) == []


@pytest.mark.parametrize("missing", ["merchant_id", "category_id"])
async def test_adding_without_a_merchant_or_category_is_refused(client, missing):
    """Both are required, as for one item"""
    ledger, merchant_id, item_ids = await _three_waiting(client)
    payload = {"items": _sent(item_ids[0]), "merchant_id": merchant_id, "category_id": ledger.category_id}
    del payload[missing]

    added = await client.post("/bank-review/items/bulk-add", json=payload, headers=ledger.headers)

    assert added.status_code == 422, added.text
    assert await _ledger_rows(ledger.everyday_id) == []


async def test_a_double_submitted_bulk_add_adds_each_item_once(client):
    """Both requests queue behind the items. The first adds both and the second finds them decided and skips them"""
    ledger, merchant_id, item_ids = await _three_waiting(client)
    items = _sent(*item_ids[:2])

    async with asyncio.timeout(10), TestSession() as holder:
        await holder.execute(select(BankTransaction.id).where(BankTransaction.id.in_(item_ids[:2])).with_for_update())
        holder_pid = await holder.scalar(select(func.pg_backend_pid()))
        both = asyncio.gather(_bulk_add(client, ledger, merchant_id, items), _bulk_add(client, ledger, merchant_id, items))
        await _wait_until_waiting_on(holder_pid, both, waiters=2)
        await holder.commit()
        first, second = await both

    assert (first.status_code, second.status_code) == (200, 200), (first.text, second.text)
    answers = sorted([first.json(), second.json()], key=lambda answer: len(answer["decided_ids"]))
    ids = [str(item_id) for item_id in item_ids[:2]]
    assert answers == [{"decided_ids": [], "skipped_ids": ids}, {"decided_ids": ids, "skipped_ids": []}]
    assert sorted(await _ledger_rows(ledger.everyday_id)) == [(BANK_DATE, -2340), (BANK_DATE, -450)]


async def test_a_bulk_decision_skips_items_that_arent_the_users_own_and_leaves_them_alone(client):
    """Another user's item and one on a Smith Family account the user administers are skipped, and only the user's own is decided"""
    ledger, merchant_id, (tesco_id, *_) = await _three_waiting(client)
    theirs = await _commit_other_users_account()
    their_id = await _commit_review_item(theirs.id, "TRN-2001")
    group_id = await _commit_review_item(await _new_group_account(client, ledger.headers), "TRN-2002", owner_id=ledger.user_id)

    added = await _bulk_add(client, ledger, merchant_id, _sent(tesco_id, their_id))
    dismissed = await _bulk_dismiss(client, ledger.headers, _sent(their_id, group_id))

    assert added.status_code == 200, added.text
    assert added.json() == {"decided_ids": [str(tesco_id)], "skipped_ids": [str(their_id)]}
    assert dismissed.status_code == 200, dismissed.text
    assert dismissed.json() == {"decided_ids": [], "skipped_ids": [str(their_id), str(group_id)]}
    for item_id in (their_id, group_id):
        stored = await _stored_item(item_id)
        assert (stored.disposition, stored.version) == (BankTransactionDisposition.AWAITING_REVIEW, 1)


async def test_dismissing_keeps_only_each_items_identity_and_leaves_a_file_import_undoable(client):
    """Both Everyday items are dismissed with their bank values cleared, the Savings one still waits, and the Wallet file can still be undone"""
    ledger, _, item_ids = await _three_waiting(client)
    await _import_a_file(client, ledger.headers)

    with _recorded_statements() as statements:
        dismissed = await _bulk_dismiss(client, ledger.headers, _sent(*item_ids[:2]))

    assert dismissed.status_code == 200, dismissed.text
    assert dismissed.json() == {"decided_ids": [str(item_id) for item_id in item_ids[:2]], "skipped_ids": []}
    for item_id in item_ids[:2]:
        stored = await _stored_item(item_id)
        assert stored.disposition == BankTransactionDisposition.DISMISSED
        assert {column: getattr(stored, column) for column in OBSERVATION_COLUMNS} == dict.fromkeys(OBSERVATION_COLUMNS)
    assert (await _stored_item(item_ids[2])).disposition == BankTransactionDisposition.AWAITING_REVIEW
    assert await _ledger_rows(ledger.everyday_id) == []
    assert await _undoable_import(client, ledger.headers) is not None
    assert "user_cache_states" in _writes(statements)[-1]


async def test_dismissing_skips_an_item_added_since_and_one_that_changed(client):
    """The -23.40 was added in another window, at the version the list showed, and the -4.50 moved on since. Both are left as they are"""
    ledger, merchant_id, (tesco_id, coffee_id, _) = await _three_waiting(client)
    added = await _bulk_add(client, ledger, merchant_id, _sent(tesco_id))
    assert added.status_code == 200, added.text
    async with TestSession() as session:
        changed = await session.get_one(BankTransaction, coffee_id)
        changed.observed_amount = -500
        await session.commit()

    dismissed = await _bulk_dismiss(client, ledger.headers, _sent(tesco_id, coffee_id))

    assert dismissed.status_code == 200, dismissed.text
    assert dismissed.json() == {"decided_ids": [], "skipped_ids": [str(tesco_id), str(coffee_id)]}
    assert (await _stored_item(tesco_id)).disposition == BankTransactionDisposition.ACCEPTED
    assert (await _stored_item(coffee_id)).disposition == BankTransactionDisposition.AWAITING_REVIEW


@pytest.mark.parametrize("path", ["bulk-add", "bulk-dismiss"])
async def test_a_bulk_decision_of_more_than_1000_items_is_refused(client, path):
    """One selection spans review items and ledger rows, and takes at most 1000"""
    ledger = await _ledger(client)
    merchant_id = await _tesco(client, ledger)
    payload = {"merchant_id": merchant_id, "category_id": ledger.category_id}
    items = [{"id": str(uuid.uuid4()), "version": 1} for _ in range(1001)]

    too_many = await client.post(f"/bank-review/items/{path}", json={"items": items, **payload}, headers=ledger.headers)
    most = await client.post(f"/bank-review/items/{path}", json={"items": items[:1000], **payload}, headers=ledger.headers)

    assert too_many.status_code == 422, too_many.text
    assert [error["loc"] for error in too_many.json()["detail"]] == [["body", "items"]]
    assert most.status_code == 200, most.text
    assert len(most.json()["skipped_ids"]) == 1000


@pytest.mark.parametrize(
    ("waiting", "pause_state"),
    [(53, (True, NOW + timedelta(days=1), [])), (52, (False, NOW, ["scheduled"]))],
    ids=["leaves_51", "leaves_50"],
)
@pytest.mark.parametrize("path", ["bulk-add", "bulk-dismiss"])
async def test_deciding_two_items_that_leaves_50_waiting_resumes_the_paused_sync_at_once(client, pin_clock, path, waiting, pause_state):
    """Everyday is paused for review with two items among its new items waiting. Deciding both leaves 51 or 50, and 50 lifts the pause"""
    pin_clock(NOW, review_pause)
    ledger, merchant_id, item_ids = await _three_waiting(client)
    link = await _commit_paused_link(ledger.everyday_id, NOW)
    await _commit_waiting_items(link, waiting - 2)
    items = _sent(*item_ids[:2])

    decided = await (_bulk_add(client, ledger, merchant_id, items) if path == "bulk-add" else _bulk_dismiss(client, ledger.headers, items))

    assert decided.status_code == 200, decided.text
    assert len(decided.json()["decided_ids"]) == 2
    assert await _pause_state(link) == pause_state
