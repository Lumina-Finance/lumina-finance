"""Manual and file-imported transactions on a linked account, outside the days its bank supplies

Everyday is linked to SimpleFIN from 1 June 2026, and today is 4 October 2026 in the user's zone,
as in the issue's examples, so the bank supplies 1 June through 4 October. Each way of writing a
transaction is tried just inside each end of that range and just outside it, and again once the
account is unlinked. A bank-imported transaction can change its date there but not leave the
account, and the account can't be archived while it is linked
"""

import asyncio
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import func, select

from app.models.account import Account
from app.models.bank_connection import BankLinkState
from app.models.transaction import Transaction
from app.services.bank_sync import manual_entries
from app.utils.dates import format_day
from tests.conftest import TestSession
from tests.routes.accounts._account_helpers import _FixedClock
from tests.routes.support import _record_starting_balance
from tests.routes.support.bank_sync_helpers import (
    _build_bank_link,
    _commit_listed_connection,
    _new_account,
    _record_bank_source,
    _sign_up,
)
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.routes.transactions._helpers import _create_transaction, _import_journal, _import_transactions

_USER_TZ = ZoneInfo("America/Toronto")
_IMPORT_START = date(2026, 6, 1)
_TODAY = date(2026, 10, 4)

_SUPPLIED = "SimpleFIN supplies this account's transactions from Jun 1, 2026 to today"
_MOVE_REFUSED = "Transactions from SimpleFIN can't move to another account while this account is linked"
_ARCHIVE_REFUSED = "This account can't be archived while it's linked to SimpleFIN. Unlink it first"

# Either end of the range the bank supplies, and a day inside it
_INSIDE = [_IMPORT_START, date(2026, 7, 12), _TODAY]

# The day before the import start, the day after today, and a later future day
_OUTSIDE = [_IMPORT_START - timedelta(days=1), _TODAY + timedelta(days=1), date(2026, 10, 10)]


@dataclass(frozen=True)
class _Ledger:
    """A signed-up user's Everyday and Savings accounts and an expense category"""

    headers: dict
    user_id: uuid.UUID
    everyday_id: str
    savings_id: str
    category_id: str


@pytest.fixture
def pinned_today(monkeypatch):
    """Make the check's today 4 October 2026 in the user's zone"""
    monkeypatch.setattr(manual_entries, "datetime", _FixedClock(datetime(2026, 10, 4, 12, 0, tzinfo=_USER_TZ)))


async def _ledger(client) -> _Ledger:
    """Sign up with empty Everyday and Savings accounts in CAD and a Coffee category"""
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    savings_id = await _new_account(client, headers, "Savings")
    category = await client.post("/categories", json={"name": "Coffee", "kind": "expense"}, headers=headers)
    assert category.status_code == 201, category.text
    return _Ledger(headers, user_id, everyday_id, savings_id, category.json()["id"])


async def _link(
    ledger: _Ledger,
    account_id: str,
    *,
    import_start: date = _IMPORT_START,
    state: str = BankLinkState.ACTIVE,
    external_account_id: str = "ACT-1",
) -> None:
    """Commit the account's link to a bank account on a new SimpleFIN connection, importing from the start given"""
    connection = await _commit_listed_connection(ledger.user_id, external_account_id)
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(account_id))
        link = _build_bank_link(account, connection, external_account_id, state=state)
        link.import_start = import_start
        link.checkpoint = import_start - timedelta(days=1)
        session.add(link)
        await session.commit()


async def _unlink(client, ledger: _Ledger, account_id: str) -> None:
    """Unlink the account through the route"""
    unlinked = await client.delete(f"/accounts/{account_id}/bank-link", headers=ledger.headers)
    assert unlinked.status_code == 200, unlinked.text


async def _add(client, ledger: _Ledger, account_id: str, day: date):
    """Create a manual 4.50 Coffee transaction on the day given"""
    return await _create_transaction(client, ledger.headers, account_id, ledger.category_id, dt=day.isoformat(), amount=-450)


async def _added_id(client, ledger: _Ledger, account_id: str, day: date) -> str:
    """Create a manual transaction that is expected to save, and return its id"""
    added = await _add(client, ledger, account_id, day)
    assert added.status_code == 201, added.text
    return added.json()["id"]


async def _edit(client, ledger: _Ledger, transaction_id: str, **fields):
    """Edit one transaction through the route"""
    return await client.patch(f"/transactions/{transaction_id}", json=fields, headers=ledger.headers)


async def _bulk_edit(client, ledger: _Ledger, transaction_ids: list[str], **fields):
    """Edit several transactions at once through the route"""
    return await client.patch("/transactions/bulk", json={"transaction_ids": transaction_ids, **fields}, headers=ledger.headers)


async def _dates_in(account_id: str) -> list[date]:
    """Return the dates of the account's transactions, earliest first"""
    async with TestSession() as session:
        return list(
            await session.scalars(select(Transaction.dt).where(Transaction.account_id == uuid.UUID(account_id)).order_by(Transaction.dt))
        )


def _csv_import(ledger: _Ledger, *days: date) -> dict:
    """Return a file import of one Coffee row into Everyday for each day"""
    return {
        "accounts": [{"source": "Everyday", "account_id": ledger.everyday_id}],
        "categories": [{"source": "Coffee", "category_id": ledger.category_id}],
        "rows": [
            {
                "account_source": "Everyday",
                "category_source": "Coffee",
                "dt": day.isoformat(),
                "amount": "-4.50",
                "merchant_name": "Harbour Coffee",
            }
            for day in days
        ],
    }


def _journal_row(journal_id: str, day: date, **fields) -> dict:
    """Return a journal withdrawal from Everyday to Harbour Coffee on the day, with any field replaced"""
    return {
        "journal_id": journal_id,
        "type": "withdrawal",
        "dt": day.isoformat(),
        "amount": "4.50",
        "currency_code": "CAD",
        "description": "Flat white",
        "source_account": "Everyday",
        "destination_name": "Harbour Coffee",
        "category": "Coffee",
        **fields,
    }


def _journal_import(ledger: _Ledger, *rows: dict) -> dict:
    """Return a journal import mapping Everyday and Savings onto the user's accounts"""
    return {
        "accounts": [{"source": "Everyday", "account_id": ledger.everyday_id}, {"source": "Savings", "account_id": ledger.savings_id}],
        "categories": [{"source": "Coffee", "category_id": ledger.category_id}],
        "rows": list(rows),
    }


def _journal_transfer(journal_id: str, day: date) -> dict:
    """Return a journal transfer of 500.00 from Savings into Everyday on the day"""
    return _journal_row(
        journal_id,
        day,
        type="transfer",
        amount="500.00",
        source_account="Savings",
        destination_account="Everyday",
        destination_name=None,
        category=None,
    )


async def _is_archived(account_id: str) -> bool:
    """Return whether the account is archived"""
    async with TestSession() as session:
        return await session.scalar(select(Account.is_archived).where(Account.id == uuid.UUID(account_id)))


# --- Creating a transaction ---


@pytest.mark.parametrize("day", _INSIDE)
async def test_a_manual_transaction_dated_from_the_import_start_through_today_is_refused(client, pinned_today, day):
    """Adding a Coffee to Everyday on a day SimpleFIN supplies is refused, naming the range"""
    ledger = await _ledger(client)
    await _link(ledger, ledger.everyday_id)

    added = await _add(client, ledger, ledger.everyday_id, day)

    assert added.status_code == 422, added.text
    assert added.json()["detail"] == _SUPPLIED
    assert await _dates_in(ledger.everyday_id) == []


@pytest.mark.parametrize("day", _OUTSIDE)
async def test_a_manual_transaction_dated_before_the_import_start_or_after_today_saves(client, pinned_today, day):
    """31 May, 5 October and 10 October are outside the days SimpleFIN supplies, so they save"""
    ledger = await _ledger(client)
    await _link(ledger, ledger.everyday_id)

    added = await _add(client, ledger, ledger.everyday_id, day)

    assert added.status_code == 201, added.text
    assert await _dates_in(ledger.everyday_id) == [day]


async def test_a_link_waiting_for_its_bank_account_to_be_chosen_again_still_refuses_and_other_accounts_take_any_day(client, pinned_today):
    """Everyday stays linked while it waits in Choose bank account, and unlinked Savings takes 12 July"""
    ledger = await _ledger(client)
    await _link(ledger, ledger.everyday_id, state=BankLinkState.CHOOSE_ACCOUNT)

    everyday = await _add(client, ledger, ledger.everyday_id, date(2026, 7, 12))
    savings = await _add(client, ledger, ledger.savings_id, date(2026, 7, 12))

    assert everyday.status_code == 422, everyday.text
    assert everyday.json()["detail"] == _SUPPLIED
    assert savings.status_code == 201, savings.text


async def test_a_manual_transaction_waits_for_a_link_being_made_and_is_then_refused(client, pinned_today):
    """A link holding Everyday as the link request does commits first, and the 12 July Coffee then finds it"""
    ledger = await _ledger(client)
    connection = await _commit_listed_connection(ledger.user_id)

    async with TestSession() as linking:
        await linking.execute(select(Account.id).where(Account.id == uuid.UUID(ledger.everyday_id)).with_for_update(key_share=True))
        account = await linking.get_one(Account, uuid.UUID(ledger.everyday_id))
        link = _build_bank_link(account, connection)
        link.import_start = _IMPORT_START
        link.checkpoint = _IMPORT_START - timedelta(days=1)
        linking.add(link)
        await linking.flush()
        linking_pid = await linking.scalar(select(func.pg_backend_pid()))
        adding = asyncio.create_task(_add(client, ledger, ledger.everyday_id, date(2026, 7, 12)))
        await _wait_until_waiting_on(linking_pid, adding)
        await linking.commit()
    added = await asyncio.wait_for(adding, 10)

    assert added.status_code == 422, added.text
    assert added.json()["detail"] == _SUPPLIED
    assert await _dates_in(ledger.everyday_id) == []


# --- Editing one transaction ---


async def test_changing_a_manual_transactions_date_into_the_range_is_refused(client, pinned_today):
    """A Coffee from 30 May can't move to 1 June or 4 October, and can move to 31 May and then 5 October"""
    ledger = await _ledger(client)
    coffee_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 5, 30))
    await _link(ledger, ledger.everyday_id)

    to_start = await _edit(client, ledger, coffee_id, dt=_IMPORT_START.isoformat())
    to_today = await _edit(client, ledger, coffee_id, dt=_TODAY.isoformat())
    to_day_before = await _edit(client, ledger, coffee_id, dt="2026-05-31")
    to_day_after = await _edit(client, ledger, coffee_id, dt="2026-10-05")

    assert to_start.status_code == 422, to_start.text
    assert to_start.json()["detail"] == _SUPPLIED
    assert to_today.status_code == 422, to_today.text
    assert to_today.json()["detail"] == _SUPPLIED
    assert to_day_before.status_code == 200, to_day_before.text
    assert to_day_after.status_code == 200, to_day_after.text
    assert await _dates_in(ledger.everyday_id) == [date(2026, 10, 5)]


async def test_moving_a_manual_transaction_into_the_linked_account_is_refused_only_inside_the_range(client, pinned_today):
    """Moving Savings' 12 July Coffee to Everyday is refused, and its 31 May Coffee moves"""
    ledger = await _ledger(client)
    inside_id = await _added_id(client, ledger, ledger.savings_id, date(2026, 7, 12))
    before_id = await _added_id(client, ledger, ledger.savings_id, date(2026, 5, 31))
    await _link(ledger, ledger.everyday_id)

    moved_inside = await _edit(client, ledger, inside_id, account_id=ledger.everyday_id)
    moved_before = await _edit(client, ledger, before_id, account_id=ledger.everyday_id)

    assert moved_inside.status_code == 422, moved_inside.text
    assert moved_inside.json()["detail"] == _SUPPLIED
    assert moved_before.status_code == 200, moved_before.text
    assert await _dates_in(ledger.everyday_id) == [date(2026, 5, 31)]
    assert await _dates_in(ledger.savings_id) == [date(2026, 7, 12)]


async def test_editing_a_transaction_inside_the_range_saves_while_its_date_and_account_stay(client, pinned_today):
    """A Coffee dated 15 June before the link takes a new note, and its own date and account sent back, but not 16 June"""
    ledger = await _ledger(client)
    coffee_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 6, 15))
    await _link(ledger, ledger.everyday_id)

    noted = await _edit(client, ledger, coffee_id, notes="Flat white")
    resent = await _edit(client, ledger, coffee_id, dt="2026-06-15", account_id=ledger.everyday_id, amount=-700)
    redated = await _edit(client, ledger, coffee_id, dt="2026-06-16")

    assert noted.status_code == 200, noted.text
    assert noted.json()["notes"] == "Flat white"
    assert resent.status_code == 200, resent.text
    assert resent.json()["amount"] == -700
    assert redated.status_code == 422, redated.text
    assert redated.json()["detail"] == _SUPPLIED
    assert await _dates_in(ledger.everyday_id) == [date(2026, 6, 15)]


async def test_a_bank_imported_transactions_date_can_change_but_it_cant_leave_the_linked_account(client, pinned_today):
    """Everyday's bank-imported 12 July Coffee moves to 13 July, but not to Savings, on any date"""
    ledger = await _ledger(client)
    coffee_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 7, 12))
    await _link(ledger, ledger.everyday_id)
    await _record_bank_source(coffee_id)

    redated = await _edit(client, ledger, coffee_id, dt="2026-07-13")
    moved = await _edit(client, ledger, coffee_id, account_id=ledger.savings_id)
    moved_before_the_range = await _edit(client, ledger, coffee_id, account_id=ledger.savings_id, dt="2026-05-01")

    assert redated.status_code == 200, redated.text
    assert moved.status_code == 422, moved.text
    assert moved.json()["detail"] == _MOVE_REFUSED
    assert moved_before_the_range.status_code == 422, moved_before_the_range.text
    assert moved_before_the_range.json()["detail"] == _MOVE_REFUSED
    assert await _dates_in(ledger.everyday_id) == [date(2026, 7, 13)]
    assert await _dates_in(ledger.savings_id) == []


async def test_a_bank_imported_transaction_moving_into_a_linked_account_is_checked_like_a_manual_one(client, pinned_today):
    """A bank-imported Coffee in unlinked Savings can't move into Everyday on 12 July, and can on 31 May"""
    ledger = await _ledger(client)
    coffee_id = await _added_id(client, ledger, ledger.savings_id, date(2026, 7, 12))
    await _record_bank_source(coffee_id)
    await _link(ledger, ledger.everyday_id)

    moved_inside = await _edit(client, ledger, coffee_id, account_id=ledger.everyday_id)
    moved_before = await _edit(client, ledger, coffee_id, account_id=ledger.everyday_id, dt="2026-05-31")

    assert moved_inside.status_code == 422, moved_inside.text
    assert moved_inside.json()["detail"] == _SUPPLIED
    assert moved_before.status_code == 200, moved_before.text
    assert await _dates_in(ledger.everyday_id) == [date(2026, 5, 31)]


# --- Editing several transactions at once ---


async def test_a_bulk_edit_dating_manual_transactions_inside_the_range_is_refused_whole(client, pinned_today):
    """Two May Coffees can't both move to 4 October or 1 June, and can move to 31 May and to 5 October"""
    ledger = await _ledger(client)
    first_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 5, 1))
    second_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 5, 2))
    await _link(ledger, ledger.everyday_id)

    to_today = await _bulk_edit(client, ledger, [first_id, second_id], dt=_TODAY.isoformat())
    to_start = await _bulk_edit(client, ledger, [first_id, second_id], dt=_IMPORT_START.isoformat())
    unchanged = await _dates_in(ledger.everyday_id)
    to_day_before = await _bulk_edit(client, ledger, [first_id, second_id], dt="2026-05-31")
    to_day_after = await _bulk_edit(client, ledger, [first_id, second_id], dt="2026-10-05")

    assert to_today.status_code == 422, to_today.text
    assert to_today.json()["detail"] == _SUPPLIED
    assert to_start.status_code == 422, to_start.text
    assert to_start.json()["detail"] == _SUPPLIED
    assert unchanged == [date(2026, 5, 1), date(2026, 5, 2)]
    assert to_day_before.status_code == 200, to_day_before.text
    assert to_day_after.status_code == 200, to_day_after.text
    assert await _dates_in(ledger.everyday_id) == [date(2026, 10, 5), date(2026, 10, 5)]


async def test_a_bulk_move_into_the_linked_account_is_refused_when_a_row_lands_inside_the_range(client, pinned_today):
    """Savings' 31 May and 1 June Coffees can't move to Everyday together, and the 31 May one moves alone"""
    ledger = await _ledger(client)
    before_id = await _added_id(client, ledger, ledger.savings_id, date(2026, 5, 31))
    inside_id = await _added_id(client, ledger, ledger.savings_id, _IMPORT_START)
    await _link(ledger, ledger.everyday_id)

    together = await _bulk_edit(client, ledger, [before_id, inside_id], account_id=ledger.everyday_id)
    alone = await _bulk_edit(client, ledger, [before_id], account_id=ledger.everyday_id)

    assert together.status_code == 422, together.text
    assert together.json()["detail"] == _SUPPLIED
    assert alone.status_code == 200, alone.text
    assert await _dates_in(ledger.everyday_id) == [date(2026, 5, 31)]
    assert await _dates_in(ledger.savings_id) == [_IMPORT_START]


async def test_a_bulk_edit_leaving_dates_and_accounts_alone_saves_inside_the_range(client, pinned_today):
    """Everyday's 15 June Coffees take a note, and their own date and account sent back"""
    ledger = await _ledger(client)
    first_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 6, 15))
    second_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 6, 15))
    await _link(ledger, ledger.everyday_id)

    noted = await _bulk_edit(client, ledger, [first_id, second_id], notes="Flat white")
    resent = await _bulk_edit(client, ledger, [first_id, second_id], dt="2026-06-15", account_id=ledger.everyday_id)

    assert noted.status_code == 200, noted.text
    assert resent.status_code == 200, resent.text
    assert await _dates_in(ledger.everyday_id) == [date(2026, 6, 15), date(2026, 6, 15)]


async def test_a_bulk_edit_may_redate_bank_imported_transactions_but_not_move_them_or_redate_a_manual_one_beside_them(client, pinned_today):
    """Everyday's bank-imported 12 and 13 July Coffees move to 1 August but not to Savings, and not with a manual May Coffee"""
    ledger = await _ledger(client)
    first_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 7, 12))
    second_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 7, 13))
    manual_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 5, 1))
    await _link(ledger, ledger.everyday_id)
    await _record_bank_source(first_id, "TRN-1001")
    await _record_bank_source(second_id, "TRN-1002")

    redated = await _bulk_edit(client, ledger, [first_id, second_id], dt="2026-08-01")
    moved = await _bulk_edit(client, ledger, [first_id, second_id], account_id=ledger.savings_id)
    with_manual = await _bulk_edit(client, ledger, [first_id, manual_id], dt="2026-08-02")

    assert redated.status_code == 200, redated.text
    assert moved.status_code == 422, moved.text
    assert moved.json()["detail"] == _MOVE_REFUSED
    assert with_manual.status_code == 422, with_manual.text
    assert with_manual.json()["detail"] == _SUPPLIED
    assert await _dates_in(ledger.everyday_id) == [date(2026, 5, 1), date(2026, 8, 1), date(2026, 8, 1)]


# --- Importing a file ---


@pytest.mark.parametrize("day", _INSIDE)
async def test_a_file_import_with_a_row_inside_the_range_is_refused_whole(client, pinned_today, day):
    """A file importing 31 May and a day SimpleFIN supplies into Everyday writes neither"""
    ledger = await _ledger(client)
    await _link(ledger, ledger.everyday_id)

    imported = await _import_transactions(client, ledger.headers, _csv_import(ledger, date(2026, 5, 31), day))

    assert imported.status_code == 422, imported.text
    assert imported.json()["detail"] == _SUPPLIED
    assert await _dates_in(ledger.everyday_id) == []


async def test_a_file_import_outside_the_range_saves(client, pinned_today):
    """A file importing 31 May, 5 October and 10 October into Everyday writes all three"""
    ledger = await _ledger(client)
    await _link(ledger, ledger.everyday_id)

    imported = await _import_transactions(client, ledger.headers, _csv_import(ledger, *_OUTSIDE))

    assert imported.status_code == 201, imported.text
    assert await _dates_in(ledger.everyday_id) == _OUTSIDE


@pytest.mark.parametrize("day", _INSIDE)
async def test_a_journal_import_with_a_row_inside_the_range_is_refused_whole(client, pinned_today, day):
    """A journal export with a 31 May Coffee and one on a day SimpleFIN supplies writes neither"""
    ledger = await _ledger(client)
    await _link(ledger, ledger.everyday_id)

    imported = await _import_journal(
        client, ledger.headers, _journal_import(ledger, _journal_row("1", date(2026, 5, 31)), _journal_row("2", day))
    )

    assert imported.status_code == 422, imported.text
    assert imported.json()["detail"] == _SUPPLIED
    assert await _dates_in(ledger.everyday_id) == []


async def test_a_journal_transfer_into_the_linked_account_inside_the_range_is_refused(client, pinned_today):
    """A 12 July transfer from Savings writes a leg into Everyday too, so neither leg is written"""
    ledger = await _ledger(client)
    await _link(ledger, ledger.everyday_id)

    imported = await _import_journal(client, ledger.headers, _journal_import(ledger, _journal_transfer("1", date(2026, 7, 12))))

    assert imported.status_code == 422, imported.text
    assert imported.json()["detail"] == _SUPPLIED
    assert await _dates_in(ledger.savings_id) == []


async def test_a_journal_import_outside_the_range_saves(client, pinned_today):
    """Coffees on 31 May, 5 October and 10 October and a 31 May transfer from Savings all land in Everyday"""
    ledger = await _ledger(client)
    await _link(ledger, ledger.everyday_id)
    rows = [_journal_row(str(index), day) for index, day in enumerate(_OUTSIDE, start=1)]

    imported = await _import_journal(client, ledger.headers, _journal_import(ledger, *rows, _journal_transfer("9", date(2026, 5, 31))))

    assert imported.status_code == 201, imported.text
    assert await _dates_in(ledger.everyday_id) == [date(2026, 5, 31), *_OUTSIDE]


# --- Recording a starting balance ---


async def test_a_starting_balance_is_refused_once_the_import_has_started(client):
    """Everyday linked from today can't take a starting balance, which would be dated today"""
    ledger = await _ledger(client)
    today = datetime.now(_USER_TZ).date()
    await _link(ledger, ledger.everyday_id, import_start=today)

    recorded = await _record_starting_balance(client, ledger.headers, ledger.everyday_id, 1_250_00)

    assert recorded.status_code == 422, recorded.text
    assert recorded.json()["detail"] == f"SimpleFIN supplies this account's transactions from {format_day(today)} to today"
    assert await _dates_in(ledger.everyday_id) == []


async def test_a_starting_balance_saves_before_the_import_starts_and_after_unlinking(client):
    """Everyday linked from tomorrow takes one today, and so does Savings once its link from today is ended"""
    ledger = await _ledger(client)
    today = datetime.now(_USER_TZ).date()
    await _link(ledger, ledger.everyday_id, import_start=today + timedelta(days=1))
    await _link(ledger, ledger.savings_id, import_start=today, external_account_id="ACT-2")
    await _unlink(client, ledger, ledger.savings_id)

    everyday = await _record_starting_balance(client, ledger.headers, ledger.everyday_id, 1_250_00)
    savings = await _record_starting_balance(client, ledger.headers, ledger.savings_id, 1_250_00)

    assert everyday.status_code == 200, everyday.text
    assert savings.status_code == 200, savings.text
    assert await _dates_in(ledger.everyday_id) == [today]
    assert await _dates_in(ledger.savings_id) == [today]


# --- Archiving the account ---


@pytest.mark.parametrize("state", [BankLinkState.ACTIVE, BankLinkState.CHOOSE_ACCOUNT])
async def test_archiving_a_linked_account_is_refused_until_it_is_unlinked(client, state):
    """Everyday can't be archived while linked, whatever its link waits on, and archives once unlinked"""
    ledger = await _ledger(client)
    await _link(ledger, ledger.everyday_id, state=state)

    refused = await client.patch(f"/accounts/{ledger.everyday_id}", json={"is_archived": True}, headers=ledger.headers)
    still_open = await _is_archived(ledger.everyday_id)
    await _unlink(client, ledger, ledger.everyday_id)
    archived = await client.patch(f"/accounts/{ledger.everyday_id}", json={"is_archived": True}, headers=ledger.headers)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == _ARCHIVE_REFUSED
    assert still_open is False
    assert archived.status_code == 200, archived.text
    assert await _is_archived(ledger.everyday_id) is True


async def test_archiving_waits_for_a_link_being_made_and_is_then_refused(client):
    """A link holding Everyday as the link request does commits first, and the archive then finds it"""
    ledger = await _ledger(client)
    connection = await _commit_listed_connection(ledger.user_id)

    async with TestSession() as linking:
        await linking.execute(select(Account.id).where(Account.id == uuid.UUID(ledger.everyday_id)).with_for_update(key_share=True))
        account = await linking.get_one(Account, uuid.UUID(ledger.everyday_id))
        linking.add(_build_bank_link(account, connection))
        await linking.flush()
        linking_pid = await linking.scalar(select(func.pg_backend_pid()))
        archiving = asyncio.create_task(client.patch(f"/accounts/{ledger.everyday_id}", json={"is_archived": True}, headers=ledger.headers))
        await _wait_until_waiting_on(linking_pid, archiving)
        await linking.commit()
    archived = await asyncio.wait_for(archiving, 10)

    assert archived.status_code == 422, archived.text
    assert archived.json()["detail"] == _ARCHIVE_REFUSED
    assert await _is_archived(ledger.everyday_id) is False


# --- After unlinking ---


async def test_after_unlinking_every_write_the_link_refused_saves(client, pinned_today):
    """Once Everyday is unlinked, 12 July takes a manual Coffee, an edit, a move, a bulk edit and both imports"""
    ledger = await _ledger(client)
    may_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 5, 1))
    savings_id = await _added_id(client, ledger, ledger.savings_id, date(2026, 7, 12))
    bank_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 7, 20))
    await _link(ledger, ledger.everyday_id)
    await _record_bank_source(bank_id)
    await _unlink(client, ledger, ledger.everyday_id)

    added = await _add(client, ledger, ledger.everyday_id, date(2026, 7, 12))
    redated = await _edit(client, ledger, may_id, dt="2026-07-12")
    moved_in = await _edit(client, ledger, savings_id, account_id=ledger.everyday_id)
    bulk = await _bulk_edit(client, ledger, [may_id, savings_id], dt="2026-07-13")
    moved_out = await _edit(client, ledger, bank_id, account_id=ledger.savings_id)
    file_import = await _import_transactions(client, ledger.headers, _csv_import(ledger, date(2026, 7, 14)))
    journal = await _import_journal(client, ledger.headers, _journal_import(ledger, _journal_row("1", date(2026, 7, 15))))

    assert added.status_code == 201, added.text
    assert redated.status_code == 200, redated.text
    assert moved_in.status_code == 200, moved_in.text
    assert bulk.status_code == 200, bulk.text
    assert moved_out.status_code == 200, moved_out.text
    assert file_import.status_code == 201, file_import.text
    assert journal.status_code == 201, journal.text
    assert await _dates_in(ledger.everyday_id) == [
        date(2026, 7, 12),
        date(2026, 7, 13),
        date(2026, 7, 13),
        date(2026, 7, 14),
        date(2026, 7, 15),
    ]
    assert await _dates_in(ledger.savings_id) == [date(2026, 7, 20)]
