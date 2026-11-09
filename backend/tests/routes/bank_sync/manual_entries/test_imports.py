"""Importing a file or a journal export into a linked account

An import is refused whole when any row lands on a day the bank supplies, including the leg a
transfer writes into the account, naming the account since the rows can span several, and is
taken again once the account is unlinked
"""

from datetime import date

import pytest

from tests.routes.support.manual_entry_helpers import (
    INSIDE,
    OUTSIDE,
    SUPPLIED_IN_EVERYDAY,
    _commit_link,
    _dates_in,
    _Ledger,
    _ledger,
    _unlink,
)
from tests.routes.transactions._import_helpers import _import_run


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


def _ofx_import(ledger: _Ledger, *rows: tuple[str, date]) -> dict:
    """Return a statement import of one Coffee row into Everyday for each bank ID and day"""
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
                "tag_names": [],
                "bank_account": "everyday-statement",
                "bank_transaction": bank_transaction_id,
            }
            for bank_transaction_id, day in rows
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


@pytest.mark.parametrize("day", INSIDE)
async def test_a_file_import_with_a_row_inside_the_range_is_refused_whole(client, day):
    """A file importing 31 May and a day Fake Bank supplies into Everyday writes neither"""
    ledger = await _ledger(client)
    await _commit_link(ledger, ledger.everyday_id)

    imported = await _import_run(client, ledger.headers, _csv_import(ledger, date(2026, 5, 31), day))

    assert imported.status_code == 422, imported.text
    assert imported.json()["detail"] == SUPPLIED_IN_EVERYDAY
    assert await _dates_in(ledger.everyday_id) == []


async def test_a_file_import_outside_the_range_saves(client):
    """A file importing 31 May, 4 October and 10 October into Everyday writes all three"""
    ledger = await _ledger(client)
    await _commit_link(ledger, ledger.everyday_id)

    imported = await _import_run(client, ledger.headers, _csv_import(ledger, *OUTSIDE))

    assert imported.status_code == 201, imported.text
    assert await _dates_in(ledger.everyday_id) == OUTSIDE


async def test_a_statement_import_leaves_out_a_row_already_held_inside_the_range_and_saves_the_rest(client):
    """A 12 July Coffee imported before linking is in the statement again with a new 31 May one

    The held row is left out, as it is from any account, so it is no row landing on a day the
    bank supplies, and the 31 May one is saved
    """
    ledger = await _ledger(client)
    first = await _import_run(client, ledger.headers, _ofx_import(ledger, ("A1", date(2026, 7, 12))), source="ofx")
    assert first.status_code == 201, first.text
    await _commit_link(ledger, ledger.everyday_id)

    imported = await _import_run(
        client, ledger.headers, _ofx_import(ledger, ("A1", date(2026, 7, 12)), ("B1", date(2026, 5, 31))), source="ofx"
    )

    assert imported.status_code == 201, imported.text
    assert await _dates_in(ledger.everyday_id) == [date(2026, 5, 31), date(2026, 7, 12)]


@pytest.mark.parametrize("day", INSIDE)
async def test_a_journal_import_with_a_row_inside_the_range_is_refused_whole(client, day):
    """A journal export with a 31 May Coffee and one on a day Fake Bank supplies writes neither"""
    ledger = await _ledger(client)
    await _commit_link(ledger, ledger.everyday_id)

    imported = await _import_run(
        client, ledger.headers, _journal_import(ledger, _journal_row("1", date(2026, 5, 31)), _journal_row("2", day)), source="firefly"
    )

    assert imported.status_code == 422, imported.text
    assert imported.json()["detail"] == SUPPLIED_IN_EVERYDAY
    assert await _dates_in(ledger.everyday_id) == []


async def test_a_journal_transfer_into_the_linked_account_inside_the_range_is_refused(client):
    """A 12 July transfer from Savings writes a leg into Everyday too, so neither leg is written"""
    ledger = await _ledger(client)
    await _commit_link(ledger, ledger.everyday_id)

    imported = await _import_run(client, ledger.headers, _journal_import(ledger, _journal_transfer("1", date(2026, 7, 12))), source="firefly")

    assert imported.status_code == 422, imported.text
    assert imported.json()["detail"] == SUPPLIED_IN_EVERYDAY
    assert await _dates_in(ledger.savings_id) == []


async def test_a_journal_import_names_the_linked_account_whose_row_lands_inside_the_range(client):
    """Everyday and Savings are both linked, and only Savings' 12 July Coffee is on a day its bank supplies"""
    ledger = await _ledger(client)
    await _commit_link(ledger, ledger.everyday_id)
    await _commit_link(ledger, ledger.savings_id, external_account_id="ACT-2")
    rows = [_journal_row("1", date(2026, 5, 31)), _journal_row("2", date(2026, 7, 12), source_account="Savings")]

    imported = await _import_run(client, ledger.headers, _journal_import(ledger, *rows), source="firefly")

    assert imported.status_code == 422, imported.text
    assert imported.json()["detail"] == "Fake Bank supplies the transactions in Savings from Jun 1, 2026 to today"


async def test_a_journal_import_outside_the_range_saves(client):
    """Coffees on 31 May, 4 October and 10 October and a 31 May transfer from Savings all land in Everyday"""
    ledger = await _ledger(client)
    await _commit_link(ledger, ledger.everyday_id)
    rows = [_journal_row(str(index), day) for index, day in enumerate(OUTSIDE, start=1)]

    imported = await _import_run(
        client, ledger.headers, _journal_import(ledger, *rows, _journal_transfer("9", date(2026, 5, 31))), source="firefly"
    )

    assert imported.status_code == 201, imported.text
    assert await _dates_in(ledger.everyday_id) == [date(2026, 5, 31), *OUTSIDE]


async def test_imports_inside_the_range_save_after_unlinking(client):
    """Once Everyday is unlinked, a file brings in a 14 July Coffee and a journal export a 15 July one"""
    ledger = await _ledger(client)
    await _commit_link(ledger, ledger.everyday_id)
    await _unlink(client, ledger, ledger.everyday_id)

    file_import = await _import_run(client, ledger.headers, _csv_import(ledger, date(2026, 7, 14)))
    journal = await _import_run(client, ledger.headers, _journal_import(ledger, _journal_row("1", date(2026, 7, 15))), source="firefly")

    assert file_import.status_code == 201, file_import.text
    assert journal.status_code == 201, journal.text
    assert await _dates_in(ledger.everyday_id) == [date(2026, 7, 14), date(2026, 7, 15)]
