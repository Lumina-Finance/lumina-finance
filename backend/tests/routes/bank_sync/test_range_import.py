"""Importing a date range into a linked account from its Bank link section

The request starts the range on the link and queues a sync of its connection without asking for the
link's own routine sync. It is refused while a range already runs and for every reason Sync now is,
the request budget included, and a refusal stores no range and queues nothing. The job fetching the
range is tested with the others, in the bank sync service tests
"""

import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState
from app.models.bank_sync_job import BankSyncJob, BankSyncJobKind, BankSyncJobStatus
from app.services.bank_sync import account_link, range_import
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _changed_at,
    _commit_link,
    _commit_listed_connection,
    _commit_other_users_account,
    _commit_running_job,
    _new_account,
    _new_group_account,
    _seed_job,
    _sign_up,
    _spend_requests,
    _update_connection,
)

# Noon on October 5 in Toronto, the zone _sign_up stores. Fake Bank reaches back to 1 October 2025
_NOW = datetime(2026, 10, 5, 12, 0, tzinfo=ZoneInfo("America/Toronto"))

# A link whose import is long over. It last synced five hours ago and next syncs in 19 hours
_SYNCED = {
    "importing": False,
    "last_success_at": _NOW - timedelta(hours=5),
    "last_attempt_at": _NOW - timedelta(hours=5),
    "next_attempt_at": _NOW + timedelta(hours=19),
}

# March, a range the provider reaches
_MARCH = {"first_day": "2026-03-01", "last_day": "2026-03-31"}

# A range already running on the link, through the end of February
_RUNNING = {
    "range_first_day": date(2026, 2, 1),
    "range_last_day": date(2026, 2, 28),
    "range_next_day": date(2026, 2, 1),
    "range_restores_dismissed": False,
}


@pytest.fixture(autouse=True)
def _pinned_now(pin_clock):
    """Pin the time the range request and the account link read"""
    pin_clock(_NOW, range_import, account_link)


async def _import_range(client, headers, account_id, **body):
    """Ask for a date range import on the account"""
    return await client.post(f"/accounts/{account_id}/bank-link/range-import", json=body, headers=headers)


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


async def _queued() -> list[tuple]:
    """Return each queued job's kind and the links it syncs now as the user asked, read as the table owner"""
    async with TestSession() as session:
        rows = await session.execute(
            select(BankSyncJob.kind, BankSyncJob.requested_link_ids).where(BankSyncJob.status == BankSyncJobStatus.QUEUED)
        )
        return [(kind, set(requested)) for kind, requested in rows]


async def _stored_range(link: BankAccountLink) -> tuple:
    """Return the link's committed range columns and importing flag"""
    async with TestSession() as session:
        stored = await session.get_one(BankAccountLink, link.id)
        return (
            stored.range_first_day,
            stored.range_last_day,
            stored.range_next_day,
            stored.range_restores_dismissed,
            stored.importing,
        )


async def test_range_import_starts_the_range_and_queues_a_sync_that_asks_for_no_routine_sync(client):
    """Everyday synced five hours ago. Importing March reads as importing March, with dismissed items left alone unless asked

    The sync queued asks for no link by name, so its first request isn't spent re-reading days
    Everyday already has, and the user's open pages are told
    """
    headers, account_id, _, link = await _link_everyday(client, **_SYNCED)
    changed_before = await _changed_at(client, headers)

    response = await _import_range(client, headers, account_id, **_MARCH)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["range_import"] == {"first_day": "2026-03-01", "last_day": "2026-03-31", "next_day": "2026-03-01", "restores_dismissed": False}
    assert body["sync"]["state"] == "importing"
    assert body["import"] == {
        "kind": "initial",
        "state": "running",
        "requested_start": "2026-03-01",
        "windows_total": 1,
        "windows_done": 0,
        "items_found": 0,
        "earliest_returned_date": None,
    }
    assert await _stored_range(link) == (date(2026, 3, 1), date(2026, 3, 31), date(2026, 3, 1), False, True)
    assert await _queued() == [("manual", set())]
    assert await _changed_at(client, headers) != changed_before


async def test_range_import_brings_dismissed_items_back_only_when_asked(client):
    """Ticking Bring back dismissed items stores the choice with the range"""
    headers, account_id, _, link = await _link_everyday(client, **_SYNCED)

    response = await _import_range(client, headers, account_id, **_MARCH, restores_dismissed=True)

    assert response.status_code == 200, response.text
    assert response.json()["range_import"]["restores_dismissed"] is True
    assert await _stored_range(link) == (date(2026, 3, 1), date(2026, 3, 31), date(2026, 3, 1), True, True)


async def test_range_import_leaves_a_queued_import_starting_when_it_was_due(client):
    """An import queued for 2 minutes on, waiting for the user's other accounts, keeps its start and takes the range in"""
    headers, account_id, connection, _ = await _link_everyday(client, **_SYNCED)
    later = datetime.now(UTC) + timedelta(minutes=2)
    await _seed_job(connection, BankSyncJobKind.INITIAL, run_after=later)

    response = await _import_range(client, headers, account_id, **_MARCH)

    assert response.status_code == 200, response.text
    async with TestSession() as session:
        jobs = (
            await session.execute(select(BankSyncJob.kind, BankSyncJob.run_after).where(BankSyncJob.status == BankSyncJobStatus.QUEUED))
        ).all()
    assert [tuple(job) for job in jobs] == [(BankSyncJobKind.INITIAL, later)]


@pytest.mark.parametrize(
    ("values", "connection_values", "running", "detail"),
    [
        pytest.param(_SYNCED | _RUNNING | {"importing": True}, {}, False, "A date range import is already in progress", id="range-running"),
        pytest.param({}, {}, False, "The import is still in progress", id="importing"),
        pytest.param(_SYNCED, {}, True, "A sync is already in progress", id="syncing"),
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
async def test_range_import_is_refused_while_something_holds_the_account_back(client, values, connection_values, running, detail):
    """Each refusal gives the reason the button shows, stores no new range and queues nothing"""
    headers, account_id, connection, link = await _link_everyday(client, **values)
    if connection_values:
        await _update_connection(connection, **connection_values)
    if running:
        await _commit_running_job(connection, link, now=_NOW)
    before = await _stored_range(link)

    response = await _import_range(client, headers, account_id, **_MARCH)

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == detail
    assert await _stored_range(link) == before
    assert await _queued() == []


async def test_range_import_with_the_connections_requests_spent_says_when_one_frees(client):
    """All 20 of the connection's requests went out in the last day, so the range waits for the oldest to leave it"""
    headers, account_id, connection, link = await _link_everyday(client, **_SYNCED)
    await _spend_requests(connection, 20, _NOW - timedelta(hours=21))

    response = await _import_range(client, headers, account_id, **_MARCH)

    assert response.status_code == 429, response.text
    assert response.json()["detail"] == "This connection has used its 20 Fake Bank requests in the last 24 hours. More are available in 3 hours"
    assert await _stored_range(link) == (None, None, None, None, False)
    assert await _queued() == []


@pytest.mark.parametrize(
    ("first_day", "last_day", "detail"),
    [
        ("2025-09-30", "2026-03-31", "Please choose a start date from Oct 1, 2025 to Oct 5, 2026"),
        ("2026-03-01", "2026-10-06", "Please choose an end date from Oct 1, 2025 to Oct 5, 2026"),
        ("2026-03-31", "2026-03-01", "Please choose a start date on or before the end date"),
    ],
    ids=["start-before-the-providers-limit", "end-after-today", "start-after-end"],
)
async def test_range_import_with_days_outside_what_the_provider_reaches_or_crossed_is_refused(client, first_day, last_day, detail):
    """Fake Bank reaches back to 1 October 2025, and nothing after today, 5 October, can be fetched"""
    headers, account_id, _, link = await _link_everyday(client, **_SYNCED)

    response = await _import_range(client, headers, account_id, first_day=first_day, last_day=last_day)

    assert response.status_code == 422, response.text
    assert response.json()["detail"] == detail
    assert await _stored_range(link) == (None, None, None, None, False)
    assert await _queued() == []


async def test_unlinking_ends_the_range_and_forgets_how_the_last_one_ended(client):
    """Everyday's range runs and its last one was refused. Unlinking clears both, so nothing fetches into the account again"""
    headers, account_id, _, link = await _link_everyday(client, **_SYNCED, **_RUNNING, range_outcome="The date range import stopped")

    unlinked = await client.delete(f"/accounts/{account_id}/bank-link", headers=headers)

    assert unlinked.status_code == 200, unlinked.text
    async with TestSession() as session:
        stored = await session.get_one(BankAccountLink, link.id)
    assert (stored.state, stored.range_first_day, stored.range_next_day, stored.range_outcome) == (BankLinkState.UNLINKED, None, None, None)


async def test_range_import_on_an_account_that_isnt_linked_is_not_found(client):
    """Everyday has no bank link, so there's nothing to import into"""
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")

    response = await _import_range(client, headers, account_id, **_MARCH)

    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "This account is not linked to a bank"


async def test_range_import_on_another_users_linked_account_reads_as_one_that_doesnt_exist(client):
    """Another user's linked account and an id no account has give the same answer, and nothing is stored or queued"""
    headers, _ = await _sign_up(client)
    theirs = await _commit_other_users_account()
    connection = await _commit_listed_connection(theirs.owner_id, discovered_at=_NOW)
    link = await _commit_link(theirs.id, connection, **_SYNCED)

    refused = await _import_range(client, headers, theirs.id, **_MARCH)
    missing = await _import_range(client, headers, uuid.uuid4(), **_MARCH)

    assert (refused.status_code, refused.json()["detail"]) == (404, "Account not found")
    assert (missing.status_code, missing.json()["detail"]) == (404, "Account not found")
    assert await _stored_range(link) == (None, None, None, None, False)
    assert await _queued() == []


async def test_range_import_on_a_group_account_is_refused_to_its_admin(client):
    """A group account isn't the user's own, so it can't be linked or imported into"""
    headers, _ = await _sign_up(client)
    account_id = await _new_group_account(client, headers)

    response = await _import_range(client, headers, account_id, **_MARCH)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "Accounts shared with a group can't be linked to a bank yet"
