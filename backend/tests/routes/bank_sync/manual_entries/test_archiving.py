"""Archiving a linked account

An account can't be archived while it is linked, whatever the link waits on, and archives once unlinked
"""

import asyncio
import uuid

import pytest
from sqlalchemy import func, select

from app.models.account import Account
from app.models.bank_connection import BankLinkState
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _build_bank_link, _commit_listed_connection
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.routes.support.manual_entry_helpers import _commit_link, _ledger, _unlink

_ARCHIVE_REFUSED = "This account can't be archived while it's linked to Fake Bank. Unlink it first"


async def _is_archived(account_id: str) -> bool:
    """Return whether the account is archived"""
    async with TestSession() as session:
        return await session.scalar(select(Account.is_archived).where(Account.id == uuid.UUID(account_id)))


@pytest.mark.parametrize("state", [BankLinkState.ACTIVE, BankLinkState.CHOOSE_ACCOUNT])
async def test_archiving_a_linked_account_is_refused_until_it_is_unlinked(client, state):
    """Everyday can't be archived while linked, whatever its link waits on, and archives once unlinked"""
    ledger = await _ledger(client)
    await _commit_link(ledger, ledger.everyday_id, state=state)

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
