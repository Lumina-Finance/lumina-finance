"""Deleting several transactions at once when one came from a linked account's bank

A bulk delete reaching a bank-imported transaction is refused whole while its account is linked, as
deleting that transaction alone is, and goes through once the account is unlinked, taking the bank
transaction with it
"""

from tests.routes.support.bank_sync_helpers import _record_bank_source, _still_stored
from tests.routes.support.manual_entry_helpers import (
    BULK_DELETE_REFUSED,
    COFFEE_DAY,
    _added_id,
    _commit_link,
    _dates_in,
    _Ledger,
    _ledger,
    _unlink,
)


async def _bulk_delete(client, ledger: _Ledger, transaction_ids: list[str]):
    """Delete several transactions at once through the route"""
    return await client.post("/transactions/bulk/delete", json={"transaction_ids": transaction_ids}, headers=ledger.headers)


async def test_a_bulk_delete_reaching_a_bank_imported_transaction_is_refused_whole_while_its_account_is_linked(client):
    """Savings' manual 12 July Coffee and Everyday's bank-imported one both stay, with the bank transaction

    The refusal speaks of the selection's transactions rather than one, naming the account refused
    """
    ledger = await _ledger(client)
    manual_id = await _added_id(client, ledger, ledger.savings_id, COFFEE_DAY)
    imported_id = await _added_id(client, ledger, ledger.everyday_id, COFFEE_DAY)
    await _commit_link(ledger, ledger.everyday_id)
    record_id = await _record_bank_source(imported_id)

    refused = await _bulk_delete(client, ledger, [manual_id, imported_id])

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == BULK_DELETE_REFUSED
    assert await _dates_in(ledger.savings_id) == [COFFEE_DAY]
    assert await _dates_in(ledger.everyday_id) == [COFFEE_DAY]
    assert await _still_stored(record_id)


async def test_a_bulk_delete_takes_a_bank_imported_transaction_once_its_account_is_unlinked(client):
    """Once Everyday is unlinked, its bank-imported 12 July Coffee deletes beside Savings' manual one, leaving nothing of its bank identity"""
    ledger = await _ledger(client)
    manual_id = await _added_id(client, ledger, ledger.savings_id, COFFEE_DAY)
    imported_id = await _added_id(client, ledger, ledger.everyday_id, COFFEE_DAY)
    await _commit_link(ledger, ledger.everyday_id)
    record_id = await _record_bank_source(imported_id)
    await _unlink(client, ledger, ledger.everyday_id)

    deleted = await _bulk_delete(client, ledger, [manual_id, imported_id])

    assert deleted.status_code == 200, deleted.text
    assert await _dates_in(ledger.savings_id) == []
    assert await _dates_in(ledger.everyday_id) == []
    assert not await _still_stored(record_id)
