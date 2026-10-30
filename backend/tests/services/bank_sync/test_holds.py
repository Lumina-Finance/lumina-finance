"""Bank holds: booked records of no amount

A zero amount that reached review could not be approved and so sat there until dismissed. These
tests catch a hold added to review or the ledger, one that stays after the bank drops it, reports it
removed or gives it an amount, a replacement that wipes holds outside the days it fetched, and a
dismissed hold that returns, or a dismissal reaching another user's hold
"""

import uuid
from datetime import UTC, date, datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.bank_connection import BankConnection
from app.models.bank_hold import BankHold
from app.models.bank_transaction import BankTransaction
from app.models.currency import Currency
from app.services.bank_sync.holds import clear_holds, dismiss_hold, list_holds, store_holds
from app.services.bank_sync.ingestion import store_booked_records
from app.services.bank_sync.providers.contract import ProviderRecord
from tests.routes.support.bank_sync_helpers import (
    LINK_START,
    _build_account,
    _build_bank_connection,
    _build_bank_link,
    _build_bank_transaction,
    _build_user,
)

_AT = datetime(2026, 10, 20, 9, 0, tzinfo=UTC)
_FIRST = date(2026, 10, 10)
_LAST = date(2026, 10, 20)


def _record(external_id: str, *, day: date = date(2026, 10, 15), amount: int | None = 0, removed: bool = False, pending: bool = False):
    """Return a record the bank reports, a hold unless given an amount"""
    return ProviderRecord(
        external_id=external_id,
        date=day,
        amount=amount,
        raw_amount="0.00" if amount == 0 else str(amount),
        description=f"CARD CHECK {external_id}",
        pending=pending,
        removed=removed,
    )


async def _linked(db, email="holds@example.com"):
    """Commit a user with a linked account and return the user, account and link"""
    if await db.get(Currency, "CAD") is None:
        db.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
        await db.flush()
    user = _build_user(email)
    db.add(user)
    await db.flush()
    account = _build_account(user.id)
    db.add(account)
    await db.flush()
    connection = _build_bank_connection(user.id)
    db.add(connection)
    await db.flush()
    link = _build_bank_link(account, connection)
    db.add(link)
    await db.flush()
    return user, account, link


async def _descriptions(db) -> list[str]:
    return sorted((await db.scalars(select(BankHold.description))).all())


async def test_a_zero_amount_record_becomes_a_hold_and_not_a_review_item(db):
    """The zero record is listed as a hold, and only the one with an amount waits in review"""
    _, _, link = await _linked(db)
    records = [_record("Z-1"), _record("N-1", amount=-1250)]

    await store_booked_records(db, [(link, records)], observed_at=_AT)
    await store_holds(db, [(link, records)], first_day=_FIRST, last_day=_LAST, observed_at=_AT)

    assert await _descriptions(db) == ["CARD CHECK Z-1"]
    assert (await db.scalars(select(BankTransaction.observed_amount))).all() == [-1250]


async def test_pending_and_unstorable_records_are_not_holds(db):
    """A pending zero stays with the pending items, and an amount the currency can't hold keeps waiting in review"""
    _, _, link = await _linked(db)
    records = [_record("P-1", pending=True), _record("U-1", amount=None)]

    await store_holds(db, [(link, records)], first_day=_FIRST, last_day=_LAST, observed_at=_AT)

    assert await _descriptions(db) == []


async def test_a_record_before_the_import_start_is_left_out(db):
    """The user keeps the ledger by hand before the link's start, so a hold before it isn't shown"""
    _, _, link = await _linked(db)

    await store_holds(
        db,
        [(link, [_record("OLD", day=LINK_START.replace(year=LINK_START.year - 1))])],
        first_day=date(2000, 1, 1),
        last_day=_LAST,
        observed_at=_AT,
    )

    assert await _descriptions(db) == []


async def test_a_hold_the_bank_drops_goes_but_one_outside_the_days_fetched_stays(db):
    """A response covering 10 to 20 October drops the hold it no longer lists there and spares an earlier one"""
    _, _, link = await _linked(db)
    first = [_record("IN-WINDOW"), _record("EARLIER", day=date(2026, 10, 2))]
    await store_holds(db, [(link, first)], first_day=date(2026, 10, 1), last_day=_LAST, observed_at=_AT)

    changed = await store_holds(db, [(link, [])], first_day=_FIRST, last_day=_LAST, observed_at=_AT)

    assert changed
    assert await _descriptions(db) == ["CARD CHECK EARLIER"]


async def test_a_hold_goes_when_the_bank_reports_it_removed_or_gives_it_an_amount(db):
    """Both stop it being a hold: a removal ends it, and an amount sends it down the booked path"""
    _, _, link = await _linked(db)
    both = [_record("REMOVED"), _record("PRICED")]
    await store_holds(db, [(link, both)], first_day=_FIRST, last_day=_LAST, observed_at=_AT)

    await store_holds(
        db,
        [(link, [_record("REMOVED", removed=True), _record("PRICED", amount=-300)])],
        first_day=_FIRST,
        last_day=_LAST,
        observed_at=_AT,
    )

    assert await _descriptions(db) == []


async def test_a_dismissed_hold_stays_dismissed_when_the_bank_reports_it_again(db):
    """Dismissing stops the same bank ID coming back, and it is listed no more"""
    user, account, link = await _linked(db)
    await store_holds(db, [(link, [_record("Z-1")])], first_day=_FIRST, last_day=_LAST, observed_at=_AT)
    hold_id = await db.scalar(select(BankHold.id))

    await dismiss_hold(db, user, hold_id)
    changed = await store_holds(db, [(link, [_record("Z-1")])], first_day=_FIRST, last_day=_LAST, observed_at=_AT)

    assert not changed
    assert await list_holds(db, user, account_ids=[account.id]) == []
    assert len((await db.scalars(select(BankHold.id))).all()) == 1


async def test_listing_returns_the_newest_undismissed_holds_of_the_users_accounts(db):
    """Holds come back newest first, with the date, the merchant text and when the bank reported them"""
    user, _account, link = await _linked(db)
    records = [_record("OLDER", day=date(2026, 10, 12)), _record("NEWER", day=date(2026, 10, 18))]
    await store_holds(db, [(link, records)], first_day=_FIRST, last_day=_LAST, observed_at=_AT)

    holds = await list_holds(db, user, account_ids=None)

    assert [(hold.description, hold.date, hold.observed_at) for hold in holds] == [
        ("CARD CHECK NEWER", date(2026, 10, 18), _AT),
        ("CARD CHECK OLDER", date(2026, 10, 12), _AT),
    ]


async def test_another_users_hold_cannot_be_dismissed(db):
    """A hold of someone else's account is not found, and stays listed for its owner"""
    owner, account, link = await _linked(db, "owner@example.com")
    other = _build_user("other@example.com")
    db.add(other)
    await db.flush()
    await store_holds(db, [(link, [_record("Z-1")])], first_day=_FIRST, last_day=_LAST, observed_at=_AT)
    hold_id = await db.scalar(select(BankHold.id))

    with pytest.raises(HTTPException) as refused:
        await dismiss_hold(db, other, hold_id)
    with pytest.raises(HTTPException):
        await dismiss_hold(db, owner, uuid.uuid4())

    assert refused.value.status_code == 404
    assert len(await list_holds(db, owner, account_ids=[account.id])) == 1


async def test_a_zero_record_already_in_review_is_not_also_a_hold(db):
    """A zero item already waiting in review, or an item the bank now reports at 0.00, shows in one place only"""
    _, account, link = await _linked(db)
    db.add(_build_bank_transaction(account, "Z-WAITING", amount=0))
    await db.flush()

    await store_holds(db, [(link, [_record("Z-WAITING"), _record("Z-NEW")])], first_day=_FIRST, last_day=_LAST, observed_at=_AT)

    assert await _descriptions(db) == ["CARD CHECK Z-NEW"]


async def test_a_hold_goes_when_its_record_takes_a_row_in_review(db):
    """A hold stored before its bank ID gained a review row is dropped rather than shown twice"""
    _, account, link = await _linked(db)
    await store_holds(db, [(link, [_record("Z-1")])], first_day=_FIRST, last_day=_LAST, observed_at=_AT)
    db.add(_build_bank_transaction(account, "Z-1", amount=0))
    await db.flush()

    await store_holds(db, [(link, [_record("Z-1")])], first_day=_FIRST, last_day=_LAST, observed_at=_AT)

    assert await _descriptions(db) == []


async def test_the_days_fetched_include_both_their_first_and_last_day(db):
    """A hold dated exactly on a response's first or last day goes when unlisted, and one a day outside stays"""
    _, _, link = await _linked(db)
    held = [
        _record("ON-FIRST", day=_FIRST),
        _record("ON-LAST", day=_LAST),
        _record("DAY-BEFORE", day=date(2026, 10, 9)),
        _record("DAY-AFTER", day=date(2026, 10, 21)),
    ]
    await store_holds(db, [(link, held)], first_day=date(2026, 10, 1), last_day=date(2026, 10, 31), observed_at=_AT)

    await store_holds(db, [(link, [])], first_day=_FIRST, last_day=_LAST, observed_at=_AT)

    assert await _descriptions(db) == ["CARD CHECK DAY-AFTER", "CARD CHECK DAY-BEFORE"]


async def test_clearing_an_accounts_holds_removes_them_dismissed_ones_too(db):
    """Ending a link takes away every hold of the account, including those dismissed, and spares other accounts"""
    user, account, link = await _linked(db)
    other = _build_account(user.id, "Savings")
    db.add(other)
    await db.flush()
    other_link = _build_bank_link(other, await db.get(BankConnection, link.connection_id), "ACT-2")
    db.add(other_link)
    await db.flush()
    both = [(link, [_record("A"), _record("B")]), (other_link, [_record("C")])]
    await store_holds(db, both, first_day=_FIRST, last_day=_LAST, observed_at=_AT)
    await dismiss_hold(db, user, await db.scalar(select(BankHold.id).where(BankHold.description == "CARD CHECK A")))

    await clear_holds(db, account.id)

    assert await _descriptions(db) == ["CARD CHECK C"]
