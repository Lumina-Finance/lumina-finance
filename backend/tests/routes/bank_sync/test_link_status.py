"""A linked account's sync status: the one state every surface shows, and the facts its Sync details word

The first state that applies wins, so each ordering case gives a link two states and expects the one
ranked higher. Read through the account's bank link, which the list of links shares, apart from an
offer the account's read finds nothing to show
"""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import update

from app.models.bank_connection import BankLinkState, BankProviderRequest, OpeningAdjustmentState
from app.models.bank_sync_job import BankSyncJob, BankSyncJobKind, BankSyncJobStatus
from app.services.bank_sync import account_link
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _commit_bank_balance,
    _commit_link,
    _commit_listed_connection,
    _commit_running_job,
    _commit_waiting_items,
    _new_account,
    _seed_job,
    _sign_up,
    _update_connection,
)

# Noon on October 5 in Toronto, the zone _sign_up stores
_NOW = datetime(2026, 10, 5, 12, 0, tzinfo=ZoneInfo("America/Toronto"))

# A link whose import is long over, which last synced three hours ago and next syncs in 21 hours
_SYNCED = {
    "importing": False,
    "last_success_at": _NOW - timedelta(hours=3),
    "last_attempt_at": _NOW - timedelta(hours=3),
    "next_attempt_at": _NOW + timedelta(hours=21),
}

# An attempt that failed ten minutes ago, waiting for the first retry of its series
_FAILED_REASON = "Fake Bank Online couldn't be reached"
_RETRY = {
    "retry_count": 1,
    "last_attempt_at": _NOW - timedelta(minutes=10),
    "last_failure_reason": _FAILED_REASON,
    "next_attempt_at": _NOW + timedelta(minutes=20),
}

_SPENT_UNTIL = _NOW + timedelta(hours=2)


@pytest.fixture(autouse=True)
def _pinned_now(pin_clock):
    """Pin the time the account link route reads"""
    pin_clock(_NOW, account_link)


async def _read_sync(client, headers, account_id) -> dict:
    """Return the account's sync status, read through its bank link"""
    response = await client.get(f"/accounts/{account_id}/bank-link", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["link"]["sync"]


@pytest.mark.parametrize(
    ("link_values", "connection_values", "waiting", "syncing", "state", "warned"),
    [
        pytest.param(
            {"signin_needed_since": _NOW},
            {"credential_rejected_at": _NOW},
            0,
            False,
            "reconnect_needed",
            False,
            id="reconnect-over-bank-sign-in",
        ),
        # The running job makes the import fetch, so the stopped state has to outrank a running import
        pytest.param({}, {"credential_rejected_at": _NOW}, 0, True, "reconnect_needed", False, id="reconnect-over-import"),
        pytest.param({"signin_needed_since": _NOW}, {}, 0, True, "bank_signin_needed", False, id="bank-sign-in-over-import"),
        pytest.param(
            {"state": BankLinkState.CHOOSE_ACCOUNT, "importing": False, "paused": True},
            {},
            0,
            False,
            "choose_account",
            False,
            id="choose-bank-account-over-pause",
        ),
        pytest.param(_SYNCED | {"paused": True}, {}, 0, True, "paused", False, id="pause-over-sync"),
        pytest.param(
            _SYNCED | {"opening_adjustment_state": OpeningAdjustmentState.OFFERED},
            {},
            0,
            True,
            "syncing",
            False,
            id="sync-over-opening-balance",
        ),
        pytest.param(
            _SYNCED | {"opening_adjustment_state": OpeningAdjustmentState.OFFERED},
            {},
            80,
            False,
            "opening_balance",
            True,
            id="opening-balance-over-review-warning",
        ),
        pytest.param(_SYNCED | _RETRY, {}, 80, False, "review_warning", True, id="review-warning-over-retry"),
        pytest.param(_SYNCED | _RETRY, {}, 0, False, "retrying", False, id="retry-over-synced"),
        pytest.param(_RETRY, {}, 0, False, "retrying", False, id="import-held-by-a-retry-shows-the-retry"),
    ],
)
async def test_sync_status_shows_the_first_state_that_applies(client, link_values, connection_values, waiting, syncing, state, warned):
    """A link meeting two states shows the one ranked higher, and still says when a sync runs or the review warning applies under it

    Sync now reads that to refuse a second sync, which would spend another request, and the warning
    notice reads the flag whatever state shows
    """
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    link = await _commit_link(account_id, connection, **link_values)
    if connection_values:
        await _update_connection(connection, **connection_values)
    await _commit_waiting_items(link, waiting)
    if syncing:
        await _commit_running_job(connection, link, now=_NOW)

    # Fake Bank's balance sits 250.00 above the empty ledger, so an offered link shows its offer
    await _commit_bank_balance(connection, balance=25000, balance_at=_NOW - timedelta(hours=3))

    sync = await _read_sync(client, headers, account_id)

    assert (sync["state"], sync["sync_running"], sync["review_warning"]) == (state, syncing, warned)


async def test_sync_status_reads_as_syncing_only_while_a_running_job_covers_the_link(client):
    """A queued job doesn't sync yet, and a running one syncs only the links it covers"""
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    savings_id = await _new_account(client, headers, "Savings")
    connection = await _commit_listed_connection(user_id, "ACT-1", "ACT-2", discovered_at=_NOW)
    everyday = await _commit_link(everyday_id, connection, "ACT-1", **_SYNCED)
    await _commit_link(savings_id, connection, "ACT-2", **_SYNCED)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED, covered_link_ids=[everyday.id])

    queued = await _read_sync(client, headers, everyday_id)
    await _commit_running_job(connection, everyday, now=_NOW)

    assert queued["state"] == "synced"
    assert (await _read_sync(client, headers, everyday_id))["state"] == "syncing"
    assert (await _read_sync(client, headers, savings_id))["state"] == "synced"


async def test_sync_status_reads_a_job_whose_lease_ran_out_as_not_syncing(client):
    """A worker that stopped mid-job leaves it running until another claims it, so Everyday doesn't stick on Syncing"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    everyday = await _commit_link(account_id, connection, **_SYNCED)
    await _commit_running_job(connection, everyday, now=_NOW, lease_left=-timedelta(minutes=1))

    assert (await _read_sync(client, headers, account_id))["state"] == "synced"


async def test_sync_status_reads_a_sync_asked_for_now_as_requested_until_a_worker_starts_it_then_as_syncing(client):
    """Sync now on Everyday queues a job that syncs nothing yet, so Everyday keeps its state, and reads as Syncing once a worker runs it

    The running job is still listing the bank accounts, so it covers no link yet, though it syncs
    Everyday from the start. Savings, on the same connection, wasn't asked for
    """
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    savings_id = await _new_account(client, headers, "Savings")
    connection = await _commit_listed_connection(user_id, "ACT-1", "ACT-2", discovered_at=_NOW)
    everyday = await _commit_link(everyday_id, connection, "ACT-1", **_SYNCED)
    await _commit_link(savings_id, connection, "ACT-2", **_SYNCED)
    job = await _seed_job(connection, BankSyncJobKind.MANUAL, requested_link_ids=[everyday.id])

    queued = await _read_sync(client, headers, everyday_id)
    async with TestSession() as session:
        await session.execute(
            update(BankSyncJob)
            .where(BankSyncJob.id == job.id)
            .values(status=BankSyncJobStatus.RUNNING, lease_expires_at=_NOW + timedelta(minutes=10))
        )
        await session.commit()
    running = await _read_sync(client, headers, everyday_id)

    assert (queued["state"], queued["sync_running"], queued["sync_requested"]) == ("synced", False, True)
    assert (running["state"], running["sync_running"], running["sync_requested"]) == ("syncing", True, False)
    savings = await _read_sync(client, headers, savings_id)
    assert (savings["state"], savings["sync_running"], savings["sync_requested"]) == ("synced", False, False)


async def test_sync_status_reads_a_sync_asked_for_now_as_requested_only_while_it_is_due(client):
    """The worker put Everyday's Sync now back to wait two hours for the request budget, so Everyday reads as not asked for until it's due

    Read as requested all that time, the button would show the sync starting rather than the budget
    holding it back, and the page would keep checking every 2 seconds
    """
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    everyday = await _commit_link(account_id, connection, **_SYNCED)
    job = await _seed_job(
        connection, BankSyncJobKind.MANUAL, requested_link_ids=[everyday.id], run_after=datetime.now(UTC) + timedelta(hours=2)
    )

    waiting = await _read_sync(client, headers, account_id)
    async with TestSession() as session:
        await session.execute(update(BankSyncJob).where(BankSyncJob.id == job.id).values(run_after=datetime.now(UTC) - timedelta(seconds=1)))
        await session.commit()
    due = await _read_sync(client, headers, account_id)

    assert (waiting["state"], waiting["sync_requested"]) == ("synced", False)
    assert (due["state"], due["sync_requested"]) == ("synced", True)


async def test_sync_status_of_a_synced_link_says_when_it_next_syncs(client):
    """Everyday synced three hours ago and next syncs in 21 hours, and its successful attempt is no failure"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    await _commit_link(account_id, connection, **_SYNCED)

    sync = await _read_sync(client, headers, account_id)

    assert datetime.fromisoformat(sync.pop("last_success_at")) == _NOW - timedelta(hours=3)
    assert datetime.fromisoformat(sync.pop("next_attempt_at")) == _NOW + timedelta(hours=21)
    assert sync == {
        "state": "synced",
        "last_failure": None,
        "waiting_on_budget": False,
        "held_by_provider": False,
        "sync_running": False,
        "sync_requested": False,
        "waiting_new_count": 0,
        "paused": False,
        "review_warning": False,
    }


async def test_sync_status_of_a_failed_attempt_keeps_the_last_success(client):
    """A failed sync retries at its next attempt, gives its reason, and still says when the account last synced"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    await _commit_link(account_id, connection, **_SYNCED | _RETRY)

    sync = await _read_sync(client, headers, account_id)

    assert sync["state"] == "retrying"
    assert datetime.fromisoformat(sync["last_success_at"]) == _NOW - timedelta(hours=3)
    assert datetime.fromisoformat(sync["last_failure"].pop("at")) == _NOW - timedelta(minutes=10)
    assert sync["last_failure"] == {"reason": _FAILED_REASON}
    assert datetime.fromisoformat(sync["next_attempt_at"]) == _NOW + timedelta(minutes=20)


@pytest.mark.parametrize(
    ("next_sync", "waiting_on_budget"),
    [
        pytest.param(_SPENT_UNTIL - timedelta(minutes=1), True, id="due-before-a-request-frees"),
        pytest.param(_SPENT_UNTIL, False, id="due-as-a-request-frees"),
    ],
)
async def test_sync_status_says_whether_the_next_sync_waits_on_the_request_budget(client, next_sync, waiting_on_budget):
    """A sync due before the spent budget frees a request waits for one, and one due once it frees doesn't"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    await _commit_link(account_id, connection, **_SYNCED | {"next_attempt_at": next_sync})
    await _update_connection(connection, request_budget_spent_until=_SPENT_UNTIL)

    sync = await _read_sync(client, headers, account_id)

    assert (sync["state"], sync["waiting_on_budget"]) == ("synced", waiting_on_budget)
    assert datetime.fromisoformat(sync["next_attempt_at"]) == next_sync


@pytest.mark.parametrize(
    ("sent", "held_by_provider"),
    [
        pytest.param(20, False, id="own-limit"),
        pytest.param(4, True, id="simplefin-limit"),
    ],
)
async def test_sync_status_says_whose_request_limit_holds_the_next_sync(client, sent, held_by_provider):
    """Fake Bank saying its quota is spent holds the next sync on its own limit after 4 of 20 requests, and on the connection's after 20"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    await _commit_link(account_id, connection, **_SYNCED | {"next_attempt_at": _SPENT_UNTIL - timedelta(hours=1)})

    # The oldest request leaves the 24 hours just as Fake Bank's word that its quota is spent runs out
    oldest = _SPENT_UNTIL - timedelta(hours=24)
    async with TestSession() as session:
        session.add_all(
            BankProviderRequest(owner_id=user_id, connection_id=connection.id, purpose="sync", requested_at=oldest + timedelta(minutes=index))
            for index in range(sent)
        )
        await session.commit()
    await _update_connection(connection, request_budget_spent_until=_SPENT_UNTIL)

    sync = await _read_sync(client, headers, account_id)

    assert (sync["waiting_on_budget"], sync["held_by_provider"]) == (True, held_by_provider)


async def test_sync_status_of_an_import_waiting_on_the_request_budget_says_when_its_next_part_can_run(client):
    """An import with no request left fetches its next part once the budget frees one"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    await _commit_link(account_id, connection)
    await _update_connection(connection, request_budget_spent_until=_SPENT_UNTIL)

    sync = await _read_sync(client, headers, account_id)

    assert sync["state"] == "import_waiting_on_budget"
    assert datetime.fromisoformat(sync["next_attempt_at"]) == _SPENT_UNTIL


async def test_sync_status_of_a_paused_link_counts_the_new_items_holding_it(client):
    """The pause carries how many new items wait, for the label and the notice"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    link = await _commit_link(account_id, connection, **_SYNCED | {"paused": True})
    await _commit_waiting_items(link, 105)

    sync = await _read_sync(client, headers, account_id)

    assert (sync["state"], sync["waiting_new_count"], sync["paused"], sync["review_warning"]) == ("paused", 105, True, False)
