"""Adding a manual transaction to a linked account

The days the bank supplies are refused, from the import start through today in the user's zone, and
taken again once the account is unlinked
"""

import asyncio
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import func, select

from app.models.account import Account
from app.models.bank_connection import BankLinkState
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _build_bank_link, _commit_listed_connection
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.routes.support.manual_entry_helpers import (
    IMPORT_START,
    INSIDE,
    OUTSIDE,
    SUPPLIED,
    _add,
    _commit_link,
    _dates_in,
    _ledger,
    _unlink,
)


@pytest.mark.parametrize("day", INSIDE)
async def test_a_manual_transaction_dated_from_the_import_start_through_today_is_refused(client, day):
    """Adding a Coffee to Everyday on a day Fake Bank supplies is refused, naming the range"""
    ledger = await _ledger(client)
    await _commit_link(ledger, ledger.everyday_id)

    added = await _add(client, ledger, ledger.everyday_id, day)

    assert added.status_code == 422, added.text
    assert added.json()["detail"] == SUPPLIED
    assert await _dates_in(ledger.everyday_id) == []


@pytest.mark.parametrize("day", OUTSIDE)
async def test_a_manual_transaction_dated_before_the_import_start_or_after_today_saves(client, day):
    """31 May, 4 October and 10 October are outside the days Fake Bank supplies, so they save"""
    ledger = await _ledger(client)
    await _commit_link(ledger, ledger.everyday_id)

    added = await _add(client, ledger, ledger.everyday_id, day)

    assert added.status_code == 201, added.text
    assert await _dates_in(ledger.everyday_id) == [day]


async def test_a_link_waiting_for_its_bank_account_to_be_chosen_again_still_refuses_and_other_accounts_take_any_day(client):
    """Everyday stays linked while it waits in Choose bank account, and unlinked Savings takes 12 July"""
    ledger = await _ledger(client)
    await _commit_link(ledger, ledger.everyday_id, state=BankLinkState.CHOOSE_ACCOUNT)

    everyday = await _add(client, ledger, ledger.everyday_id, date(2026, 7, 12))
    savings = await _add(client, ledger, ledger.savings_id, date(2026, 7, 12))

    assert everyday.status_code == 422, everyday.text
    assert everyday.json()["detail"] == SUPPLIED
    assert savings.status_code == 201, savings.text


async def test_a_manual_transaction_waits_for_a_link_being_made_and_is_then_refused(client):
    """A link holding Everyday as the link request does commits first, and the 12 July Coffee then finds it"""
    ledger = await _ledger(client)
    connection = await _commit_listed_connection(ledger.user_id)

    async with TestSession() as linking:
        await linking.execute(select(Account.id).where(Account.id == uuid.UUID(ledger.everyday_id)).with_for_update(key_share=True))
        account = await linking.get_one(Account, uuid.UUID(ledger.everyday_id))
        link = _build_bank_link(account, connection)
        link.import_start = IMPORT_START
        link.checkpoint = IMPORT_START - timedelta(days=1)
        linking.add(link)
        await linking.flush()
        linking_pid = await linking.scalar(select(func.pg_backend_pid()))
        adding = asyncio.create_task(_add(client, ledger, ledger.everyday_id, date(2026, 7, 12)))
        await _wait_until_waiting_on(linking_pid, adding)
        await linking.commit()
    added = await asyncio.wait_for(adding, 10)

    assert added.status_code == 422, added.text
    assert added.json()["detail"] == SUPPLIED
    assert await _dates_in(ledger.everyday_id) == []


async def test_a_manual_transaction_inside_the_range_saves_after_unlinking(client):
    """Once Everyday is unlinked, 12 July takes a manual Coffee"""
    ledger = await _ledger(client)
    await _commit_link(ledger, ledger.everyday_id)
    await _unlink(client, ledger, ledger.everyday_id)

    added = await _add(client, ledger, ledger.everyday_id, date(2026, 7, 12))

    assert added.status_code == 201, added.text
    assert await _dates_in(ledger.everyday_id) == [date(2026, 7, 12)]
