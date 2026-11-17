"""Bank holds: booked records of no amount

A zero amount that reached review could not be approved and so sat there until dismissed. These
tests catch a hold added to review or the ledger, one that stays after the bank drops it, reports it
removed or gives it an amount, a replacement that wipes holds outside the days it fetched, a hold
the bank reports again that doubles or keeps its old date, text, note or merchant, and a hold kept
before holds kept a note and merchant that never takes them
"""

from dataclasses import replace
from datetime import UTC, date, datetime

from sqlalchemy import select

from app.models.bank_hold import BankHold
from app.models.bank_transaction import BankTransaction
from app.models.currency import Currency
from app.services.bank_sync.holds import list_holds, store_holds
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
        note=f"CARD CHECK {external_id}",
        merchant=None,
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


async def test_a_hold_the_bank_reports_again_stays_one_hold_and_takes_its_new_date_and_text(db):
    """The same bank ID again changes nothing, and again with a new date and text updates the one hold"""
    user, account, link = await _linked(db)
    await store_holds(db, [(link, [_record("Z-1")])], first_day=_FIRST, last_day=_LAST, observed_at=_AT)

    unchanged = await store_holds(db, [(link, [_record("Z-1")])], first_day=_FIRST, last_day=_LAST, observed_at=_AT)
    moved = replace(_record("Z-1", day=date(2026, 10, 16)), description="CARD CHECK HARBOUR")
    later = datetime(2026, 10, 21, 9, 0, tzinfo=UTC)
    changed = await store_holds(db, [(link, [moved])], first_day=_FIRST, last_day=_LAST, observed_at=later)

    assert not unchanged
    assert changed
    holds = await list_holds(db, user, account_ids=[account.id])
    assert [(hold.description, hold.date, hold.observed_at) for hold in holds] == [("CARD CHECK HARBOUR", date(2026, 10, 16), later)]


async def test_a_hold_keeps_the_note_and_merchant_the_bank_sends_and_takes_new_ones(db):
    """A hold keeps the provider's note and merchant, and one reported again with others takes them"""
    user, account, link = await _linked(db)
    sent = replace(_record("Z-1"), note="Card verification", merchant="Shell")
    await store_holds(db, [(link, [sent])], first_day=_FIRST, last_day=_LAST, observed_at=_AT)

    stored = await list_holds(db, user, account_ids=[account.id])

    later = datetime(2026, 10, 21, 9, 0, tzinfo=UTC)
    changed = await store_holds(
        db, [(link, [replace(sent, note=None, merchant="Shell Canada")])], first_day=_FIRST, last_day=_LAST, observed_at=later
    )

    assert [(hold.note, hold.merchant) for hold in stored] == [("Card verification", "Shell")]
    assert changed
    holds = await list_holds(db, user, account_ids=[account.id])
    assert [(hold.note, hold.merchant, hold.observed_at) for hold in holds] == [(None, "Shell Canada", later)]


async def test_a_hold_kept_without_a_note_or_merchant_takes_them_when_the_bank_sends_it_again(db):
    """A hold stored before holds kept them, same date and text, fills its note and merchant from the next report"""
    user, account, link = await _linked(db)
    await store_holds(db, [(link, [_record("Z-1")])], first_day=_FIRST, last_day=_LAST, observed_at=_AT)
    hold = (await db.scalars(select(BankHold))).one()
    hold.note = None
    await db.flush()

    changed = await store_holds(db, [(link, [replace(_record("Z-1"), merchant="Harbour")])], first_day=_FIRST, last_day=_LAST, observed_at=_AT)

    assert changed
    holds = await list_holds(db, user, account_ids=[account.id])
    assert [(hold.note, hold.merchant) for hold in holds] == [("CARD CHECK Z-1", "Harbour")]


async def test_listing_returns_the_holds_of_the_users_accounts_newest_first(db):
    """Holds come back newest first, with the date, the merchant text and when the bank reported them"""
    user, _account, link = await _linked(db)
    records = [_record("OLDER", day=date(2026, 10, 12)), _record("NEWER", day=date(2026, 10, 18))]
    await store_holds(db, [(link, records)], first_day=_FIRST, last_day=_LAST, observed_at=_AT)

    holds = await list_holds(db, user, account_ids=None)

    assert [(hold.description, hold.date, hold.observed_at) for hold in holds] == [
        ("CARD CHECK NEWER", date(2026, 10, 18), _AT),
        ("CARD CHECK OLDER", date(2026, 10, 12), _AT),
    ]


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
