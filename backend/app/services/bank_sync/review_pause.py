"""Pausing an account's sync while too many new bank items wait for review

Syncing an account whose new items pile up unreviewed only grows the pile, so once a sync leaves 100
or more new items waiting for their first review, that account's link stops syncing until 50 or
fewer are left. The pause is kept on the link, so the account stays paused while the count comes
down through 99 to 51, and it covers that account alone: the connection's other accounts keep
syncing. Only new booked items awaiting review count. Corrections and removals are opened on
accepted transactions, pending items are kept apart, and an item the user decided or the provider
withdrew no longer waits.
A sync stores everything its request brought back before the pause applies, so the count can pass
100.

An import, the first one after linking, relinking or choosing the bank account again, or the
catch-up after a reconnect, runs to today whatever the count, since stopping one part way would
leave a gap in the history. The thresholds apply once it ends.

A review decision that leaves 50 or fewer lifts the pause at once and queues the connection's sync,
so the account catches up from where it stopped rather than at the next daily sync. From 80 waiting,
an account neither paused nor importing shows a warning that the pause is near. An account whose
sync only the user can restart shows neither the pause nor the warning, since the count no longer
decides when it syncs
"""

import uuid
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState
from app.models.bank_sync_job import BankSyncJobKind
from app.models.bank_transaction import BankTransaction
from app.services.bank_sync.action_needed import ActionNeededKind, read_actions_needed
from app.services.bank_sync.availability import LIVE_LINK
from app.services.bank_sync.jobs import enqueue_bank_sync_job
from app.services.bank_sync.review_state import AWAITING_REVIEW

# A sync that leaves this many new items waiting for review pauses the account
PAUSE_AT = 100

# A paused account resumes once this many or fewer are left
RESUME_AT = 50

# From this many waiting, an account not yet paused warns that the pause is near
WARN_AT = 80


@dataclass(frozen=True)
class ReviewBacklog:
    """An account's new items waiting for review, as its sync status and the review block show them"""

    waiting_new: int

    # The account's sync is held for review. This never shows while an import runs or while only the
    # user can restart the sync
    paused: bool

    # 80 or more wait on an account neither paused, importing nor stopped until the user acts
    warning: bool


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


async def lock_account_links(db: AsyncSession, account_ids: Collection[uuid.UUID]) -> list[BankAccountLink]:
    """Lock every link of these accounts in id order, after the connections of the live ones, before any bank transaction row

    A lifted pause queues a sync. The sync's job row takes a key share lock on its connection, and a
    disconnect, a reconnect and a sync's write each hold the connection for update before the links.
    So each live link's connection is locked first, for no key update as a discovery locks it. That lock
    waits for those writers and covers the job row's lock. Then the links, in the order every writer
    takes them, and every link, not only paused ones, since one a sync is pausing doesn't read as paused
    until its lock is granted

    Returns:
        The links, as the writes before this left them, since the caller hasn't loaded them before
    """
    live_connections = select(BankAccountLink.connection_id).where(BankAccountLink.account_id.in_(account_ids), LIVE_LINK)
    await db.execute(
        select(BankConnection.id).where(BankConnection.id.in_(live_connections)).order_by(BankConnection.id).with_for_update(key_share=True)
    )
    links = await db.scalars(
        select(BankAccountLink).where(BankAccountLink.account_id.in_(account_ids)).order_by(BankAccountLink.id).with_for_update()
    )
    return list(links)


async def lift_review_pauses(db: AsyncSession, owner_id: uuid.UUID, links: Sequence[BankAccountLink]) -> None:
    """Lift the pause on each of these links whose account has 50 or fewer new items waiting, and queue its connection's sync at once

    A review action calls this after its write, in the same transaction, so the count takes in its
    decisions, then marks the owner's cache row. That tells their open pages of any pause lifted.
    A link that isn't active, such as one waiting in Choose bank account, only loses the pause,
    since it has nothing to sync, and so does one an import is running on, since the pause never
    held it back and its next attempt, possibly a retry, stays where it was

    Args:
        db: The owner's session
        owner_id: The user who made the decisions and owns the accounts
        links: The links of the accounts the review action decided. It locked them with
            lock_account_links before its bank transaction rows, so a sync writing one finished first
            and is counted
    """
    paused = [link for link in links if link.paused]
    waiting = await _count_waiting_new(db, [link.account_id for link in paused])
    lifted = [link for link in paused if not _stays_paused(True, waiting.get(link.account_id, 0))]
    if not lifted:
        return

    now = datetime.now(UTC)
    due: set[uuid.UUID] = set()
    for link in lifted:
        held_back = is_paused_for_review(link)
        link.paused = False
        if held_back and link.state == BankLinkState.ACTIVE:
            link.next_attempt_at = now
            due.add(link.connection_id)
    for connection_id in sorted(due):
        await enqueue_bank_sync_job(db, owner_id=owner_id, connection_id=connection_id, kind=BankSyncJobKind.SCHEDULED)


async def read_review_backlogs(
    db: AsyncSession,
    account_ids: Collection[uuid.UUID],
    *,
    actions_needed: Mapping[uuid.UUID, ActionNeededKind] | None = None,
) -> dict[uuid.UUID, ReviewBacklog]:
    """Return each account's review backlog: how many new items wait, and whether it shows the pause or the warning

    While an import runs the account shows the import instead, so neither the pause it may keep for
    when the import ends nor the warning. An account no longer linked shows neither, since it doesn't
    sync, and nor does one whose sync only the user can restart, by reconnecting, signing in to the
    bank or choosing the bank account again, since it neither resumes nor pauses on the count

    Args:
        db: The owner's session
        account_ids: The accounts to read
        actions_needed: What read_actions_needed returned for these accounts, from a caller that has
            already read it, so it isn't read twice

    Returns:
        Each account's backlog, by account id
    """
    waiting = await _count_waiting_new(db, account_ids)
    links = await db.scalars(select(BankAccountLink).where(BankAccountLink.account_id.in_(account_ids), LIVE_LINK))
    stopped = await read_actions_needed(db, account_ids) if actions_needed is None else actions_needed
    counted = {link.account_id: link for link in links if link.state == BankLinkState.ACTIVE and link.account_id not in stopped}
    backlogs = {}
    for account_id in account_ids:
        count = waiting.get(account_id, 0)
        link = counted.get(account_id)
        paused = link is not None and is_paused_for_review(link)
        warning = link is not None and not link.importing and not paused and count >= WARN_AT
        backlogs[account_id] = ReviewBacklog(waiting_new=count, paused=paused, warning=warning)
    return backlogs


def _stays_paused(paused: bool, waiting: int) -> bool:
    """Return whether a link is paused with this many new items waiting: from 100, and once paused, until 50 or fewer are left"""
    return waiting >= PAUSE_AT or (paused and waiting > RESUME_AT)


async def _count_waiting_new(db: AsyncSession, account_ids: Collection[uuid.UUID]) -> dict[uuid.UUID, int]:
    """Return how many new booked items wait for their first review in each account, leaving out accounts with none

    A correction or removal is opened on a bank transaction already accepted, so it never counts
    """
    if not account_ids:
        return {}
    rows = await db.execute(
        select(BankTransaction.account_id, func.count())
        .where(BankTransaction.account_id.in_(account_ids), AWAITING_REVIEW)
        .group_by(BankTransaction.account_id)
    )
    return {account_id: count for account_id, count in rows.all()}
