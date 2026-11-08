"""Offering an account's one-time opening adjustment once its import is reviewed, and recording or skipping it

The offer is the bank's balance minus the ledger's at the end of the bank's balance date in the
profile timezone, less what approving the account's items still waiting for review would change by
then, since the bank's balance already holds them. One made while the import's items still wait,
from a balance older than the imported transactions, in the wrong timezone, or counting waiting
items as the ledger's or ones dated later gets the amount wrong, and one recorded twice or with the
starting balance's liability sign moves the ledger away from the bank. An answer that marks the
user's data changed ends the undo of their last import. Only recording should, as it adds to the
ledger. Once recorded or skipped the offer never returns, and only the owner's own personal
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
from app.models.bank_transaction import BankTransactionDisposition, OpenReviewKind
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

# When Fake Bank reported a transaction removed, the morning after the balance
_REMOVED_AT = datetime(2026, 10, 4, 9, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _pinned_now(pin_clock):
    """Pin the time the account link route describes the link at"""
    pin_clock(_NOW, account_link)


@dataclass(frozen=True)
class _Everyday:
    """A signed-up user's Everyday account, linked to Fake Bank from 1 June"""

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


async def test_offer_waits_until_none_of_the_imports_items_is_waiting(client):
    """Everyday's import from 1 June left 3 items waiting, and a sync after it brought a 12.50 coffee from 3 October

    The ledger is 1,000.00 at the end of 3 October and Fake Bank's balance 1,250.00. Nothing is
    offered while any of the import's 3 waits. Reviewing the last offers 262.50 on May 31, 2026,
    though the coffee still waits, leaving out the 12.50 adding it takes off the ledger, and the
    status reads as an opening balance to confirm
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
    assert reviewed["opening_adjustment"] == {"amount": 26250, "waiting_amount": -1250, "adjustment_date": _ADJUSTMENT_DATE}
    assert reviewed["balance"]["difference"] == -25000
    assert (await _stored_item(later_item)).disposition == BankTransactionDisposition.AWAITING_REVIEW


async def test_offer_reads_the_balance_date_in_the_profile_timezone_against_the_last_imported_transaction(client):
    """In Phoenix, Fake Bank's balance at 02:00 UTC on October 4 is from 7:00 PM on October 3, the day of the import's last transaction

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
        pytest.param(
            date(2026, 10, 2),
            {"amount": 30000, "waiting_amount": 0, "adjustment_date": _ADJUSTMENT_DATE},
            OpeningAdjustmentState.OFFERED,
            id="day-after",
        ),
    ],
)
async def test_offer_waits_for_a_bank_balance_dated_after_the_last_imported_transaction(client, balance_day, offer, state):
    """The import's last transaction, 50.00 of groceries, is dated 1 October and is in the ledger with 1,000.00 of salary

    A Fake Bank balance of 1,250.00 at 6:00 PM on 30 September or 1 October gets no offer, and the
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

    Fake Bank's 1,250.00 matches, so nothing is ever offered. A balance it sent with more decimals than
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
    """Everyday's import left the bank's 12.50 coffee from 3 October waiting, and Fake Bank's 1,250.00 is dated 4 October

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
    assert (await _read_status(client, everyday))["opening_adjustment"] == {
        "amount": 26250,
        "waiting_amount": 0,
        "adjustment_date": _ADJUSTMENT_DATE,
    }


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
    """Everyday offers 250.00 with 1,000.00 in the ledger and Fake Bank at 1,250.00

    Recording 250.00, or 240.00 typed over it, adds that Balance Adjustment from Myself on 31 May,
    before the days Fake Bank supplies. The offer is gone and Difference shows what remains, with the
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
    """Everyday is a credit card here, owing 300.00 in the ledger and 320.00 at Fake Bank, so 20.00 more owed is offered

    It is recorded with the sign offered. A starting balance is stated as what's owed and negated for
    a card. Negating here would close the gap the wrong way
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

    The ledger matches Fake Bank, so the offer shows nothing from then on and the status no longer
    asks for an opening balance, and the next review decision ends it. The coffee it decides is
    dated 4 October, after Fake Bank's balance, so it changes nothing the offer leaves out
    """
    everyday = await _offering_everyday(client, ("2026-09-15", 100000))
    item_id = await _commit_review_item(everyday.account_id, "TRN-later", observed_date=date(2026, 10, 4))
    await _record_ledger(client, everyday.headers, everyday.account_id, ("2026-05-31", 25000))

    caught_up = await _read_status(client, everyday)
    await _dismiss(client, everyday, item_id)
    ended = await _read_status(client, everyday)

    assert (caught_up["link"]["sync"]["state"], caught_up["opening_adjustment"], caught_up["balance"]["difference"]) == ("synced", None, 0)
    assert (ended["link"]["sync"]["state"], ended["opening_adjustment"]) == ("synced", None)
    assert await _offer_state(everyday.link) == OpeningAdjustmentState.NONE


async def test_recording_the_offer_while_items_wait_brings_the_ledger_to_the_bank_once_they_are_added(client):
    """Everyday holds 50.00 and Fake Bank's balance is 100.00, with three 4.50 coffees from 3 October waiting for review

    Fake Bank's balance already holds the coffees, and adding them will take 13.50 off the ledger,
    so 63.50 is offered rather than 50.00. Recording it and adding the coffees leaves the ledger at
    Fake Bank's 100.00. The full difference would leave it at 86.50. A coffee waiting in
    Savings isn't Everyday's to count
    """
    everyday = await _offering_everyday(client, ("2026-09-15", 5000), bank={"balance": 10000})
    coffees = [await _commit_review_item(everyday.account_id, f"TRN-coffee-{number}", observed_amount=-450) for number in range(3)]
    savings_id = await _new_account(client, everyday.headers, "Savings")
    await _commit_review_item(savings_id, "TRN-savings-coffee", observed_amount=-450)
    entry = {
        "dt": "2026-10-03",
        "amount": -450,
        "category_id": await _get_system_category_id(client, everyday.headers, "Groceries"),
        "merchant_id": await _get_system_merchant_id(client, everyday.headers),
    }

    offered = await _read_status(client, everyday)
    recorded = await _record(client, everyday.headers, everyday.account_id, offered["opening_adjustment"]["amount"])
    assert recorded.status_code == 200, recorded.text
    for item_id in coffees:
        added = await client.post(f"/bank-review/items/{item_id}/add", json=entry, headers=everyday.headers)
        assert added.status_code == 201, added.text

    assert offered["opening_adjustment"] == {"amount": 6350, "waiting_amount": -1350, "adjustment_date": _ADJUSTMENT_DATE}
    assert offered["balance"]["difference"] == -5000
    assert recorded.json()["balance"]["difference"] == 1350
    assert (await _read_status(client, everyday))["balance"]["difference"] == 0


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
    everyday = await _offering_everyday(client, ("2026-09-15", 100000), coffee, bank=bank)
    await _bank_source(everyday, everyday.ledger_ids[1], **source)
    if new_item is not None:
        await _commit_review_item(everyday.account_id, "TRN-later", **new_item)

    status = await _read_status(client, everyday)

    amount, waiting_amount = offer
    assert status["opening_adjustment"] == {"amount": amount, "waiting_amount": waiting_amount, "adjustment_date": _ADJUSTMENT_DATE}


@pytest.mark.parametrize("state", [OpeningAdjustmentState.OFFERED, OpeningAdjustmentState.NOT_READY], ids=["offered", "import-just-reviewed"])
async def test_an_item_waiting_with_an_amount_the_currency_cant_hold_keeps_the_offer_waiting(client, state):
    """Fake Bank sent a coffee from 3 October as 12.505, more decimals than CAD holds, so what adding it takes off the ledger isn't known

    An offer shows nothing while the coffee waits and the status doesn't ask for it, and a link whose
    import has just been reviewed isn't offered one, rather than rounding the coffee. Dismissing it
    offers the 250.00 the ledger and Fake Bank differ by
    """
    everyday = await _linked_everyday(client, ("2026-09-15", 100000), opening_adjustment_state=state)
    [import_item] = await _commit_waiting_items(everyday.link, 1)
    await _end_import(everyday.link)
    coffee = await _commit_review_item(everyday.account_id, "TRN-raw-coffee", observed_amount=None, raw_amount="-12.505")

    await _dismiss(client, everyday, import_item)
    waiting = await _read_status(client, everyday)
    held_state = await _offer_state(everyday.link)
    await _dismiss(client, everyday, coffee)

    assert (waiting["link"]["sync"]["state"], waiting["opening_adjustment"]) == ("synced", None)
    assert held_state == state
    assert (await _read_status(client, everyday))["opening_adjustment"] == {
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
    everyday = await _offering_everyday(client, ("2026-09-15", 100000), ("2026-10-03", -1250))
    item_id = await _bank_source(everyday, everyday.ledger_ids[1], **source)

    before = await _read_status(client, everyday)
    decided = await client.post(f"/bank-review/items/{item_id}/{decision}", headers=everyday.headers)
    after = await _read_status(client, everyday)

    assert decided.status_code == decided_status, decided.text
    assert after["balance"]["ledger_balance"] == ledger_balance
    assert after["opening_adjustment"]["amount"] == before["opening_adjustment"]["amount"]
    assert after["opening_adjustment"]["waiting_amount"] == 0


async def test_offer_ends_when_a_dismissal_leaves_items_waiting_that_close_the_gap(client):
    """Everyday holds 113.50 and Fake Bank's balance is 100.00, with four 4.50 coffees waiting, one a copy of another

    Adding all four would take 18.00 off the ledger, so 4.50 is offered. Dismissing the copy leaves
    three that bring the ledger to Fake Bank's 100.00 once added, so the offer ends for good
    """
    everyday = await _offering_everyday(client, ("2026-09-15", 11350), bank={"balance": 10000})
    for number in range(3):
        await _commit_review_item(everyday.account_id, f"TRN-coffee-{number}", observed_amount=-450)
    copy = await _commit_review_item(everyday.account_id, "TRN-coffee-copy", observed_amount=-450)

    offered = await _read_status(client, everyday)
    await _dismiss(client, everyday, copy)

    status = await _read_status(client, everyday)
    assert offered["opening_adjustment"] == {"amount": 450, "waiting_amount": -1800, "adjustment_date": _ADJUSTMENT_DATE}
    assert (status["link"]["sync"]["state"], status["opening_adjustment"]) == ("synced", None)
    assert await _offer_state(everyday.link) == OpeningAdjustmentState.NONE


async def test_no_offer_when_leaving_out_the_items_waiting_closes_the_gap(client):
    """Everyday holds 113.50 and Fake Bank's balance is 100.00, with three 4.50 coffees from a later sync waiting

    Adding the coffees will bring the ledger to Fake Bank's 100.00, so once the import's last item
    is dismissed nothing is offered, for good. The full difference would offer 13.50 less
    """
    everyday = await _linked_everyday(client, ("2026-09-15", 11350), bank={"balance": 10000})
    [import_item] = await _commit_waiting_items(everyday.link, 1)
    await _end_import(everyday.link)
    for number in range(3):
        await _commit_review_item(everyday.account_id, f"TRN-coffee-{number}", observed_amount=-450)

    await _dismiss(client, everyday, import_item)

    status = await _read_status(client, everyday)
    assert (status["link"]["sync"]["state"], status["opening_adjustment"]) == ("synced", None)
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
    transaction and makes the import permanent
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
    """An adjustment of 0.00 records nothing. Skip stands for that, so it's refused and the offer stays"""
    everyday = await _offering_everyday(client, ("2026-09-15", 100000))

    refused = await _record(client, everyday.headers, everyday.account_id, 0)

    assert refused.status_code == 422, refused.text
    assert (await _read_status(client, everyday))["opening_adjustment"] == {
        "amount": 25000,
        "waiting_amount": 0,
        "adjustment_date": _ADJUSTMENT_DATE,
    }
    assert await _adjustments(everyday.account_id) == []
