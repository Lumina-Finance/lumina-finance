"""Deleting a transaction from a linked account

A bank-imported transaction can't be deleted while its account is linked, whatever the link waits
on, since only a bank removal the user approves takes it out of the ledger then. A manual one
deletes as usual, and a bank-imported one deletes once the account is unlinked, taking its bank
transaction with it
"""

import asyncio
import uuid

import pytest
from sqlalchemy import func, select

from app.models.account import Account
from app.models.bank_connection import BankLinkState
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _build_bank_link, _commit_listed_connection, _record_bank_source, _still_stored
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.routes.support.manual_entry_helpers import (
    COFFEE_DAY,
    DELETE_REFUSED,
    _added_id,
    _commit_link,
    _dates_in,
    _Ledger,
    _ledger,
    _unlink,
)


async def _delete(client, ledger: _Ledger, transaction_id: str):
    """Delete one transaction through the route"""
    return await client.delete(f"/transactions/{transaction_id}", headers=ledger.headers)


@pytest.mark.parametrize("state", [BankLinkState.ACTIVE, BankLinkState.CHOOSE_ACCOUNT])
async def test_deleting_a_bank_imported_transaction_is_refused_while_its_account_is_linked(client, state):
    """Everyday's bank-imported 12 July Coffee stays in the ledger with its bank transaction, whatever the link waits on"""
    ledger = await _ledger(client)
    coffee_id = await _added_id(client, ledger, ledger.everyday_id, COFFEE_DAY)
    await _commit_link(ledger, ledger.everyday_id, state=state)
    record_id = await _record_bank_source(coffee_id)

    refused = await _delete(client, ledger, coffee_id)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == DELETE_REFUSED
    assert await _dates_in(ledger.everyday_id) == [COFFEE_DAY]
    assert await _still_stored(record_id)


async def test_deleting_a_manual_transaction_on_a_linked_account_goes_through(client):
    """A 12 July Coffee entered by hand before Everyday was linked deletes as usual"""
    ledger = await _ledger(client)
    coffee_id = await _added_id(client, ledger, ledger.everyday_id, COFFEE_DAY)
    await _commit_link(ledger, ledger.everyday_id)

    deleted = await _delete(client, ledger, coffee_id)

    assert deleted.status_code == 204, deleted.text
    assert await _dates_in(ledger.everyday_id) == []


async def test_a_bank_imported_transaction_deletes_once_its_account_is_unlinked_taking_its_bank_transaction(client):
    """Once Everyday is unlinked, its bank-imported 12 July Coffee deletes, leaving nothing of its bank identity"""
    ledger = await _ledger(client)
    coffee_id = await _added_id(client, ledger, ledger.everyday_id, COFFEE_DAY)
    await _commit_link(ledger, ledger.everyday_id)
    record_id = await _record_bank_source(coffee_id)
    await _unlink(client, ledger, ledger.everyday_id)

    deleted = await _delete(client, ledger, coffee_id)

    assert deleted.status_code == 204, deleted.text
    assert await _dates_in(ledger.everyday_id) == []
    assert not await _still_stored(record_id)


async def test_deleting_waits_for_a_link_being_made_and_is_then_refused(client):
    """A link holding Everyday as the link request does commits first, and deleting the 12 July Coffee an earlier link imported then finds it"""
    ledger = await _ledger(client)
    coffee_id = await _added_id(client, ledger, ledger.everyday_id, COFFEE_DAY)
    await _record_bank_source(coffee_id)
    connection = await _commit_listed_connection(ledger.user_id)

    async with TestSession() as linking:
        await linking.execute(select(Account.id).where(Account.id == uuid.UUID(ledger.everyday_id)).with_for_update(key_share=True))
        account = await linking.get_one(Account, uuid.UUID(ledger.everyday_id))
        linking.add(_build_bank_link(account, connection))
        await linking.flush()
        linking_pid = await linking.scalar(select(func.pg_backend_pid()))
        deleting = asyncio.create_task(_delete(client, ledger, coffee_id))
        await _wait_until_waiting_on(linking_pid, deleting)
        await linking.commit()
    deleted = await asyncio.wait_for(deleting, 10)

    assert deleted.status_code == 422, deleted.text
    assert deleted.json()["detail"] == DELETE_REFUSED
    assert await _dates_in(ledger.everyday_id) == [COFFEE_DAY]
