"""Pausing an account's sync while too many new bank items wait for review

Syncing an account whose new items pile up unreviewed only grows the pile, so once a sync leaves 100
or more new items waiting for their first review, that account's link stops syncing until 50 or
fewer are left. The pause is kept on the link, so the account stays paused while the count comes
down through 99 to 51, and it covers that account alone: the connection's other accounts keep
syncing. Only new booked items awaiting review count. Corrections and removals are opened on
accepted transactions, pending items are kept apart, and an item the user decided no longer waits.
A sync stores everything its request brought back before the pause applies, so the count can pass
100.

An import, the first one after linking, relinking or choosing the bank account again, or the
catch-up after a reconnect, runs to today whatever the count, since stopping one part way would
leave a gap in the history. The thresholds apply once it ends.

A review decision that leaves 50 or fewer lifts the pause at once and queues the connection's sync,
so the account catches up from where it stopped rather than at the next daily sync
"""

import uuid
from collections.abc import Collection, Sequence
from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_connection import BankAccountLink, BankLinkState
from app.models.bank_sync_job import BankSyncJobKind
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition
from app.services.bank_sync.jobs import enqueue_bank_sync_job
from app.services.cache_state.updates import mark_user_cache_changed

# A sync that leaves this many new items waiting for review pauses the account
PAUSE_AT = 100

# A paused account resumes once this many or fewer are left
RESUME_AT = 50


def is_paused_for_review(link: BankAccountLink) -> bool:
    """Return whether the link's sync is held for review: paused, with no import running, since an import always runs to today"""
    return link.paused and not link.importing


async def apply_review_pauses(db: AsyncSession, links: Sequence[BankAccountLink], *, today: date) -> bool:
    """End the imports a sync just brought through today, then pause or resume each link no import is running on

    The caller locked the links and stored what the sync brought back for them, so each count takes
    in the whole batch, and commits

    Args:
        db: The links' owner's session
        links: The links the sync brought back whole
        today: Today in the profile timezone

    Returns:
        Whether a link changed, so the caller tells the owner's open pages
    """
    changed = False
    for link in links:
        if link.importing and link.checkpoint >= today:
            link.importing = False
            changed = True

    settled = [link for link in links if not link.importing]
    waiting = await _count_waiting_new(db, [link.account_id for link in settled])
    for link in settled:
        paused = _stays_paused(link.paused, waiting.get(link.account_id, 0))
        if paused != link.paused:
            link.paused = paused
            changed = True
    return changed


async def lift_review_pauses(db: AsyncSession, owner_id: uuid.UUID, account_ids: Collection[uuid.UUID]) -> None:
    """Lift the pause on each of these accounts once 50 or fewer new items wait, and queue its connection's sync at once

    A review action calls this after its write and before it marks the owner's cache row, in the
    same transaction, so the count takes in its decisions. A link that isn't active, such as one
    waiting in Choose bank account, only loses the pause, since it has nothing to sync. The owner's
    open pages are told of any pause lifted.

    The links are locked in id order, so a sync writing one finishes first and is counted. A review
    action has to lock the accounts' links the same way before its bank transaction rows, as
    every writer does, or it can deadlock with a sync storing those rows. Locking them here again
    then costs nothing

    Args:
        db: The owner's session
        owner_id: The user who made the decisions, who owns the accounts
        account_ids: The accounts whose items the review action decided
    """
    # Every link, since one a sync is pausing doesn't read as paused until the lock is granted
    links = await db.scalars(
        select(BankAccountLink)
        .where(BankAccountLink.account_id.in_(account_ids))
        .order_by(BankAccountLink.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    paused = [link for link in links if link.paused]
    waiting = await _count_waiting_new(db, [link.account_id for link in paused])
    lifted = [link for link in paused if not _stays_paused(True, waiting.get(link.account_id, 0))]
    if not lifted:
        return

    now = datetime.now(UTC)
    due: set[uuid.UUID] = set()
    for link in lifted:
        link.paused = False
        if link.state == BankLinkState.ACTIVE:
            link.next_attempt_at = now
            due.add(link.connection_id)
    for connection_id in sorted(due):
        await enqueue_bank_sync_job(db, owner_id=owner_id, connection_id=connection_id, kind=BankSyncJobKind.SCHEDULED, run_after=now)
    await mark_user_cache_changed(db, owner_id)


def _stays_paused(paused: bool, waiting: int) -> bool:
    """Return whether a link is paused with this many new items waiting: from 100, and once paused, until 50 or fewer are left"""
    return waiting >= PAUSE_AT or (paused and waiting > RESUME_AT)


async def _count_waiting_new(db: AsyncSession, account_ids: Collection[uuid.UUID]) -> dict[uuid.UUID, int]:
    """Return how many new booked items wait for their first review in each account, leaving out accounts with none

    A correction or removal is opened on a bank transaction already accepted, so it never counts
    """
    rows = await db.execute(
        select(BankTransaction.account_id, func.count())
        .where(
            BankTransaction.account_id.in_(account_ids),
            BankTransaction.disposition == BankTransactionDisposition.AWAITING_REVIEW,
        )
        .group_by(BankTransaction.account_id)
    )
    return {account_id: count for account_id, count in rows.all()}
