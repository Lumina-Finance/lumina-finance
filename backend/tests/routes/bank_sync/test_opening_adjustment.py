"""Offering an account's one-time opening adjustment once its import is reviewed, and recording or skipping it

The offer is the bank's balance minus the ledger's at the end of the bank's balance date in the
profile timezone, so one made while the import's items still wait, from a balance older than the
imported transactions, or in the wrong timezone gets the amount wrong, and one recorded twice or
with the starting balance's liability sign moves the ledger away from the bank. An answer that marks
the user's data changed ends the undo of their last import, which only recording, as it adds to the
ledger, should. Once recorded or skipped the offer never returns, and only the owner's own personal
account can answer it
"""

import asyncio
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import func, select, text, update

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState, OpeningAdjustmentState
from app.models.bank_transaction import BankTransactionDisposition
from app.models.category import Category
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.services.bank_sync import account_link, import_range, links
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _changed_at,
    _commit_bank_balance,
    _commit_link,
    _commit_listed_connection,
    _commit_other_users_account,
    _commit_review_item,
    _commit_waiting_items,
    _import_a_file,
    _link,
    _new_account,
    _new_group_account,
    _record_ledger,
    _sign_up,
    _stored_item,
    _undoable_import,
)
from tests.routes.support.lock_helpers import _cancel_unfinished, _wait_until_waiting_on
from tests.routes.support.merchant_helpers import _get_system_merchant_id
from tests.routes.support.query_helpers import _recorded_statements, _writes
from tests.routes.support.transaction_helpers import _get_system_category_id

_TORONTO = ZoneInfo("America/Toronto")

# Noon on October 5 in Toronto, the zone _sign_up stores
_NOW = datetime(2026, 10, 5, 12, 0, tzinfo=_TORONTO)

# 6:00 PM on October 3 in Toronto
_BALANCE_AT = datetime(2026, 10, 3, 18, 0, tzinfo=_TORONTO)

# Everyday's import starts on 1 June, so its opening adjustment is dated 31 May
_IMPORT_START = date(2026, 6, 1)
_ADJUSTMENT_DATE = "2026-05-31"

_NOTHING_TO_RECORD = "There is no opening balance to confirm"
_NOTHING_TO_SKIP = "There is no opening balance to skip"


@pytest.fixture(autouse=True)
def _pinned_now(pin_clock):
    """Pin the time the account link route describes the link at"""
    pin_clock(_NOW, account_link)


@dataclass(frozen=True)
class _Everyday:
    """A signed-up user's Everyday account, linked to SimpleFIN from 1 June"""

    headers: dict
    account_id: str
    link: BankAccountLink

    # The ledger transactions recorded before linking, in the order given
    ledger_ids: list[str]


async def _linked_everyday(
    client,
    *ledger: tuple[str, int],
    tz: str | None = None,
    account_kind: str = "asset",
    account_type: str = "checking",
    bank: dict | None = None,
    **link_values,
) -> _Everyday:
    """Sign up, record the ledger on a new Everyday account, give its bank account a balance and link it after its import, synced an hour ago

    The bank's balance is 1,250.00 as of _BALANCE_AT unless told otherwise
    """
    headers, user_id = await _sign_up(client)
    if tz is not None:
        moved = await client.patch("/me", json={"tz": tz}, headers=headers)
        assert moved.status_code == 200, moved.text
    account_id = await _new_account(client, headers, "Everyday", account_kind=account_kind, account_type=account_type)
    ledger_ids = await _record_ledger(client, headers, account_id, *ledger)
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    await _commit_bank_balance(connection, **{"balance": 125000, "balance_at": _BALANCE_AT, **(bank or {})})
    link = await _commit_link(account_id, connection, **{"importing": False, "last_success_at": _NOW - timedelta(hours=1), **link_values})
    async with TestSession() as session:
        await session.execute(
            update(BankAccountLink).where(BankAccountLink.id == link.id).values(import_start=_IMPORT_START, checkpoint=_NOW.date())
        )
        await session.commit()
    return _Everyday(headers, account_id, link, ledger_ids)


async def _offering_everyday(client, *ledger: tuple[str, int], **values) -> _Everyday:
    """Everyday as _linked_everyday leaves it, its link offering the opening adjustment"""
    return await _linked_everyday(client, *ledger, opening_adjustment_state=OpeningAdjustmentState.OFFERED, **values)


async def _end_import(link: BankAccountLink) -> None:
    """Commit the link's import as ended now on the database's clock, after every item committed so far"""
    async with TestSession() as session:
        await session.execute(update(BankAccountLink).where(BankAccountLink.id == link.id).values(import_ended_at=func.now()))
        await session.commit()


async def _dismiss(client, everyday: _Everyday, item_id: uuid.UUID) -> None:
    """Dismiss a waiting item through the review route"""
    dismissed = await client.post(f"/bank-review/items/{item_id}/dismiss", headers=everyday.headers)
    assert dismissed.status_code == 204, dismissed.text


async def _read_status(client, everyday: _Everyday) -> dict:
    """Read Everyday's bank link through the route"""
    response = await client.get(f"/accounts/{everyday.account_id}/bank-link", headers=everyday.headers)
    assert response.status_code == 200, response.text
    return response.json()


async def _record(client, headers: dict, account_id: str, amount: int):
    """Record the opening adjustment through the route"""
    return await client.post(f"/accounts/{account_id}/bank-link/opening-adjustment/record", json={"amount": amount}, headers=headers)


async def _skip(client, headers: dict, account_id: str):
    """Skip the opening adjustment through the route"""
    return await client.post(f"/accounts/{account_id}/bank-link/opening-adjustment/skip", headers=headers)


async def _offer_state(link: BankAccountLink) -> str:
    """Return where the link's opening adjustment stands, as committed"""
    async with TestSession() as session:
        return await session.scalar(select(BankAccountLink.opening_adjustment_state).where(BankAccountLink.id == link.id))


async def _adjustments(account_id: str) -> list[tuple]:
    """Return the date, amount, note, category and merchant of each Balance Adjustment on the account, as stored"""
    async with TestSession() as session:
        rows = await session.execute(
            select(Transaction.dt, Transaction.amount, Transaction.notes, Category.name, Merchant.name)
            .join(Category, Category.id == Transaction.category_id)
            .join(Merchant, Merchant.id == Transaction.merchant_id)
            .where(Transaction.account_id == uuid.UUID(account_id), Category.name == "Balance Adjustment")
        )
        return [tuple(row) for row in rows]


async def test_offer_waits_until_none_of_the_imports_items_is_waiting(client):
    """Everyday's import from 1 June left 3 items waiting, and a sync after it brought another

    The ledger is 1,000.00 at the end of 3 October and SimpleFIN's balance 1,250.00. Nothing is
    offered while any of the import's 3 waits. Reviewing the last offers 250.00 on May 31, 2026,
    though the later sync's item still waits, and the status reads as an opening balance to confirm
    """
    everyday = await _linked_everyday(client, ("2026-09-15", 100000))
    import_items = await _commit_waiting_items(everyday.link, 3)
    await _end_import(everyday.link)
    later_item = await _commit_review_item(everyday.account_id, "TRN-later")

    for item_id in import_items[:2]:
        await _dismiss(client, everyday, item_id)
    one_waiting = await _read_status(client, everyday)
    await _dismiss(client, everyday, import_items[2])
    reviewed = await _read_status(client, everyday)

    assert (one_waiting["link"]["sync"]["state"], one_waiting["opening_adjustment"]) == ("synced", None)
    assert reviewed["link"]["sync"]["state"] == "opening_balance"
    assert reviewed["opening_adjustment"] == {"amount": 25000, "adjustment_date": _ADJUSTMENT_DATE}
    assert reviewed["balance"]["difference"] == -25000
    assert (await _stored_item(later_item)).disposition == BankTransactionDisposition.AWAITING_REVIEW


async def test_offer_reads_the_balance_date_in_the_profile_timezone_against_the_last_imported_transaction(client):
    """In Phoenix, SimpleFIN's balance at 02:00 UTC on October 4 is from 7:00 PM on October 3, the day of the import's last transaction

    That transaction, 50.00 of groceries, may have come after the balance, so nothing is offered and
    the link waits for a newer one, though on the UTC day the balance would read as a day later
    """
    everyday = await _linked_everyday(
        client,
        ("2026-09-15", 100000),
        ("2026-10-03", -5000),
        tz="America/Phoenix",
        bank={"balance_at": datetime(2026, 10, 4, 2, 0, tzinfo=UTC)},
    )
    await _commit_review_item(
        everyday.account_id,
        "TRN-groceries",
        disposition=BankTransactionDisposition.ACCEPTED,
        transaction_id=uuid.UUID(everyday.ledger_ids[1]),
        observed_date=date(2026, 10, 3),
        observed_amount=-5000,
        aligned_date=date(2026, 10, 3),
        aligned_amount=-5000,
    )
    [item_id] = await _commit_waiting_items(everyday.link, 1)
    await _end_import(everyday.link)

    await _dismiss(client, everyday, item_id)

    assert (await _read_status(client, everyday))["opening_adjustment"] is None
    assert await _offer_state(everyday.link) == OpeningAdjustmentState.NOT_READY


@pytest.mark.parametrize(
    ("balance_day", "offer", "state"),
    [
        pytest.param(date(2026, 9, 30), None, OpeningAdjustmentState.NOT_READY, id="day-before"),
        pytest.param(date(2026, 10, 1), None, OpeningAdjustmentState.NOT_READY, id="same-day"),
        pytest.param(date(2026, 10, 2), {"amount": 30000, "adjustment_date": _ADJUSTMENT_DATE}, OpeningAdjustmentState.OFFERED, id="day-after"),
    ],
)
async def test_offer_waits_for_a_bank_balance_dated_after_the_last_imported_transaction(client, balance_day, offer, state):
    """The import's last transaction, 50.00 of groceries, is dated 1 October and is in the ledger with 1,000.00 of salary

    A SimpleFIN balance of 1,250.00 at 6:00 PM on 30 September or 1 October gets no offer, and the
    link waits for a newer one. On 2 October the ledger is 950.00, and 300.00 is offered
    """
    everyday = await _linked_everyday(
        client,
        ("2026-09-15", 100000),
        ("2026-10-01", -5000),
        bank={"balance_at": datetime.combine(balance_day, _BALANCE_AT.timetz())},
    )
    await _commit_review_item(
        everyday.account_id,
        "TRN-groceries",
        disposition=BankTransactionDisposition.ACCEPTED,
        transaction_id=uuid.UUID(everyday.ledger_ids[1]),
        observed_date=date(2026, 10, 1),
        observed_amount=-5000,
        aligned_date=date(2026, 10, 1),
        aligned_amount=-5000,
    )
    [item_id] = await _commit_waiting_items(everyday.link, 1)
    await _end_import(everyday.link)

    await _dismiss(client, everyday, item_id)

    assert (await _read_status(client, everyday))["opening_adjustment"] == offer
    assert await _offer_state(everyday.link) == state


@pytest.mark.parametrize(
    ("bank_balance", "state"),
    [
        pytest.param(125000, OpeningAdjustmentState.NONE, id="balances-match"),
        pytest.param(None, OpeningAdjustmentState.NOT_READY, id="balance-cant-be-read"),
    ],
)
async def test_no_offer_when_the_ledger_matches_the_bank_or_the_bank_gives_no_balance_it_can_read(client, bank_balance, state):
    """The ledger is 1,250.00 at the end of 3 October

    SimpleFIN's 1,250.00 matches, so nothing is ever offered. A balance it sent with more decimals than
    CAD holds can't be compared, so the link waits for one that can
    """
    everyday = await _linked_everyday(client, ("2026-09-15", 125000), bank={"balance": bank_balance})
    [item_id] = await _commit_waiting_items(everyday.link, 1)
    await _end_import(everyday.link)

    await _dismiss(client, everyday, item_id)

    status = await _read_status(client, everyday)
    assert (status["link"]["sync"]["state"], status["opening_adjustment"]) == ("synced", None)
    assert await _offer_state(everyday.link) == state


async def test_adding_the_imports_last_waiting_item_to_the_ledger_offers_the_adjustment(client):
    """Everyday's import left the bank's 12.50 coffee from 3 October waiting, and SimpleFIN's 1,250.00 is dated 4 October

    Adding the coffee to the ledger leaves 987.50 there and nothing of the import's waiting, so
    262.50 is offered
    """
    everyday = await _linked_everyday(client, ("2026-09-15", 100000), bank={"balance_at": _BALANCE_AT + timedelta(days=1)})
    [item_id] = await _commit_waiting_items(everyday.link, 1)
    await _end_import(everyday.link)
    entry = {
        "dt": "2026-10-03",
        "amount": -1250,
        "category_id": await _get_system_category_id(client, everyday.headers, "Groceries"),
        "merchant_id": await _get_system_merchant_id(client, everyday.headers),
    }

    added = await client.post(f"/bank-review/items/{item_id}/add", json=entry, headers=everyday.headers)

    assert added.status_code == 201, added.text
    assert (await _read_status(client, everyday))["opening_adjustment"] == {"amount": 26250, "adjustment_date": _ADJUSTMENT_DATE}


async def test_offer_waits_for_an_import_whose_end_is_not_on_record(client):
    """Everyday's link has no import end on record, so dismissing its one waiting item offers nothing, though the balances differ"""
    everyday = await _linked_everyday(client, ("2026-09-15", 100000))
    [item_id] = await _commit_waiting_items(everyday.link, 1)

    await _dismiss(client, everyday, item_id)

    assert await _offer_state(everyday.link) == OpeningAdjustmentState.NOT_READY


@pytest.mark.parametrize(
    ("before", "after"),
    [
        pytest.param(OpeningAdjustmentState.OFFERED, OpeningAdjustmentState.NOT_READY, id="offered"),
        pytest.param(OpeningAdjustmentState.NONE, OpeningAdjustmentState.NOT_READY, id="nothing-to-offer"),
        pytest.param(OpeningAdjustmentState.RECORDED, OpeningAdjustmentState.RECORDED, id="recorded"),
        pytest.param(OpeningAdjustmentState.SKIPPED, OpeningAdjustmentState.SKIPPED, id="skipped"),
    ],
)
async def test_choosing_the_bank_account_again_waits_for_its_import_unless_the_offer_was_answered(client, pin_clock, before, after):
    """Everyday waits in Choose bank account with 1,000.00 in the ledger and an item from its import waiting

    Choosing ACT-1 again starts a new import. A sync part has synced it while it runs when the user
    dismisses the item, and an offer not answered waits for the import to end rather than offering
    250.00 from what it has brought so far. One recorded or skipped stays answered. The earlier
    import's end is forgotten, so the new import's end is the one its items are judged by
    """
    pin_clock(_NOW, links, import_range)
    everyday = await _linked_everyday(client, ("2026-09-15", 100000), state=BankLinkState.CHOOSE_ACCOUNT, opening_adjustment_state=before)
    [item_id] = await _commit_waiting_items(everyday.link, 1)
    await _end_import(everyday.link)

    chosen = await _link(client, everyday.headers, everyday.account_id, everyday.link.connection_id, start_date=date(2026, 9, 16))
    async with TestSession() as session:
        await session.execute(update(BankAccountLink).where(BankAccountLink.id == everyday.link.id).values(last_success_at=_NOW))
        await session.commit()
    await _dismiss(client, everyday, item_id)

    assert chosen.status_code == 201, chosen.text
    assert await _offer_state(everyday.link) == after
    async with TestSession() as session:
        assert await session.scalar(select(BankAccountLink.import_ended_at).where(BankAccountLink.id == everyday.link.id)) is None


@pytest.mark.parametrize(
    ("amount", "difference"),
    [pytest.param(25000, 0, id="as-offered"), pytest.param(24000, -1000, id="overwritten")],
)
async def test_recording_adds_one_balance_adjustment_the_day_before_the_import_start(client, amount, difference):
    """Everyday offers 250.00 with 1,000.00 in the ledger and SimpleFIN at 1,250.00

    Recording 250.00, or 240.00 typed over it, adds that Balance Adjustment from Myself on 31 May,
    before the days SimpleFIN supplies. The offer is gone and Difference shows what remains, with the
    cache mark the last write
    """
    everyday = await _offering_everyday(client, ("2026-09-15", 100000))
    before = await _changed_at(client, everyday.headers)

    with _recorded_statements() as statements:
        recorded = await _record(client, everyday.headers, everyday.account_id, amount)

    assert recorded.status_code == 200, recorded.text
    body = recorded.json()
    assert (body["link"]["sync"]["state"], body["opening_adjustment"], body["balance"]["difference"]) == ("synced", None, difference)
    assert await _adjustments(everyday.account_id) == [(date(2026, 5, 31), amount, "Opening adjustment", "Balance Adjustment", "Myself")]
    assert await _offer_state(everyday.link) == OpeningAdjustmentState.RECORDED
    assert await _changed_at(client, everyday.headers) != before
    assert "user_cache_states" in _writes(statements)[-1]


async def test_recording_a_cards_adjustment_keeps_the_sign_offered(client):
    """Everyday is a credit card here, owing 300.00 in the ledger and 320.00 at SimpleFIN, so 20.00 more owed is offered

    It is recorded with the sign offered. A starting balance is stated as what's owed and negated for
    a card, which here would close the gap the wrong way
    """
    everyday = await _offering_everyday(
        client, ("2026-09-15", -30000), account_kind="revolving", account_type="credit_card", bank={"balance": -32000}
    )
    offered = (await _read_status(client, everyday))["opening_adjustment"]

    recorded = await _record(client, everyday.headers, everyday.account_id, offered["amount"])

    assert recorded.status_code == 200, recorded.text
    assert offered["amount"] == -2000
    assert recorded.json()["balance"]["difference"] == 0
    assert [amount for _, amount, *_ in await _adjustments(everyday.account_id)] == [-2000]


async def test_an_offer_the_ledger_catches_up_with_shows_nothing_and_ends_at_the_next_review_decision(client):
    """Everyday offers 250.00, and the user records the 250.00 by hand on 31 May instead

    The ledger matches SimpleFIN, so the offer shows nothing from then on and the status no longer
    asks for an opening balance, and the next review decision ends it
    """
    everyday = await _offering_everyday(client, ("2026-09-15", 100000))
    [item_id] = await _commit_waiting_items(everyday.link, 1)
    await _record_ledger(client, everyday.headers, everyday.account_id, ("2026-05-31", 25000))

    caught_up = await _read_status(client, everyday)
    await _dismiss(client, everyday, item_id)
    ended = await _read_status(client, everyday)

    assert (caught_up["link"]["sync"]["state"], caught_up["opening_adjustment"], caught_up["balance"]["difference"]) == ("synced", None, 0)
    assert (ended["link"]["sync"]["state"], ended["opening_adjustment"]) == ("synced", None)
    assert await _offer_state(everyday.link) == OpeningAdjustmentState.NONE


async def test_skipping_records_nothing_and_the_offer_never_returns(client):
    """Skipping Everyday's 250.00 leaves the ledger as it was, and a later review decision doesn't offer it again

    The cache mark is the last write
    """
    everyday = await _offering_everyday(client, ("2026-09-15", 100000))
    before = await _changed_at(client, everyday.headers)

    with _recorded_statements() as statements:
        skipped = await _skip(client, everyday.headers, everyday.account_id)
    [item_id] = await _commit_waiting_items(everyday.link, 1)
    await _end_import(everyday.link)
    await _dismiss(client, everyday, item_id)

    assert skipped.status_code == 200, skipped.text
    body = skipped.json()
    assert (body["link"]["sync"]["state"], body["opening_adjustment"], body["balance"]["difference"]) == ("synced", None, -25000)
    assert "user_cache_states" in _writes(statements)[-1]
    assert await _changed_at(client, everyday.headers) != before
    assert await _adjustments(everyday.account_id) == []
    assert (await _read_status(client, everyday))["opening_adjustment"] is None
    assert await _offer_state(everyday.link) == OpeningAdjustmentState.SKIPPED


@pytest.mark.parametrize(("answer", "undoable"), [("skip", True), ("record", False)], ids=["skip", "record"])
async def test_only_recording_ends_the_undo_of_the_last_import(client, answer, undoable):
    """The user imported a file, then skipped or recorded Everyday's offered 250.00

    A skip changes none of their data, so the import can still be undone. Recording adds a ledger
    transaction, which makes the import permanent
    """
    everyday = await _offering_everyday(client, ("2026-09-15", 100000))
    await _import_a_file(client, everyday.headers)

    if answer == "skip":
        answered = await _skip(client, everyday.headers, everyday.account_id)
    else:
        answered = await _record(client, everyday.headers, everyday.account_id, 25000)

    assert answered.status_code == 200, answered.text
    assert answered.json()["opening_adjustment"] is None
    assert (await _undoable_import(client, everyday.headers) is not None) is undoable


@pytest.mark.parametrize(
    ("first", "second", "second_answer", "state", "recorded"),
    [
        pytest.param("record", "record", (200, None), OpeningAdjustmentState.RECORDED, 1, id="record-twice"),
        pytest.param("skip", "skip", (200, None), OpeningAdjustmentState.SKIPPED, 0, id="skip-twice"),
        pytest.param("record", "skip", (409, _NOTHING_TO_SKIP), OpeningAdjustmentState.RECORDED, 1, id="skip-after-record"),
        pytest.param("skip", "record", (409, _NOTHING_TO_RECORD), OpeningAdjustmentState.SKIPPED, 0, id="record-after-skip"),
    ],
)
async def test_a_second_answer_arriving_mid_flight_finds_the_first(client, first, second, second_answer, state, recorded):
    """A sync holds Everyday's link while both answers arrive, the second queued behind the first

    The first answers as it would alone. A second answer the same way answers the same without
    writing, so a double-clicked Record adjustment records once, and one the other way is refused
    """
    everyday = await _offering_everyday(client, ("2026-09-15", 100000))
    answers = {
        "record": lambda: _record(client, everyday.headers, everyday.account_id, 25000),
        "skip": lambda: _skip(client, everyday.headers, everyday.account_id),
    }

    requests: list[asyncio.Task] = []
    try:
        async with asyncio.timeout(10), TestSession() as holder:
            await holder.execute(select(BankAccountLink.id).where(BankAccountLink.id == everyday.link.id).with_for_update())
            holder_pid = await holder.scalar(select(func.pg_backend_pid()))
            with _recorded_statements() as statements:
                requests.append(asyncio.create_task(answers[first]()))
                await _wait_until_waiting_on(holder_pid, requests[0])
                requests.append(asyncio.create_task(answers[second]()))
                await _wait_until_waiting_on(holder_pid, asyncio.gather(*requests), waiters=2)
                await holder.commit()
                first_response, second_response = await asyncio.gather(*requests)
    finally:
        await _cancel_unfinished(requests)

    # Skipping twice ends the same either way, so only the link written once shows the second found the first
    assert len([write for write in _writes(statements) if write.startswith("UPDATE bank_account_links")]) == 1
    assert first_response.status_code == 200, first_response.text
    assert second_response.status_code == second_answer[0], second_response.text
    if second_answer[1] is not None:
        assert second_response.json()["detail"] == second_answer[1]
    assert second_response.status_code != 200 or second_response.json()["opening_adjustment"] is None
    assert len(await _adjustments(everyday.account_id)) == recorded
    assert await _offer_state(everyday.link) == state


async def test_recording_locks_the_connection_before_the_account(client):
    """Accept bank change holds Everyday's connection while recording waits for it, then takes Everyday shared, as its days check does

    Recording hasn't taken the account while it waits, so Accept bank change gets it at once rather
    than deadlocking, and recording goes ahead once it commits
    """
    everyday = await _offering_everyday(client, ("2026-09-15", 100000))

    requests: list[asyncio.Task] = []
    try:
        async with asyncio.timeout(10), TestSession() as accepting:
            await accepting.execute(text("SET LOCAL lock_timeout = '2s'"))
            await accepting.execute(
                select(BankConnection.id).where(BankConnection.id == everyday.link.connection_id).with_for_update(key_share=True)
            )
            accepting_pid = await accepting.scalar(select(func.pg_backend_pid()))
            requests.append(asyncio.create_task(_record(client, everyday.headers, everyday.account_id, 25000)))
            await _wait_until_waiting_on(accepting_pid, requests[0])
            await accepting.execute(select(Account.id).where(Account.id == uuid.UUID(everyday.account_id)).with_for_update(read=True))
            await accepting.commit()
            recorded = await requests[0]
    finally:
        await _cancel_unfinished(requests)

    assert recorded.status_code == 200, recorded.text
    assert [amount for _, amount, *_ in await _adjustments(everyday.account_id)] == [25000]


@pytest.mark.parametrize(
    "link_values",
    [
        pytest.param({"opening_adjustment_state": OpeningAdjustmentState.NOT_READY}, id="not-ready"),
        pytest.param({"opening_adjustment_state": OpeningAdjustmentState.NONE}, id="nothing-to-offer"),
        pytest.param({"opening_adjustment_state": OpeningAdjustmentState.OFFERED, "state": BankLinkState.CHOOSE_ACCOUNT}, id="choose-account"),
    ],
)
async def test_answering_is_refused_while_nothing_is_offered(client, link_values):
    """Everyday isn't ready to offer, had nothing to offer, or waits for its bank account to be chosen again

    Both answers are refused, and nothing is recorded or changed
    """
    everyday = await _linked_everyday(client, ("2026-09-15", 100000), **link_values)

    recorded = await _record(client, everyday.headers, everyday.account_id, 25000)
    skipped = await _skip(client, everyday.headers, everyday.account_id)

    assert recorded.status_code == 409, recorded.text
    assert recorded.json()["detail"] == _NOTHING_TO_RECORD
    assert skipped.status_code == 409, skipped.text
    assert skipped.json()["detail"] == _NOTHING_TO_SKIP
    assert await _adjustments(everyday.account_id) == []
    assert await _offer_state(everyday.link) == link_values["opening_adjustment_state"]


@pytest.mark.parametrize("answer", ["record", "skip"])
async def test_answering_for_an_unlinked_account_a_group_account_or_another_users_account_is_refused(client, answer):
    """Savings isn't linked, Joint belongs to the Smith Family group and Theirs to another user"""
    headers, _ = await _sign_up(client)
    savings_id = await _new_account(client, headers, "Savings")
    joint_id = await _new_group_account(client, headers)
    theirs = await _commit_other_users_account()

    refusals = []
    for account_id in (savings_id, joint_id, str(theirs.id)):
        response = await (_record(client, headers, account_id, 25000) if answer == "record" else _skip(client, headers, account_id))
        refusals.append((response.status_code, response.json()["detail"]))

    assert refusals == [
        (404, "This account is not linked to a bank"),
        (403, "Accounts shared with a group can't be linked to a bank yet"),
        (404, "Account not found"),
    ]


async def test_recording_nothing_is_refused(client):
    """An adjustment of 0.00 records nothing, which Skip stands for, so it's refused and the offer stays"""
    everyday = await _offering_everyday(client, ("2026-09-15", 100000))

    refused = await _record(client, everyday.headers, everyday.account_id, 0)

    assert refused.status_code == 422, refused.text
    assert (await _read_status(client, everyday))["opening_adjustment"] == {"amount": 25000, "adjustment_date": _ADJUSTMENT_DATE}
    assert await _adjustments(everyday.account_id) == []
