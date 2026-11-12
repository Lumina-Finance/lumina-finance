"""Lifting an account's review pause once a review decision leaves 50 or fewer new items waiting, and reading the backlog it shows

A paused account never syncs, so a pause that stays on after the user has brought the backlog down
leaves it stale with nothing left to review, and one lifted at 51 lets the pile grow straight back.
A sync queued for an account waiting to have its bank account chosen again has nothing to fetch, and
a lift that counts before a sync pausing the link has finished leaves on a pause the user's decisions
already cleared. A backlog shown wrong tells the user an account is paused while it syncs, hides a
pause or the warning before one, or promises that a sync only the user can restart resumes or pauses
on the count
"""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text, update

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState
from app.services.bank_sync.review_pause import ReviewBacklog, lift_review_pauses, lock_account_links, read_review_backlogs
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _build_account,
    _build_bank_link,
    _build_bank_transaction,
    _commit_waiting_items,
    _dismiss_items,
    _owner_session,
    _queued_jobs,
)
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.services.bank_sync.stand_ins import FROZEN_NOW

# The next sync a paused link had set. A lift brings it forward to now
_TOMORROW = FROZEN_NOW + timedelta(days=1)

# Long enough for any step here to finish, so a missing lock fails the test rather than hanging it
_WAIT_SECONDS = 10

pytestmark = pytest.mark.usefixtures("frozen_now")


async def _paused_link(connection: BankConnection, **values) -> BankAccountLink:
    """Commit Everyday's link, paused for review with its import long ended and its next sync set for tomorrow, its other fields as given"""
    account = _build_account(connection.owner_id)
    link = _build_bank_link(account, connection, **{"paused": True, "importing": False, "next_attempt_at": _TOMORROW} | values)
    async with TestSession() as session:
        session.add(account)
        await session.flush()
        session.add(link)
        await session.commit()
    return link


async def _lift(link: BankAccountLink) -> None:
    """Lock the account's links and lift its pause with them, as a review action does after its write, as the owner"""
    async with _owner_session(link.owner_id) as session:
        await lift_review_pauses(session, link.owner_id, await lock_account_links(session, [link.account_id]))
        await session.commit()


async def _link_state(link: BankAccountLink) -> tuple[bool, datetime | None]:
    """Return whether the link is paused for review, and when it is next due, as committed"""
    async with TestSession() as session:
        return tuple(
            (await session.execute(select(BankAccountLink.paused, BankAccountLink.next_attempt_at).where(BankAccountLink.id == link.id))).one()
        )


@pytest.mark.parametrize(
    ("waiting", "paused", "next_attempt_at", "queued"),
    [(51, True, _TOMORROW, []), (50, False, FROZEN_NOW, [("scheduled", timedelta(0), False)])],
    ids=["51_waiting", "50_waiting"],
)
async def test_lift_review_pauses_lifts_at_50_new_items_waiting_and_queues_the_connections_sync_at_once(
    connections, waiting, paused, next_attempt_at, queued
):
    """A review decision leaves paused Everyday with 51 new items waiting and keeps the pause, or with 50 and lifts it

    Lifted, Everyday is due now rather than tomorrow and its connection's sync is queued to run now
    """
    link = await _paused_link(connections[0])
    await _commit_waiting_items(link, waiting)

    await _lift(link)

    assert await _link_state(link) == (paused, next_attempt_at)
    assert await _queued_jobs() == queued


async def test_lift_review_pauses_queues_nothing_for_an_account_that_isnt_paused(connections):
    """A review decision in Everyday, never paused, with 10 new items waiting, leaves its next sync where it was"""
    link = await _paused_link(connections[0], paused=False)
    await _commit_waiting_items(link, 10)

    await _lift(link)

    assert await _link_state(link) == (False, _TOMORROW)
    assert await _queued_jobs() == []


async def test_lift_review_pauses_leaves_an_import_running_on_its_own_schedule(connections):
    """Everyday keeps its pause through a reconnect import after its last attempt failed, so it retries in 30 minutes

    A review decision leaving 50 new items waiting lifts the pause. The pause never held the import back,
    so the retry stays where it was rather than going out early, and no sync is queued
    """
    retry_at = FROZEN_NOW + timedelta(minutes=30)
    link = await _paused_link(connections[0], importing=True, retry_count=1, next_attempt_at=retry_at)
    await _commit_waiting_items(link, 50)

    await _lift(link)

    assert await _link_state(link) == (False, retry_at)
    assert await _queued_jobs() == []


async def test_lift_review_pauses_queues_no_sync_for_an_account_waiting_for_its_bank_account(connections):
    """Everyday waits in Choose bank account, paused with 20 new items waiting: a review decision lifts the pause and queues nothing to fetch"""
    link = await _paused_link(connections[0], state=BankLinkState.CHOOSE_ACCOUNT)
    await _commit_waiting_items(link, 20)

    await _lift(link)

    assert await _link_state(link) == (False, _TOMORROW)
    assert await _queued_jobs() == []


async def test_lift_review_pauses_counts_once_a_sync_pausing_the_link_has_committed(connections):
    """A sync brings Everyday from 96 new items waiting to 100 and pauses it, while the user dismisses 60 of the 96

    The review's lock on Everyday's links waits for the sync to commit, and its lift then counts 40
    with both writes taken in, so the pause the sync set lifts
    """
    link = await _paused_link(connections[0], paused=False)
    item_ids = await _commit_waiting_items(link, 96)

    async def review() -> None:
        async with _owner_session(link.owner_id) as session:
            links = await lock_account_links(session, [link.account_id])
            await _dismiss_items(session, item_ids[:60])
            await lift_review_pauses(session, link.owner_id, links)
            await session.commit()

    async with asyncio.timeout(_WAIT_SECONDS), TestSession() as syncing:
        blocker_pid = await syncing.scalar(text("SELECT pg_backend_pid()"))
        await syncing.execute(select(BankAccountLink.id).where(BankAccountLink.id == link.id).with_for_update())
        account = await syncing.get_one(Account, link.account_id)
        syncing.add_all(
            _build_bank_transaction(account, f"TRN-new-{number}", external_account_id=link.external_account_id) for number in range(4)
        )
        await syncing.execute(update(BankAccountLink).where(BankAccountLink.id == link.id).values(paused=True))
        await syncing.flush()
        reviewing = asyncio.create_task(review())
        await _wait_until_waiting_on(blocker_pid, reviewing)
        await syncing.commit()
        await reviewing

    assert await _link_state(link) == (False, FROZEN_NOW)
    assert await _queued_jobs() == [("scheduled", timedelta(0), False)]


async def _backlog(link: BankAccountLink) -> ReviewBacklog:
    """Return the backlog the link's account shows its owner"""
    async with _owner_session(link.owner_id) as session:
        return (await read_review_backlogs(session, [link.account_id]))[link.account_id]


@pytest.mark.parametrize(
    ("values", "waiting", "backlog"),
    [
        ({"paused": False}, 79, ReviewBacklog(waiting_new=79, paused=False, warning=False)),
        ({"paused": False}, 80, ReviewBacklog(waiting_new=80, paused=False, warning=True)),
        ({}, 105, ReviewBacklog(waiting_new=105, paused=True, warning=False)),
        ({"importing": True}, 120, ReviewBacklog(waiting_new=120, paused=False, warning=False)),
        (
            {"state": BankLinkState.UNLINKED, "unlinked_at": datetime(2026, 9, 1, tzinfo=UTC)},
            105,
            ReviewBacklog(waiting_new=105, paused=False, warning=False),
        ),
    ],
    ids=["79_waiting", "80_waiting", "paused_with_105", "importing_with_120_and_a_pause_kept", "unlinked_while_paused"],
)
async def test_read_review_backlogs_shows_the_pause_from_100_and_the_warning_from_80(connections, values, waiting, backlog):
    """Everyday warns from 80 new items waiting, and shows the pause once paused with 105

    An import shows instead of either, though the link keeps a pause for when it ends, and an account
    no longer linked shows neither
    """
    link = await _paused_link(connections[0], **values)
    await _commit_waiting_items(link, waiting)

    assert await _backlog(link) == backlog


@pytest.mark.parametrize(
    ("link_values", "connection_values"),
    [
        ({}, {"credential_rejected_at": FROZEN_NOW}),
        ({"signin_needed_since": FROZEN_NOW}, {}),
        ({"state": BankLinkState.CHOOSE_ACCOUNT}, {}),
    ],
    ids=["reconnect_needed", "bank_sign_in_needed", "choose_bank_account"],
)
@pytest.mark.parametrize(("paused", "waiting"), [(True, 105), (False, 85)], ids=["paused_with_105", "85_waiting"])
async def test_read_review_backlogs_shows_neither_the_pause_nor_the_warning_while_only_the_user_can_restart_the_sync(
    connections, link_values, connection_values, paused, waiting
):
    """Everyday's sync stays stopped until the user acts, whatever the count, so its backlog says neither that it resumes nor that it pauses"""
    if connection_values:
        async with TestSession() as session:
            await session.execute(update(BankConnection).where(BankConnection.id == connections[0].id).values(**connection_values))
            await session.commit()
    link = await _paused_link(connections[0], paused=paused, **link_values)
    await _commit_waiting_items(link, waiting)

    assert await _backlog(link) == ReviewBacklog(waiting_new=waiting, paused=False, warning=False)
