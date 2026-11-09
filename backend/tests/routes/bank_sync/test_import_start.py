"""The wait before a linked account's history import starts, and starting it at once

Each import waits a couple of minutes for the user's other accounts on the connection to be linked,
so one import brings them all in: three accounts linked in a row spend a request for each window of
history once, not three times. The status says when the import starts, for the account's Bank link
section and the link flow to remind the user, and Start now makes it due at once
"""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import func, select, update

from app.models.bank_sync_job import BankSyncJob
from app.services.bank_sync import import_range, jobs, links
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _commit_listed_connection,
    _commit_other_users_account,
    _link,
    _new_account,
    _sign_up,
    _spend_requests,
)
from tests.routes.support.link_helpers import _NOW

_TWO_MINUTES = timedelta(minutes=2)

# What the app allows for the time a request takes between queueing a job and reading its wait
_ALLOWANCE = timedelta(seconds=10)


@pytest.fixture(autouse=True)
def _pinned_now(pin_clock):
    """Pin the time the link and import range routes read, and the queue reads the wait it is given against"""
    pin_clock(_NOW, links, import_range, jobs)


async def _linkable_pair(client) -> tuple[dict, str, str, object]:
    """Sign up with Everyday and Savings and a connection listing a bank account for each"""
    headers, user_id = await _sign_up(client)
    everyday = await _new_account(client, headers, "Everyday")
    savings = await _new_account(client, headers, "Savings")
    connection = await _commit_listed_connection(user_id, "ACT-1", "ACT-2", discovered_at=_NOW)
    return headers, everyday, savings, connection


async def _waits() -> list[timedelta]:
    """Return how long from now by the database's clock each queued job waits to run"""
    async with TestSession() as session:
        return list(await session.scalars(select(BankSyncJob.run_after - func.now()).where(BankSyncJob.status == "queued")))


async def _starts_at(client, headers, account_id: str) -> str | None:
    """Return when the account's import starts, as its bank link says"""
    status = await client.get(f"/accounts/{account_id}/bank-link", headers=headers)
    assert status.status_code == 200, status.text
    return status.json()["link"]["sync"]["import_starts_at"]


async def test_link_queues_the_import_two_minutes_on_and_the_status_says_when_it_starts(client):
    """Linking Everyday queues its first import 2 minutes out rather than at once, and its bank link shows when"""
    headers, everyday, _, connection = await _linkable_pair(client)

    assert (await _link(client, headers, everyday, connection.id, "ACT-1")).status_code == 201

    [wait] = await _waits()
    assert _TWO_MINUTES - _ALLOWANCE < wait <= _TWO_MINUTES
    assert await _starts_at(client, headers, everyday) is not None


async def test_a_second_link_on_the_connection_joins_the_queued_import_and_moves_its_start_on(client):
    """Savings, linked after Everyday, shares Everyday's import and delays it, so one import brings both in

    The first link's time is brought forward by hand to 1 minute from now, as a minute passing would
    leave it, so the second link's move to 2 minutes from now is told apart from leaving it
    """
    headers, everyday, savings, connection = await _linkable_pair(client)
    assert (await _link(client, headers, everyday, connection.id, "ACT-1")).status_code == 201
    async with TestSession() as session:
        await session.execute(update(BankSyncJob).values(run_after=func.now() + timedelta(minutes=1)))
        await session.commit()
    assert [wait <= timedelta(minutes=1) for wait in await _waits()] == [True]

    assert (await _link(client, headers, savings, connection.id, "ACT-2")).status_code == 201

    [wait] = await _waits()
    assert _TWO_MINUTES - _ALLOWANCE < wait <= _TWO_MINUTES
    assert [await _starts_at(client, headers, everyday) is not None, await _starts_at(client, headers, savings) is not None] == [True, True]


async def test_start_now_makes_the_queued_import_due_at_once_and_the_reminder_goes(client):
    """Pressing Start now on Everyday's reminder runs the import for every account waiting on it, then nothing waits"""
    headers, everyday, savings, connection = await _linkable_pair(client)
    assert (await _link(client, headers, everyday, connection.id, "ACT-1")).status_code == 201
    assert (await _link(client, headers, savings, connection.id, "ACT-2")).status_code == 201

    started = await client.post(f"/accounts/{everyday}/bank-link/start-import", headers=headers)

    assert started.status_code == 200, started.text
    assert started.json()["sync"]["import_starts_at"] is None
    [wait] = await _waits()
    assert wait <= timedelta(0)
    assert [await _starts_at(client, headers, everyday), await _starts_at(client, headers, savings)] == [None, None]


async def test_start_now_is_refused_once_nothing_waits_to_start(client):
    """A second press, or one from another window, finds the import already due and is told so"""
    headers, everyday, _, connection = await _linkable_pair(client)
    assert (await _link(client, headers, everyday, connection.id, "ACT-1")).status_code == 201
    assert (await client.post(f"/accounts/{everyday}/bank-link/start-import", headers=headers)).status_code == 200

    refused = await client.post(f"/accounts/{everyday}/bank-link/start-import", headers=headers)

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == "The import has already started"


async def test_start_now_leaves_an_import_waiting_on_the_request_budget_alone(client):
    """Everyday's import is queued for when a request frees up, not for its first links, so Start now neither shows nor moves it"""
    headers, everyday, _, connection = await _linkable_pair(client)
    assert (await _link(client, headers, everyday, connection.id, "ACT-1")).status_code == 201
    await _spend_requests(connection, 20, datetime.now(_NOW.tzinfo) - timedelta(hours=1))
    [before] = await _waits()

    refused = await client.post(f"/accounts/{everyday}/bank-link/start-import", headers=headers)

    assert refused.status_code == 409, refused.text
    assert await _starts_at(client, headers, everyday) is None
    [after] = await _waits()
    assert after >= before - _ALLOWANCE


async def test_start_now_on_another_users_account_is_not_found(client):
    """Another user's account can't be told to start, or even found"""
    headers, everyday, _, connection = await _linkable_pair(client)
    assert (await _link(client, headers, everyday, connection.id, "ACT-1")).status_code == 201
    theirs = await _commit_other_users_account()

    refused = await client.post(f"/accounts/{theirs.id}/bank-link/start-import", headers=headers)

    assert (refused.status_code, refused.json()["detail"]) == (404, "Account not found")
    assert [wait > timedelta(0) for wait in await _waits()] == [True]
