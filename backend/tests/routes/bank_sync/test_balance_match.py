"""Offering a linked account's balance match whenever its ledger and the bank's balance differ, and recording it

The offer is the bank's balance minus the ledger's at the end of the bank's balance date in the
profile timezone, less what approving the account's items still waiting for review would change by
then, since the bank's balance already holds them. One counting waiting items as the ledger's or
ones dated later, or recorded twice or with the starting balance's liability sign, moves the ledger
away from the bank. The offer holds no state, so it returns whenever a gap opens again, and a
request answering an offer that has moved since records nothing. Only the owner's own personal
account can record one
"""

import asyncio
import contextvars
import dataclasses
import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from freezegun import freeze_time
from sqlalchemy import func, select, text, update

from app.encryption import encrypt
from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection, BankExternalAccount, BankLinkState
from app.models.bank_sync_job import BankSyncJob
from app.models.bank_transaction import BankTransactionDisposition, OpenReviewKind
from app.models.category import Category
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.services.bank_sync import account_link, range_import, sync, worker
from app.services.bank_sync.providers.contract import FetchResult, ProviderRecord
from tests.conftest import ScopedSession, TestSession
from tests.routes.support.balance_match_helpers import _BALANCE_AT, _NOW, _Everyday, _linked_everyday
from tests.routes.support.bank_sync_helpers import (
    BANK_ACCOUNT_ID,
    _changed_at,
    _commit_other_users_account,
    _commit_review_item,
    _import_a_file,
    _new_account,
    _new_group_account,
    _record_ledger,
    _sign_up,
    _undoable_import,
)
from tests.routes.support.lock_helpers import _cancel_unfinished, _wait_until_waiting_on
from tests.routes.support.merchant_helpers import _get_system_merchant_id
from tests.routes.support.query_helpers import _recorded_statements, _writes
from tests.routes.support.transaction_helpers import _get_system_category_id
from tests.services.bank_sync.fake_provider import _bank_account

# Everyday's import starts on 1 June, so its balance match is dated 31 May
_ADJUSTMENT_DATE = "2026-05-31"

_NOTHING_TO_MATCH = "There is no difference to match"
_MATCH_MOVED = "The difference has changed. Check the new amount and try again"

# When Fake Bank reported a transaction removed, the morning after the balance
_REMOVED_AT = datetime(2026, 10, 4, 9, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _pinned_now(pin_clock):
    """Pin the time the account link route describes the link at"""
    pin_clock(_NOW, account_link)


async def _read_status(client, everyday: _Everyday) -> dict:
    """Read Everyday's bank link through the route"""
    response = await client.get(f"/accounts/{everyday.account_id}/bank-link", headers=everyday.headers)
    assert response.status_code == 200, response.text
    return response.json()


async def _record(client, headers: dict, account_id: str, offered_amount: int, **extra):
    """Record the balance match through the route, answering the offer of the amount given"""
    body = {"offered_amount": offered_amount, **extra}
    return await client.post(f"/accounts/{account_id}/bank-link/balance-match", json=body, headers=headers)


async def _move_bank_balance(everyday: _Everyday, balance: int) -> None:
    """Commit a new balance for Everyday's bank account, as a later sync would read it"""
    async with TestSession() as session:
        await session.execute(
            update(BankExternalAccount).where(BankExternalAccount.connection_id == everyday.link.connection_id).values(balance=balance)
        )
        await session.commit()


async def _set_link(everyday: _Everyday, **values) -> None:
    """Commit values on Everyday's link"""
    async with TestSession() as session:
        await session.execute(update(BankAccountLink).where(BankAccountLink.id == everyday.link.id).values(**values))
        await session.commit()


async def _bank_source(everyday: _Everyday, ledger_id: str, **values) -> uuid.UUID:
    """Commit Fake Bank's 12.50 coffee from 3 October as the accepted source of an Everyday ledger row, with any of its values replaced

    Returns:
        Its id, also the id of any correction or removal open on it
    """
    return await _commit_review_item(
        everyday.account_id,
        "TRN-coffee",
        **{
            "disposition": BankTransactionDisposition.ACCEPTED,
            "transaction_id": uuid.UUID(ledger_id),
            "aligned_date": date(2026, 10, 3),
            "aligned_amount": -1250,
            **values,
        },
    )


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


async def _groceries(client, everyday: _Everyday, amount: int) -> dict:
    """Return the values to add a waiting item to Everyday's ledger with, as Groceries from Myself on 3 October"""
    return {
        "dt": "2026-10-03",
        "amount": amount,
        "category_id": await _get_system_category_id(client, everyday.headers, "Groceries"),
        "merchant_id": await _get_system_merchant_id(client, everyday.headers),
    }


async def test_recording_the_offered_match_adds_one_balance_adjustment_and_leaves_no_difference(client):
    """Fake Bank's balance is 1,250.00 and the ledger 1,000.00, with nothing waiting and the link synced

    250.00 is offered, dated May 31, 2026, the day before the import start, and the status reads
    synced rather than asking for anything. Recording it adds that Balance Adjustment from Myself, so
    Difference reads 0 with no offer, with the cache mark the last write
    """
    everyday = await _linked_everyday(client, ("2026-09-15", 100000))
    offered = await _read_status(client, everyday)
    before = await _changed_at(client, everyday.headers)

    with _recorded_statements() as statements:
        recorded = await _record(client, everyday.headers, everyday.account_id, 25000)

    assert offered["link"]["sync"]["state"] == "synced"
    assert offered["balance_match"] == {"amount": 25000, "waiting_amount": 0, "adjustment_date": _ADJUSTMENT_DATE}
    assert recorded.status_code == 200, recorded.text
    body = recorded.json()
    assert (body["link"]["sync"]["state"], body["balance_match"], body["balance"]["difference"]) == ("synced", None, 0)
    assert await _adjustments(everyday.account_id) == [
        (date(2026, 5, 31), 25000, "Matched to Fake Bank's balance", "Balance Adjustment", "Myself")
    ]
    assert await _changed_at(client, everyday.headers) != before
    assert "user_cache_states" in _writes(statements)[-1]


async def test_an_amount_sent_beside_the_offer_is_ignored(client):
    """Everyday offers 250.00, and a request also asks for 240.00, as an older app sent

    The offered 250.00 is recorded, so the ledger matches the bank and nothing is offered after
    """
    everyday = await _linked_everyday(client, ("2026-09-15", 100000))

    recorded = await _record(client, everyday.headers, everyday.account_id, 25000, amount=24000)

    assert recorded.status_code == 200, recorded.text
    body = recorded.json()
    assert (body["balance"]["difference"], body["balance_match"]) == (0, None)
    assert [amount for _, amount, *_ in await _adjustments(everyday.account_id)] == [25000]


async def test_a_gap_opening_after_an_earlier_match_is_offered_again(client):
    """Everyday matched Fake Bank's 1,250.00. Later the user records 30.00 from before the import and Fake Bank reports 1,300.00

    The ledger is at 1,280.00, so 20.00 is offered, though a match was recorded before
    """
    everyday = await _linked_everyday(client, ("2026-09-15", 100000))
    first = await _record(client, everyday.headers, everyday.account_id, 25000)
    assert first.status_code == 200, first.text

    await _record_ledger(client, everyday.headers, everyday.account_id, ("2026-05-20", 3000))
    await _move_bank_balance(everyday, 130000)

    assert (await _read_status(client, everyday))["balance_match"] == {"amount": 2000, "waiting_amount": 0, "adjustment_date": _ADJUSTMENT_DATE}


@pytest.mark.parametrize(
    ("ledger", "bank", "link_values"),
    [
        pytest.param(125000, {}, {}, id="balances-match"),
        pytest.param(100000, {"balance": None}, {}, id="balance-cant-be-read"),
        pytest.param(100000, {}, {"importing": True}, id="import-running"),
        pytest.param(
            100000,
            {},
            {
                "importing": True,
                "range_first_day": date(2026, 3, 1),
                "range_last_day": date(2026, 3, 31),
                "range_next_day": date(2026, 3, 1),
                "range_restores_dismissed": False,
            },
            id="date-range-import-running",
        ),
        pytest.param(100000, {}, {"last_success_at": None}, id="never-synced"),
        pytest.param(100000, {}, {"state": BankLinkState.CHOOSE_ACCOUNT}, id="choose-account"),
    ],
)
async def test_nothing_is_offered_or_recorded_while_the_ledger_matches_or_the_balances_dont_compare(client, ledger, bank, link_values):
    """The ledger is at 1,000.00 against Fake Bank's 1,250.00, unless it matches

    A ledger matching the bank leaves nothing to record. A balance sent with more decimals than CAD
    holds can't be compared, a running import hasn't brought everything in yet, and a link that
    never synced or waits for its bank account to be chosen again has no balance to compare. Each
    shows no offer, and recording is refused with nothing recorded
    """
    everyday = await _linked_everyday(client, ("2026-09-15", ledger), bank=bank)
    if link_values:
        await _set_link(everyday, **link_values)

    status = await _read_status(client, everyday)
    refused = await _record(client, everyday.headers, everyday.account_id, 25000)

    assert status["balance_match"] is None
    assert (refused.status_code, refused.json()["detail"]) == (409, _NOTHING_TO_MATCH)
    assert await _adjustments(everyday.account_id) == []


async def test_a_request_answering_an_offer_that_has_moved_is_refused(client):
    """Everyday offered 300.00 in a tab opened before the user recorded 50.00 from before the import, and 250.00 is offered now

    Recording from the old tab is refused and records nothing, so the ledger doesn't overshoot the bank
    """
    everyday = await _linked_everyday(client, ("2026-09-15", 95000))
    await _record_ledger(client, everyday.headers, everyday.account_id, ("2026-05-20", 5000))

    refused = await _record(client, everyday.headers, everyday.account_id, 30000)

    assert (refused.status_code, refused.json()["detail"]) == (409, _MATCH_MOVED)
    assert await _adjustments(everyday.account_id) == []
    assert (await _read_status(client, everyday))["balance_match"]["amount"] == 25000


async def test_recording_a_cards_match_keeps_the_sign_offered(client):
    """Everyday is a credit card here, owing 300.00 in the ledger and 320.00 at Fake Bank, so 20.00 more owed is offered

    It is recorded with the sign offered. A starting balance is stated as what's owed and negated for
    a card. Negating here would close the gap the wrong way
    """
    everyday = await _linked_everyday(
        client, ("2026-09-15", -30000), account_kind="revolving", account_type="credit_card", bank={"balance": -32000}
    )
    offered = (await _read_status(client, everyday))["balance_match"]

    recorded = await _record(client, everyday.headers, everyday.account_id, offered["amount"])

    assert recorded.status_code == 200, recorded.text
    assert offered["amount"] == -2000
    assert recorded.json()["balance"]["difference"] == 0
    assert [amount for _, amount, *_ in await _adjustments(everyday.account_id)] == [-2000]


async def test_recording_the_match_while_items_wait_brings_the_ledger_to_the_bank_once_they_are_added(client):
    """Everyday holds 50.00 and Fake Bank's balance is 100.00, with three 4.50 coffees from 3 October waiting for review

    Fake Bank's balance already holds the coffees, and adding them will take 13.50 off the ledger,
    so 63.50 is offered rather than 50.00. Recording it and adding the coffees leaves the ledger at
    Fake Bank's 100.00. The full difference would leave it at 86.50. A coffee waiting in
    Savings isn't Everyday's to count
    """
    everyday = await _linked_everyday(client, ("2026-09-15", 5000), bank={"balance": 10000})
    coffees = [await _commit_review_item(everyday.account_id, f"TRN-coffee-{number}", observed_amount=-450) for number in range(3)]
    savings_id = await _new_account(client, everyday.headers, "Savings")
    await _commit_review_item(savings_id, "TRN-savings-coffee", observed_amount=-450)
    entry = await _groceries(client, everyday, -450)

    offered = await _read_status(client, everyday)
    recorded = await _record(client, everyday.headers, everyday.account_id, offered["balance_match"]["amount"])
    assert recorded.status_code == 200, recorded.text
    for item_id in coffees:
        added = await client.post(f"/bank-review/items/{item_id}/add", json=entry, headers=everyday.headers)
        assert added.status_code == 201, added.text

    assert offered["balance_match"] == {"amount": 6350, "waiting_amount": -1350, "adjustment_date": _ADJUSTMENT_DATE}
    assert offered["balance"]["difference"] == -5000
    assert recorded.json()["balance"]["difference"] == 1350
    assert recorded.json()["balance_match"] is None
    assert (await _read_status(client, everyday))["balance"]["difference"] == 0


async def test_no_offer_when_the_items_waiting_close_the_gap(client):
    """Everyday holds 130.00 and Fake Bank's balance is 100.00, with three 10.00 coffees from 3 October waiting

    Adding the coffees will bring the ledger to Fake Bank's 100.00, so nothing is offered, though
    the balances differ by 30.00
    """
    everyday = await _linked_everyday(client, ("2026-09-15", 13000), bank={"balance": 10000})
    for number in range(3):
        await _commit_review_item(everyday.account_id, f"TRN-coffee-{number}", observed_amount=-1000)

    status = await _read_status(client, everyday)

    assert (status["balance"]["difference"], status["balance_match"]) == (3000, None)


@pytest.mark.parametrize(
    ("coffee", "source", "new_item", "bank", "offer"),
    [
        pytest.param(
            ("2026-10-03", -1250),
            {"open_kind": OpenReviewKind.CORRECTION, "previous_values": {"amount": -1250}, "observed_amount": -1500},
            None,
            {},
            (26500, -250),
            id="amount-corrected",
        ),
        pytest.param(
            ("2026-10-03", -1250),
            {"open_kind": OpenReviewKind.CORRECTION, "previous_values": {"date": "2026-10-03"}, "observed_date": date(2026, 10, 4)},
            None,
            {},
            (25000, 1250),
            id="date-corrected-past-the-balance-day",
        ),
        pytest.param(
            ("2026-10-03", -1250), {"open_kind": OpenReviewKind.REMOVAL, "removed_at": _REMOVED_AT}, None, {}, (25000, 1250), id="removed"
        ),
        pytest.param(
            ("2026-10-04", -1250),
            {
                "open_kind": OpenReviewKind.REMOVAL,
                "removed_at": _REMOVED_AT,
                "observed_date": date(2026, 10, 4),
                "aligned_date": date(2026, 10, 4),
            },
            None,
            {},
            (25000, 0),
            id="removed-after-the-balance-day",
        ),
        pytest.param(
            ("2026-10-03", -1000),
            {"open_kind": OpenReviewKind.CORRECTION, "previous_values": {"description": "HARBOUR COFFEE"}},
            None,
            {},
            (26000, 0),
            id="description-corrected-on-an-edited-amount",
        ),
        pytest.param(
            ("2026-10-03", -1250),
            {},
            {"observed_date": date(2026, 10, 4), "observed_amount": None, "raw_amount": "-4.505"},
            {},
            (26250, 0),
            id="new-item-after-the-balance-day",
        ),
        pytest.param(
            ("2026-10-03", -1250),
            {},
            {"observed_date": date(2026, 10, 4)},
            {"balance_at": datetime(2026, 10, 4, 2, 0, tzinfo=UTC)},
            (26250, 0),
            id="new-item-on-the-utc-day-after-the-balance",
        ),
        pytest.param(
            ("2026-10-03", -1250),
            {},
            {"external_account_id": "ACT-EARLIER", "observed_amount": -450},
            {},
            (26700, -450),
            id="new-item-from-a-bank-account-linked-before",
        ),
    ],
)
async def test_offer_leaves_out_what_each_waiting_item_changes_by_the_balance_date(client, coffee, source, new_item, bank, offer):
    """Everyday holds 1,000.00 and a coffee that came from Fake Bank. Its balance is 1,250.00 at 6:00 PM on 3 October

    The coffee is 12.50 from 3 October at the bank, and 10.00 in the ledger where the user edited it.
    Accepting Fake Bank's correction to 15.00 takes 2.50 more off the ledger, so 2.50 more is offered.
    Moving the coffee to 4 October, or removing it, gives back its 12.50 by 3 October, and removing
    it when it is from 4 October gives back nothing. A changed description moves nothing, though the
    user's 10.00 differs from the bank's 12.50. A new item from 4 October lands after the balance, so
    it counts for nothing and its amount, sent with more decimals than CAD holds, holds nothing back.
    So does a 12.50 one when the balance is read at 10:00 PM on 3 October in Toronto, already 4
    October in UTC. A 4.50 coffee from 3 October waiting from another bank account Everyday was
    linked to before counts too
    """
    everyday = await _linked_everyday(client, ("2026-09-15", 100000), coffee, bank=bank)
    await _bank_source(everyday, everyday.ledger_ids[1], **source)
    if new_item is not None:
        await _commit_review_item(everyday.account_id, "TRN-later", **new_item)

    status = await _read_status(client, everyday)

    amount, waiting_amount = offer
    assert status["balance_match"] == {"amount": amount, "waiting_amount": waiting_amount, "adjustment_date": _ADJUSTMENT_DATE}


async def test_an_item_waiting_with_an_amount_the_currency_cant_hold_keeps_the_offer_back_until_it_is_decided(client):
    """Fake Bank sent a coffee from 3 October as 12.505, more decimals than CAD holds, so what adding it takes off the ledger isn't known

    Nothing is offered while the coffee waits, rather than rounding it. Dismissing it offers the
    250.00 the ledger and Fake Bank differ by
    """
    everyday = await _linked_everyday(client, ("2026-09-15", 100000))
    coffee = await _commit_review_item(everyday.account_id, "TRN-raw-coffee", observed_amount=None, raw_amount="-12.505")

    waiting = await _read_status(client, everyday)
    dismissed = await client.post(f"/bank-review/items/{coffee}/dismiss", headers=everyday.headers)

    assert dismissed.status_code == 204, dismissed.text
    assert waiting["balance_match"] is None
    assert (await _read_status(client, everyday))["balance_match"] == {
        "amount": 25000,
        "waiting_amount": 0,
        "adjustment_date": _ADJUSTMENT_DATE,
    }


@pytest.mark.parametrize(
    ("source", "decision", "decided_status", "ledger_balance"),
    [
        pytest.param(
            {"open_kind": OpenReviewKind.CORRECTION, "previous_values": {"amount": -1250}, "observed_amount": -1500},
            "accept-change",
            200,
            98500,
            id="bank-change-accepted",
        ),
        pytest.param(
            {"open_kind": OpenReviewKind.REMOVAL, "removed_at": _REMOVED_AT}, "remove-from-ledger", 204, 100000, id="removed-from-ledger"
        ),
    ],
)
async def test_offer_holds_still_as_the_items_waiting_are_approved(client, source, decision, decided_status, ledger_balance):
    """Everyday's 12.50 coffee from 3 October waits on Fake Bank's correction to 15.00, or on its removal

    The offer already leaves out what approving it changes, so accepting the correction or removing
    the coffee moves the ledger and leaves the offer as it was
    """
    everyday = await _linked_everyday(client, ("2026-09-15", 100000), ("2026-10-03", -1250))
    item_id = await _bank_source(everyday, everyday.ledger_ids[1], **source)

    before = await _read_status(client, everyday)
    decided = await client.post(f"/bank-review/items/{item_id}/{decision}", headers=everyday.headers)
    after = await _read_status(client, everyday)

    assert decided.status_code == decided_status, decided.text
    assert after["balance"]["ledger_balance"] == ledger_balance
    assert after["balance_match"]["amount"] == before["balance_match"]["amount"]
    assert after["balance_match"]["waiting_amount"] == 0


def _may_coffee(external_id: str, day: int, amount: int) -> ProviderRecord:
    """Return a booked coffee from a day in May as Fake Bank sends it, of the amount given in cents"""
    return ProviderRecord(
        external_id=external_id,
        date=date(2026, 5, day),
        amount=amount,
        raw_amount=f"{amount / 100:.2f}",
        description="POS 4411 COFFEE",
        pending=False,
        removed=False,
    )


async def _run_jobs_until_none_is_due() -> None:
    """Run the worker's jobs one at a time until none is due, failing rather than looping if jobs keep coming

    Each runs in a context of its own, as the worker's process has no request identity, rather than
    under the one the test's requests left behind
    """
    for _ in range(5):
        if not await asyncio.get_running_loop().create_task(worker.run_jobs(1), context=contextvars.Context()):
            return
    pytest.fail("Jobs were still queued after 5 ran")


async def test_a_date_range_bringing_in_items_after_a_match_offers_minus_their_sum_and_holds_as_they_are_approved(
    client, fake_provider, monkeypatch, pin_clock
):
    """Everyday matched Fake Bank's 1,250.00. A date range import of May then brings in a 30.00 and a 15.00 coffee from before the import start

    Fake Bank's balance already held the coffees, so the ledger falls 45.00 short of it once they are
    approved. 45.00 is offered as soon as the range ends, minus the coffees' sum, and approving them
    moves the ledger and leaves the offer as it was. The range's fetch reads the same balance, so only
    the coffees move the offer. The worker runs on the database as the app role, its clock frozen at
    noon, the time the range request reads too
    """
    monkeypatch.setattr(worker, "async_session", ScopedSession)
    monkeypatch.setattr(sync, "async_session", ScopedSession)
    pin_clock(_NOW, range_import)
    everyday = await _linked_everyday(client, ("2026-09-15", 100000), next_attempt_at=_NOW + timedelta(hours=19))
    matched = await _record(client, everyday.headers, everyday.account_id, 25000)
    assert matched.status_code == 200, matched.text
    assert matched.json()["balance_match"] is None

    bank_account = _bank_account(BANK_ACCOUNT_ID, records=(_may_coffee("TRN-may-10", 10, -3000), _may_coffee("TRN-may-20", 20, -1500)))
    fake_provider.outcomes = [FetchResult(accounts=(dataclasses.replace(bank_account, balance=125000, balance_at=_BALANCE_AT),))]
    requested = await client.post(
        f"/accounts/{everyday.account_id}/bank-link/range-import",
        json={"first_day": "2026-05-01", "last_day": "2026-05-31", "restores_dismissed": False},
        headers=everyday.headers,
    )
    assert requested.status_code == 200, requested.text

    # The job reads the connection's credential, and runs once due at the frozen noon
    async with TestSession() as session:
        await session.execute(
            update(BankConnection)
            .where(BankConnection.id == everyday.link.connection_id)
            .values(credential_encrypted=encrypt("https://user:secret@bridge.example/simplefin"))
        )
        await session.execute(
            update(BankSyncJob).where(BankSyncJob.connection_id == everyday.link.connection_id).values(run_after=_NOW - timedelta(minutes=1))
        )
        await session.commit()
    with freeze_time(_NOW, real_asyncio=True):
        await _run_jobs_until_none_is_due()

    ranged = await _read_status(client, everyday)
    listed = await client.get(f"/bank-review/items?account_id={everyday.account_id}", headers=everyday.headers)
    assert listed.status_code == 200, listed.text
    groceries = await _get_system_category_id(client, everyday.headers, "Groceries")
    myself = await _get_system_merchant_id(client, everyday.headers)
    for item in listed.json()["items"]:
        entry = {"dt": item["bank"]["date"], "amount": item["bank"]["amount"], "category_id": groceries, "merchant_id": myself}
        added = await client.post(f"/bank-review/items/{item['id']}/add", json=entry, headers=everyday.headers)
        assert added.status_code == 201, added.text
    approved = await _read_status(client, everyday)

    assert len(fake_provider.fetches) == 1
    assert (ranged["link"]["range_import"], ranged["link"]["range_outcome"]) == (None, None)
    assert sorted((item["bank"]["date"], item["bank"]["amount"]) for item in listed.json()["items"]) == [
        ("2026-05-10", -3000),
        ("2026-05-20", -1500),
    ]
    assert ranged["balance_match"] == {"amount": 4500, "waiting_amount": -4500, "adjustment_date": _ADJUSTMENT_DATE}
    assert approved["balance_match"] == {"amount": 4500, "waiting_amount": 0, "adjustment_date": _ADJUSTMENT_DATE}
    assert (approved["balance"]["ledger_balance"], approved["balance"]["difference"]) == (120500, -4500)


async def test_recording_ends_the_undo_of_the_last_import(client):
    """The user imported a file, then recorded Everyday's offered 250.00, which adds a ledger transaction and makes the import permanent"""
    everyday = await _linked_everyday(client, ("2026-09-15", 100000))
    await _import_a_file(client, everyday.headers)

    recorded = await _record(client, everyday.headers, everyday.account_id, 25000)

    assert recorded.status_code == 200, recorded.text
    assert await _undoable_import(client, everyday.headers) is None


async def test_a_second_submission_arriving_mid_flight_records_nothing_more(client):
    """A sync holds Everyday's link while two submissions of the 250.00 offer arrive, the second queued behind the first

    The first records as it would alone. The second finds nothing left to match, so it is refused
    and the adjustment is recorded once
    """
    everyday = await _linked_everyday(client, ("2026-09-15", 100000))

    requests: list[asyncio.Task] = []
    try:
        async with asyncio.timeout(10), TestSession() as holder:
            await holder.execute(select(BankAccountLink.id).where(BankAccountLink.id == everyday.link.id).with_for_update())
            holder_pid = await holder.scalar(select(func.pg_backend_pid()))
            requests.append(asyncio.create_task(_record(client, everyday.headers, everyday.account_id, 25000)))
            await _wait_until_waiting_on(holder_pid, requests[0])
            requests.append(asyncio.create_task(_record(client, everyday.headers, everyday.account_id, 25000)))
            await _wait_until_waiting_on(holder_pid, asyncio.gather(*requests), waiters=2)
            await holder.commit()
            first, second = await asyncio.gather(*requests)
    finally:
        await _cancel_unfinished(requests)

    assert first.status_code == 200, first.text
    assert (second.status_code, second.json()["detail"]) == (409, _NOTHING_TO_MATCH)
    assert [stored for _, stored, *_ in await _adjustments(everyday.account_id)] == [25000]


async def test_recording_locks_the_connection_before_the_account(client):
    """Accept bank change holds Everyday's connection while recording waits for it, then takes Everyday shared, as its days check does

    Recording hasn't taken the account while it waits, so Accept bank change gets it at once rather
    than deadlocking, and recording goes ahead once it commits
    """
    everyday = await _linked_everyday(client, ("2026-09-15", 100000))

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


async def test_recording_for_an_unlinked_account_a_group_account_or_another_users_account_is_refused(client):
    """Savings isn't linked, Joint belongs to the Smith Family group and Theirs to another user"""
    headers, _ = await _sign_up(client)
    savings_id = await _new_account(client, headers, "Savings")
    joint_id = await _new_group_account(client, headers)
    theirs = await _commit_other_users_account()

    refusals = []
    for account_id in (savings_id, joint_id, str(theirs.id)):
        response = await _record(client, headers, account_id, 25000)
        refusals.append((response.status_code, response.json()["detail"]))

    assert refusals == [
        (404, "This account is not linked to a bank"),
        (403, "Accounts shared with a group can't be linked to a bank yet"),
        (404, "Account not found"),
    ]
