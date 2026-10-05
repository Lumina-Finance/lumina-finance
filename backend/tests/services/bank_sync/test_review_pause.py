"""Lifting an account's review pause once a review decision leaves 50 or fewer new items waiting

A paused account never syncs, so a pause that stays on after the user has brought the backlog down
leaves it stale with nothing left to review, and one lifted at 51 lets the pile grow straight back.
A sync queued for an account waiting to have its bank account chosen again has nothing to fetch, and
a lift that counts before a sync pausing the link has finished leaves on a pause the user's decisions
already cleared
"""

import asyncio
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select, text, update

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState
from app.models.bank_sync_job import BankSyncJob
from app.models.cache_state import UserCacheState
from app.services.bank_sync.review_pause import lift_review_pauses
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _build_account,
    _build_bank_link,
    _build_bank_transaction,
    _commit_waiting_items,
    _dismiss_items,
    _owner_session,
)
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.services.bank_sync.stand_ins import FROZEN_NOW

# The next sync a paused link had set, which a lift brings forward to now
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
    """Lift the account's pause as a review action does after its write, as the owner"""
    async with _owner_session(link.owner_id) as session:
        await lift_review_pauses(session, link.owner_id, [link.account_id])
        await session.commit()


async def _link_state(link: BankAccountLink) -> tuple[bool, datetime | None]:
    """Return whether the link is paused for review, and when it is next due, as committed"""
    async with TestSession() as session:
        return tuple(
            (await session.execute(select(BankAccountLink.paused, BankAccountLink.next_attempt_at).where(BankAccountLink.id == link.id))).one()
        )


async def _queued_jobs() -> list[tuple]:
    """Return every job's kind, status and the time it may run from"""
    async with TestSession() as session:
        return [tuple(row) for row in await session.execute(select(BankSyncJob.kind, BankSyncJob.status, BankSyncJob.run_after))]


async def _told_at(link: BankAccountLink) -> datetime | None:
    """Return when the owner's open pages were last told their data changed, or None when they never were"""
    async with TestSession() as session:
        return await session.scalar(select(UserCacheState.changed_at).where(UserCacheState.user_id == link.owner_id))


@pytest.mark.parametrize(
    ("waiting", "paused", "next_attempt_at", "queued"),
    [(51, True, _TOMORROW, []), (50, False, FROZEN_NOW, [("scheduled", "queued", FROZEN_NOW)])],
    ids=["51_waiting", "50_waiting"],
)
async def test_lift_review_pauses_lifts_at_50_new_items_waiting_and_queues_the_connections_sync_at_once(
    connections, waiting, paused, next_attempt_at, queued
):
    """A review decision leaves paused Everyday with 51 new items waiting, which keeps the pause, or 50, which lifts it

    Lifted, Everyday is due now rather than tomorrow, its connection's sync is queued to run now, and
    the owner's open pages are told
    """
    link = await _paused_link(connections[0])
    await _commit_waiting_items(link, waiting)

    await _lift(link)

    assert await _link_state(link) == (paused, next_attempt_at)
    assert await _queued_jobs() == queued
    assert (await _told_at(link) is None) is paused


async def test_lift_review_pauses_queues_nothing_for_an_account_that_isnt_paused(connections):
    """A review decision in Everyday, never paused, with 10 new items waiting, leaves its next sync where it was and tells no page"""
    link = await _paused_link(connections[0], paused=False)
    await _commit_waiting_items(link, 10)

    await _lift(link)

    assert await _link_state(link) == (False, _TOMORROW)
    assert await _queued_jobs() == []
    assert await _told_at(link) is None


async def test_lift_review_pauses_queues_no_sync_for_an_account_waiting_for_its_bank_account(connections):
    """Everyday waits in Choose bank account, paused with 20 new items waiting: a review decision lifts the pause and queues nothing to fetch"""
    link = await _paused_link(connections[0], state=BankLinkState.CHOOSE_ACCOUNT)
    await _commit_waiting_items(link, 20)

    await _lift(link)

    assert await _link_state(link) == (False, _TOMORROW)
    assert await _queued_jobs() == []
    assert await _told_at(link) is not None


async def test_lift_review_pauses_counts_once_a_sync_pausing_the_link_has_committed(connections):
    """A sync brings Everyday from 96 new items waiting to 100 and pauses it, while the user dismisses 60 of the 96

    The review reads Everyday's link while the sync's pause is uncommitted, and its lift waits for
    the sync to commit, then counts 40 with both writes taken in, so the pause the sync set lifts
    """
    link = await _paused_link(connections[0], paused=False)
    item_ids = await _commit_waiting_items(link, 96)

    async def review() -> None:
        async with _owner_session(link.owner_id) as session:
            await session.get(BankAccountLink, link.id)
            await _dismiss_items(session, item_ids[:60])
            await lift_review_pauses(session, link.owner_id, [link.account_id])
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
    assert await _queued_jobs() == [("scheduled", "queued", FROZEN_NOW)]
