"""Editing several transactions at once on or into a linked account

A bulk edit is refused whole when any row it changes lands on a day the bank supplies, or moves a
bank-imported transaction out of the account, naming the account since the rows can span several,
and is taken again once the account is unlinked
"""

from datetime import date

from tests.routes.support.bank_sync_helpers import _record_bank_source
from tests.routes.support.manual_entry_helpers import (
    IMPORT_START,
    MOVE_REFUSED,
    SUPPLIED_IN_EVERYDAY,
    TODAY,
    _added_id,
    _commit_link,
    _dates_in,
    _Ledger,
    _ledger,
    _unlink,
)


async def _bulk_edit(client, ledger: _Ledger, transaction_ids: list[str], **fields):
    """Edit several transactions at once through the route"""
    return await client.patch("/transactions/bulk", json={"transaction_ids": transaction_ids, **fields}, headers=ledger.headers)


async def test_a_bulk_edit_dating_manual_transactions_inside_the_range_is_refused_whole(client):
    """Two May Coffees can't both move to 3 October or 1 June, and can move to 31 May and to 4 October"""
    ledger = await _ledger(client)
    first_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 5, 1))
    second_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 5, 2))
    await _commit_link(ledger, ledger.everyday_id)

    to_today = await _bulk_edit(client, ledger, [first_id, second_id], dt=TODAY.isoformat())
    to_start = await _bulk_edit(client, ledger, [first_id, second_id], dt=IMPORT_START.isoformat())
    unchanged = await _dates_in(ledger.everyday_id)
    to_day_before = await _bulk_edit(client, ledger, [first_id, second_id], dt="2026-05-31")
    to_day_after = await _bulk_edit(client, ledger, [first_id, second_id], dt="2026-10-04")

    assert to_today.status_code == 422, to_today.text
    assert to_today.json()["detail"] == SUPPLIED_IN_EVERYDAY
    assert to_start.status_code == 422, to_start.text
    assert to_start.json()["detail"] == SUPPLIED_IN_EVERYDAY
    assert unchanged == [date(2026, 5, 1), date(2026, 5, 2)]
    assert to_day_before.status_code == 200, to_day_before.text
    assert to_day_after.status_code == 200, to_day_after.text
    assert await _dates_in(ledger.everyday_id) == [date(2026, 10, 4), date(2026, 10, 4)]


async def test_a_bulk_move_into_the_linked_account_is_refused_when_a_row_lands_inside_the_range(client):
    """Savings' 31 May and 1 June Coffees can't move to Everyday together, and the 31 May one moves alone"""
    ledger = await _ledger(client)
    before_id = await _added_id(client, ledger, ledger.savings_id, date(2026, 5, 31))
    inside_id = await _added_id(client, ledger, ledger.savings_id, IMPORT_START)
    await _commit_link(ledger, ledger.everyday_id)

    together = await _bulk_edit(client, ledger, [before_id, inside_id], account_id=ledger.everyday_id)
    alone = await _bulk_edit(client, ledger, [before_id], account_id=ledger.everyday_id)

    assert together.status_code == 422, together.text
    assert together.json()["detail"] == SUPPLIED_IN_EVERYDAY
    assert alone.status_code == 200, alone.text
    assert await _dates_in(ledger.everyday_id) == [date(2026, 5, 31)]
    assert await _dates_in(ledger.savings_id) == [IMPORT_START]


async def test_a_bulk_edit_leaving_dates_and_accounts_alone_saves_inside_the_range(client):
    """Everyday's 15 June Coffees take a note, and their own date and account sent back"""
    ledger = await _ledger(client)
    first_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 6, 15))
    second_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 6, 15))
    await _commit_link(ledger, ledger.everyday_id)

    noted = await _bulk_edit(client, ledger, [first_id, second_id], notes="Flat white")
    resent = await _bulk_edit(client, ledger, [first_id, second_id], dt="2026-06-15", account_id=ledger.everyday_id)

    assert noted.status_code == 200, noted.text
    assert resent.status_code == 200, resent.text
    assert await _dates_in(ledger.everyday_id) == [date(2026, 6, 15), date(2026, 6, 15)]


async def test_a_bulk_edit_may_redate_bank_imported_transactions_but_not_move_them_or_redate_a_manual_one_beside_them(client):
    """Everyday's bank-imported 12 and 13 July Coffees move to 1 August but not to Savings, and not with a manual May Coffee"""
    ledger = await _ledger(client)
    first_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 7, 12))
    second_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 7, 13))
    manual_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 5, 1))
    await _commit_link(ledger, ledger.everyday_id)
    await _record_bank_source(first_id, "TRN-1001")
    await _record_bank_source(second_id, "TRN-1002")

    redated = await _bulk_edit(client, ledger, [first_id, second_id], dt="2026-08-01")
    moved = await _bulk_edit(client, ledger, [first_id, second_id], account_id=ledger.savings_id)
    with_manual = await _bulk_edit(client, ledger, [first_id, manual_id], dt="2026-08-02")

    assert redated.status_code == 200, redated.text
    assert moved.status_code == 422, moved.text
    assert moved.json()["detail"] == MOVE_REFUSED
    assert with_manual.status_code == 422, with_manual.text
    assert with_manual.json()["detail"] == SUPPLIED_IN_EVERYDAY
    assert await _dates_in(ledger.everyday_id) == [date(2026, 5, 1), date(2026, 8, 1), date(2026, 8, 1)]


async def test_a_bulk_edit_into_the_range_saves_after_unlinking(client):
    """Once Everyday is unlinked, its May Coffee and Savings' 12 July Coffee both move to Everyday on 13 July"""
    ledger = await _ledger(client)
    may_id = await _added_id(client, ledger, ledger.everyday_id, date(2026, 5, 1))
    savings_id = await _added_id(client, ledger, ledger.savings_id, date(2026, 7, 12))
    await _commit_link(ledger, ledger.everyday_id)
    await _unlink(client, ledger, ledger.everyday_id)

    edited = await _bulk_edit(client, ledger, [may_id, savings_id], dt="2026-07-13", account_id=ledger.everyday_id)

    assert edited.status_code == 200, edited.text
    assert await _dates_in(ledger.everyday_id) == [date(2026, 7, 13), date(2026, 7, 13)]
    assert await _dates_in(ledger.savings_id) == []
