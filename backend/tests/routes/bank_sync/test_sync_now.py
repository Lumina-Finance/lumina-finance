"""Sync now on a linked account: it queues a sync of the account straight away, or says why it can't

While the account's import waits for the user's other accounts to join it, Sync now starts that
import at once instead, and the wait itself is tested here too.

A sync already queued for the connection takes the request in. The request is refused with the
reason the button shows while an import or a sync runs on the account, only the user can restart its
sync, or the review pause holds it, and while the budget is spent, saying whether the connection's
own limit or Fake Bank's holds it and when a request frees up. A refusal that queues anything spends
a request the user was told it wouldn't. The job running the
sync is tested with the others, in the bank sync service tests
"""

import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import func, select, update

from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState
from app.models.bank_sync_job import BankSyncJob, BankSyncJobKind, BankSyncJobStatus
from app.models.cache_state import UserCacheState
from app.services.bank_sync import account_link, import_range, jobs, links, sync_now
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _changed_at,
    _commit_link,
    _commit_listed_connection,
    _commit_other_users_account,
    _commit_running_job,
    _link,
    _new_account,
    _new_group_account,
    _seed_job,
    _sign_up,
    _spend_requests,
    _update_connection,
)
from tests.routes.support.link_helpers import _NOW as _LINKED_AT

# Noon on October 5 in Toronto, the zone _sign_up stores
_NOW = datetime(2026, 10, 5, 12, 0, tzinfo=ZoneInfo("America/Toronto"))

_TWO_MINUTES = timedelta(minutes=2)

# What the app allows for the time a request takes between queueing a job and reading its wait
_ALLOWANCE = timedelta(seconds=10)

# A link whose import is long over. It last synced five hours ago and next syncs in 19 hours
_SYNCED = {
    "importing": False,
    "last_success_at": _NOW - timedelta(hours=5),
    "last_attempt_at": _NOW - timedelta(hours=5),
    "next_attempt_at": _NOW + timedelta(hours=19),
}

# An attempt that failed ten minutes ago, waiting for the first retry of its series
_RETRY = {
    "retry_count": 1,
    "last_attempt_at": _NOW - timedelta(minutes=10),
    "last_failure_reason": "Fake Bank Online couldn't be reached",
    "next_attempt_at": _NOW + timedelta(minutes=20),
}

# A bank sign-in the provider asked for an hour ago
_SIGNIN_NEEDED = {"signin_needed_since": _NOW - timedelta(hours=1)}


@pytest.fixture(autouse=True)
def _pinned_now(pin_clock):
    """Pin the time Sync now and the account link read"""
    pin_clock(_NOW, sync_now, account_link)


async def _sync_now(client, headers, account_id):
    """Press Sync now on the account"""
    return await client.post(f"/accounts/{account_id}/bank-link/sync", headers=headers)


async def _queued_requests() -> list[tuple]:
    """Return each queued job's kind and the links it syncs now as the user asked, read as the table owner"""
    async with TestSession() as session:
        rows = await session.execute(
            select(BankSyncJob.kind, BankSyncJob.requested_link_ids).where(BankSyncJob.status == BankSyncJobStatus.QUEUED)
        )
        return [(kind, set(requested)) for kind, requested in rows]


async def _data_changed_at(user_id: uuid.UUID) -> datetime:
    """Return when the user's data last changed, the mark an import's undo compares with, read as the table owner"""
    async with TestSession() as session:
        return await session.scalar(select(UserCacheState.changed_at).where(UserCacheState.user_id == user_id))


async def _link_everyday(client, **values) -> tuple[dict, str, BankConnection, BankAccountLink]:
    """Sign up with Everyday linked on a Fake Bank connection listed at noon, its link's values replaced as given

    Returns:
        The user's headers, Everyday's id, the connection and the link
    """
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    link = await _commit_link(account_id, connection, **values)
    return headers, account_id, connection, link


async def test_sync_now_queues_a_sync_of_the_account_that_keeps_its_state_until_a_worker_starts_it(client):
    """Everyday synced five hours ago, and Sync now queues a manual sync of it. It reads as requested while Everyday still reads as synced

    The user's open pages are told, as of a status change, since queueing a sync changes none of
    their data. Marked as a data change, it would stop the user undoing an import
    """
    headers, account_id, connection, link = await _link_everyday(client, **_SYNCED)
    changed_before = await _changed_at(client, headers)
    data_before = await _data_changed_at(connection.owner_id)

    response = await _sync_now(client, headers, account_id)

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["account_id"], body["sync"]["state"], body["sync"]["sync_requested"]) == (account_id, "synced", True)
    assert await _queued_requests() == [("manual", {link.id})]
    assert await _changed_at(client, headers) != changed_before
    assert await _data_changed_at(connection.owner_id) == data_before


@pytest.mark.parametrize(
    ("values", "state"),
    [
        pytest.param(_SYNCED | _SIGNIN_NEEDED, "bank_signin_needed", id="bank-sign-in-needed"),
        pytest.param(_SYNCED | _RETRY, "retrying", id="retrying"),
    ],
)
async def test_sync_now_runs_while_the_bank_needs_a_sign_in_or_a_retry_waits(client, values, state):
    """The user may have just signed in again at Fake Bank Online, or wants the account a retry is waiting on, so neither refuses"""
    headers, account_id, _, link = await _link_everyday(client, **values)

    response = await _sync_now(client, headers, account_id)

    assert response.status_code == 200, response.text
    assert (response.json()["sync"]["state"], response.json()["sync"]["sync_requested"]) == (state, True)
    assert await _queued_requests() == [("manual", {link.id})]


async def test_sync_now_joins_the_sync_already_queued_for_the_connection(client):
    """Tomorrow's sync is queued when Sync now is pressed on Everyday, twice, and then on Savings, leaving one manual sync of both, due now"""
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    savings_id = await _new_account(client, headers, "Savings")
    connection = await _commit_listed_connection(user_id, "ACT-1", "ACT-2", discovered_at=_NOW)
    everyday = await _commit_link(everyday_id, connection, "ACT-1", **_SYNCED)
    savings = await _commit_link(savings_id, connection, "ACT-2", **_SYNCED)
    tomorrow = datetime.now(UTC) + timedelta(days=1)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED, run_after=tomorrow)

    responses = [await _sync_now(client, headers, account_id) for account_id in (everyday_id, everyday_id, savings_id)]

    assert [response.status_code for response in responses] == [200, 200, 200]
    assert await _queued_requests() == [("manual", {everyday.id, savings.id})]
    async with TestSession() as session:
        assert await session.scalar(select(BankSyncJob.run_after)) < tomorrow - timedelta(hours=23)


@pytest.mark.parametrize(
    ("values", "connection_values", "running", "detail"),
    [
        # A worker fetching the import's next part runs a sync too. The import's own reason outranks the sync's
        pytest.param({}, {}, True, "The import is still running", id="importing"),
        pytest.param(_SYNCED, {}, True, "A sync is already running", id="syncing"),
        # The bank sign-in shows over the sync, but a second sync would only spend another request
        pytest.param(_SYNCED | _SIGNIN_NEEDED, {}, True, "A sync is already running", id="syncing-while-the-bank-needs-a-sign-in"),
        pytest.param(_SYNCED, {"credential_rejected_at": _NOW}, False, "Please reconnect Fake Bank in Settings first", id="reconnect-needed"),
        pytest.param(
            {"state": BankLinkState.CHOOSE_ACCOUNT, "importing": False},
            {},
            False,
            "Please choose the bank account again first",
            id="choose-bank-account",
        ),
        pytest.param(
            _SYNCED | {"paused": True},
            {},
            False,
            "Paused until 50 or fewer items wait for review",
            id="paused-for-review",
        ),
    ],
)
async def test_sync_now_is_refused_while_something_holds_the_account_back(client, values, connection_values, running, detail):
    """Each refusal gives the reason the button shows and queues nothing"""
    headers, account_id, connection, link = await _link_everyday(client, **values)
    if connection_values:
        await _update_connection(connection, **connection_values)
    if running:
        await _commit_running_job(connection, link, now=_NOW)

    response = await _sync_now(client, headers, account_id)

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == detail
    assert await _queued_requests() == []


@pytest.mark.parametrize(
    ("oldest", "when"),
    [
        pytest.param(_NOW - timedelta(hours=21), "in 3 hours", id="hours"),
        pytest.param(_NOW - timedelta(hours=23, minutes=55), "in 5 minutes", id="minutes"),
        pytest.param(_NOW - timedelta(hours=23, minutes=59, seconds=30), "shortly", id="under-a-minute"),
    ],
)
async def test_sync_now_with_the_connections_requests_spent_says_when_one_frees(client, oldest, when):
    """All 20 of the connection's requests went out in the last day, so Sync now waits for the oldest to leave it, and queues nothing"""
    headers, account_id, connection, _ = await _link_everyday(client, **_SYNCED)
    await _spend_requests(connection, 20, oldest)

    response = await _sync_now(client, headers, account_id)

    assert response.status_code == 429, response.text
    assert response.json()["detail"] == f"This connection has used its 20 Fake Bank requests in the last 24 hours. More are available {when}"
    assert await _queued_requests() == []


@pytest.mark.parametrize(
    ("used", "detail"),
    [
        pytest.param(4, "Fake Bank says this connection has reached its request limit. More are available in 3 hours", id="provider-limit"),
        pytest.param(
            20, "This connection has used its 20 Fake Bank requests in the last 24 hours. More are available in 3 hours", id="own-limit-too"
        ),
    ],
)
async def test_sync_now_after_the_provider_said_its_quota_is_spent_says_whose_limit_holds_it_back(client, used, detail):
    """Fake Bank said its quota was spent. That holds requests back until the oldest one counted leaves the last day, in 3 hours

    With 4 of the connection's 20 requests used, Fake Bank's limit is what holds Sync now back. With
    all 20 used, the connection's own limit frees a request at the same time, so it says that one
    """
    headers, account_id, connection, _ = await _link_everyday(client, **_SYNCED)
    oldest = _NOW - timedelta(hours=21)
    await _spend_requests(connection, used, oldest)
    await _update_connection(connection, request_budget_spent_until=oldest + timedelta(hours=24))

    response = await _sync_now(client, headers, account_id)

    assert response.status_code == 429, response.text
    assert response.json()["detail"] == detail
    assert await _queued_requests() == []


async def test_sync_now_on_an_account_that_isnt_linked_is_not_found(client):
    """Everyday has no bank link, so there's nothing to sync"""
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")

    response = await _sync_now(client, headers, account_id)

    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "This account is not linked to a bank"


async def test_sync_now_on_another_users_linked_account_reads_as_one_that_doesnt_exist(client):
    """Another user's linked account and an id no account has give the same answer, and nothing is queued"""
    headers, _ = await _sign_up(client)
    theirs = await _commit_other_users_account()
    connection = await _commit_listed_connection(theirs.owner_id, discovered_at=_NOW)
    await _commit_link(theirs.id, connection, **_SYNCED)

    refused = await _sync_now(client, headers, theirs.id)
    missing = await _sync_now(client, headers, uuid.uuid4())

    assert (refused.status_code, refused.json()["detail"]) == (404, "Account not found")
    assert (missing.status_code, missing.json()["detail"]) == (404, "Account not found")
    assert await _queued_requests() == []


async def test_sync_now_on_a_group_account_is_refused_to_its_admin(client):
    """A group account isn't the user's own, so it can't be linked or synced"""
    headers, _ = await _sign_up(client)
    account_id = await _new_group_account(client, headers)

    response = await _sync_now(client, headers, account_id)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "Accounts shared with a group can't be linked to a bank yet"


@pytest.fixture
def _import_wait_clock(pin_clock, monkeypatch):
    """Let accounts be linked at a pinned time while the status and the queue read the real clock

    The wait before an import starts is read by the database's clock, so Sync now's own reads can't
    be pinned to another day as the other tests here pin them
    """
    monkeypatch.setattr(sync_now, "datetime", datetime)
    monkeypatch.setattr(account_link, "datetime", datetime)
    pin_clock(_LINKED_AT, links, import_range, jobs)


async def _linkable_pair(client) -> tuple[dict, str, str, BankConnection]:
    """Sign up with Everyday and Savings and a connection listing a bank account for each"""
    headers, user_id = await _sign_up(client)
    everyday = await _new_account(client, headers, "Everyday")
    savings = await _new_account(client, headers, "Savings")
    connection = await _commit_listed_connection(user_id, "ACT-1", "ACT-2", discovered_at=_LINKED_AT)
    return headers, everyday, savings, connection


async def _waits() -> list[timedelta]:
    """Return how long from now by the database's clock each queued job waits to run"""
    async with TestSession() as session:
        return list(await session.scalars(select(BankSyncJob.run_after - func.now()).where(BankSyncJob.status == BankSyncJobStatus.QUEUED)))


async def _starts_at(client, headers, account_id: str) -> str | None:
    """Return when the account's import starts, as its bank link says"""
    status = await client.get(f"/accounts/{account_id}/bank-link", headers=headers)
    assert status.status_code == 200, status.text
    return status.json()["link"]["sync"]["import_starts_at"]


@pytest.mark.usefixtures("_import_wait_clock")
async def test_link_queues_the_import_two_minutes_on_and_the_status_says_when_it_starts(client):
    """Linking Everyday queues its first import 2 minutes out rather than at once, and its bank link shows when"""
    headers, everyday, _, connection = await _linkable_pair(client)

    assert (await _link(client, headers, everyday, connection.id, "ACT-1")).status_code == 201

    [wait] = await _waits()
    assert _TWO_MINUTES - _ALLOWANCE < wait <= _TWO_MINUTES
    assert await _starts_at(client, headers, everyday) is not None


@pytest.mark.usefixtures("_import_wait_clock")
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


@pytest.mark.usefixtures("_import_wait_clock")
async def test_sync_now_makes_the_queued_import_due_at_once_and_the_reminder_goes(client):
    """Pressing Sync now on Everyday while its import waits runs the import for every account waiting on it, then nothing waits"""
    headers, everyday, savings, connection = await _linkable_pair(client)
    assert (await _link(client, headers, everyday, connection.id, "ACT-1")).status_code == 201
    assert (await _link(client, headers, savings, connection.id, "ACT-2")).status_code == 201

    started = await _sync_now(client, headers, everyday)

    assert started.status_code == 200, started.text
    assert started.json()["sync"]["import_starts_at"] is None
    [wait] = await _waits()
    assert wait <= timedelta(0)
    assert [await _starts_at(client, headers, everyday), await _starts_at(client, headers, savings)] == [None, None]


@pytest.mark.usefixtures("_import_wait_clock")
async def test_sync_now_queues_no_sync_of_its_own_while_it_starts_the_waiting_import(client):
    """Starting the waiting import is the whole of the press, so no manual sync joins the queue beside it"""
    headers, everyday, _, connection = await _linkable_pair(client)
    assert (await _link(client, headers, everyday, connection.id, "ACT-1")).status_code == 201

    assert (await _sync_now(client, headers, everyday)).status_code == 200

    assert [kind for kind, _ in await _queued_requests()] == ["initial"]


@pytest.mark.usefixtures("_import_wait_clock")
async def test_sync_now_is_refused_once_the_import_has_started(client):
    """A second press, or one from another window, finds the import running and is told so"""
    headers, everyday, _, connection = await _linkable_pair(client)
    assert (await _link(client, headers, everyday, connection.id, "ACT-1")).status_code == 201
    assert (await _sync_now(client, headers, everyday)).status_code == 200

    refused = await _sync_now(client, headers, everyday)

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == "The import is still running"


@pytest.mark.usefixtures("_import_wait_clock")
async def test_sync_now_leaves_an_import_waiting_on_the_request_budget_alone(client):
    """Everyday's import is queued for when a request frees up, not for its first links, so Sync now neither shows nor moves it"""
    headers, everyday, _, connection = await _linkable_pair(client)
    assert (await _link(client, headers, everyday, connection.id, "ACT-1")).status_code == 201
    await _spend_requests(connection, 20, datetime.now(_LINKED_AT.tzinfo) - timedelta(hours=1))
    [before] = await _waits()

    refused = await _sync_now(client, headers, everyday)

    assert refused.status_code == 429, refused.text
    assert await _starts_at(client, headers, everyday) is None
    [after] = await _waits()
    assert after >= before - _ALLOWANCE


@pytest.mark.usefixtures("_import_wait_clock")
async def test_sync_now_on_another_users_account_does_not_start_their_waiting_import(client):
    """Another user's account can't be told to start, or even found, and their import keeps waiting"""
    headers, everyday, _, connection = await _linkable_pair(client)
    assert (await _link(client, headers, everyday, connection.id, "ACT-1")).status_code == 201
    theirs = await _commit_other_users_account()

    refused = await _sync_now(client, headers, theirs.id)

    assert (refused.status_code, refused.json()["detail"]) == (404, "Account not found")
    assert [wait > timedelta(0) for wait in await _waits()] == [True]
