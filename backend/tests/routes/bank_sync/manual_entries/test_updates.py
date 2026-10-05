"""Editing one transaction on or into a linked account

An edit is checked only when it changes the date or the account. A bank-imported transaction may
change its date but can't leave the account, and every edit is taken again once the account is unlinked
"""

from datetime import date

from tests.routes.support.bank_sync_helpers import _record_bank_source
from tests.routes.support.manual_entry_helpers import (
    IMPORT_START,
    MOVE_REFUSED,
    SUPPLIED,
    TODAY,
    _added_id,
    _commit_link,
    _dates_in,
    _Ledger,
    _ledger,
    _unlink,
)


async def _edit(client, ledger: _Ledger, transaction_id: str, **fields):
    """Edit one transaction through the route"""
    return await client.patch(f"/transactions/{transaction_id}", json=fields, headers=ledger.headers)


async def test_changing_a_manual_transactions_date_into_the_range_is_refused(client):
    """A Coffee from 30 May can't move to 1 June or 3 October, and can move to 31 May and then 4 October"""
    ledger = await _ledger(client)
    coffee_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 5, 30))
    await _commit_link(ledger, ledger.everyday_id)

    to_start = await _edit(client, ledger, coffee_id, dt=IMPORT_START.isoformat())
    to_today = await _edit(client, ledger, coffee_id, dt=TODAY.isoformat())
    to_day_before = await _edit(client, ledger, coffee_id, dt="2026-05-31")
    to_day_after = await _edit(client, ledger, coffee_id, dt="2026-10-04")

    assert to_start.status_code == 422, to_start.text
    assert to_start.json()["detail"] == SUPPLIED
    assert to_today.status_code == 422, to_today.text
    assert to_today.json()["detail"] == SUPPLIED
    assert to_day_before.status_code == 200, to_day_before.text
    assert to_day_after.status_code == 200, to_day_after.text
    assert await _dates_in(ledger.everyday_id) == [date(2026, 10, 4)]


async def test_moving_a_manual_transaction_into_the_linked_account_is_refused_only_inside_the_range(client):
    """Moving Savings' 12 July Coffee to Everyday is refused, and its 31 May Coffee moves"""
    ledger = await _ledger(client)
    inside_id = await _added_id(client, ledger, ledger.savings_id, date(2026, 7, 12))
    before_id = await _added_id(client, ledger, ledger.savings_id, date(2026, 5, 31))
    await _commit_link(ledger, ledger.everyday_id)

    moved_inside = await _edit(client, ledger, inside_id, account_id=ledger.everyday_id)
    moved_before = await _edit(client, ledger, before_id, account_id=ledger.everyday_id)

    assert moved_inside.status_code == 422, moved_inside.text
    assert moved_inside.json()["detail"] == SUPPLIED
    assert moved_before.status_code == 200, moved_before.text
    assert await _dates_in(ledger.everyday_id) == [date(2026, 5, 31)]
    assert await _dates_in(ledger.savings_id) == [date(2026, 7, 12)]


async def test_editing_a_transaction_inside_the_range_saves_while_its_date_and_account_stay(client):
    """A Coffee dated 15 June before the link takes a new note, and its own date and account sent back, but not 16 June"""
    ledger = await _ledger(client)
    coffee_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 6, 15))
    await _commit_link(ledger, ledger.everyday_id)

    noted = await _edit(client, ledger, coffee_id, notes="Flat white")
    resent = await _edit(client, ledger, coffee_id, dt="2026-06-15", account_id=ledger.everyday_id, amount=-700)
    redated = await _edit(client, ledger, coffee_id, dt="2026-06-16")

    assert noted.status_code == 200, noted.text
    assert noted.json()["notes"] == "Flat white"
    assert resent.status_code == 200, resent.text
    assert resent.json()["amount"] == -700
    assert redated.status_code == 422, redated.text
    assert redated.json()["detail"] == SUPPLIED
    assert await _dates_in(ledger.everyday_id) == [date(2026, 6, 15)]


async def test_a_bank_imported_transactions_date_can_change_but_it_cant_leave_the_linked_account(client):
    """Everyday's bank-imported 12 July Coffee moves to 13 July, but not to Savings, on any date"""
    ledger = await _ledger(client)
    coffee_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 7, 12))
    await _commit_link(ledger, ledger.everyday_id)
    await _record_bank_source(coffee_id)

    redated = await _edit(client, ledger, coffee_id, dt="2026-07-13")
    moved = await _edit(client, ledger, coffee_id, account_id=ledger.savings_id)
    moved_before_the_range = await _edit(client, ledger, coffee_id, account_id=ledger.savings_id, dt="2026-05-01")

    assert redated.status_code == 200, redated.text
    assert moved.status_code == 422, moved.text
    assert moved.json()["detail"] == MOVE_REFUSED
    assert moved_before_the_range.status_code == 422, moved_before_the_range.text
    assert moved_before_the_range.json()["detail"] == MOVE_REFUSED
    assert await _dates_in(ledger.everyday_id) == [date(2026, 7, 13)]
    assert await _dates_in(ledger.savings_id) == []


async def test_a_bank_imported_transaction_moving_into_a_linked_account_is_checked_like_a_manual_one(client):
    """A bank-imported Coffee in unlinked Savings can't move into Everyday on 12 July, and can on 31 May"""
    ledger = await _ledger(client)
    coffee_id = await _added_id(client, ledger, ledger.savings_id, date(2026, 7, 12))
    await _record_bank_source(coffee_id)
    await _commit_link(ledger, ledger.everyday_id)

    moved_inside = await _edit(client, ledger, coffee_id, account_id=ledger.everyday_id)
    moved_before = await _edit(client, ledger, coffee_id, account_id=ledger.everyday_id, dt="2026-05-31")

    assert moved_inside.status_code == 422, moved_inside.text
    assert moved_inside.json()["detail"] == SUPPLIED
    assert moved_before.status_code == 200, moved_before.text
    assert await _dates_in(ledger.everyday_id) == [date(2026, 5, 31)]


async def test_edits_the_link_refused_save_after_unlinking(client):
    """Once Everyday is unlinked, a May Coffee moves to 12 July, a Savings one moves in, and a bank-imported one moves out, leaving the bank"""
    ledger = await _ledger(client)
    may_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 5, 1))
    savings_id = await _added_id(client, ledger, ledger.savings_id, date(2026, 7, 13))
    bank_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 7, 20))
    await _commit_link(ledger, ledger.everyday_id)
    await _record_bank_source(bank_id)
    await _unlink(client, ledger, ledger.everyday_id)

    redated = await _edit(client, ledger, may_id, dt="2026-07-12")
    moved_in = await _edit(client, ledger, savings_id, account_id=ledger.everyday_id)
    moved_out = await _edit(client, ledger, bank_id, account_id=ledger.savings_id)

    assert redated.status_code == 200, redated.text
    assert moved_in.status_code == 200, moved_in.text
    assert moved_out.status_code == 200, moved_out.text
    assert moved_out.json()["bank_source"] is None
    assert await _dates_in(ledger.everyday_id) == [date(2026, 7, 12), date(2026, 7, 13)]
    assert await _dates_in(ledger.savings_id) == [date(2026, 7, 20)]
