"""The daily schedule of a connection's syncs, and how the due scan queues them

A linked account syncs about once a day. A sync that brings it up to date through today sets its next
attempt 24 hours after the sync started plus a random 0 to 30 minutes, so syncs don't land on the
hour, as providers ask of their clients. A sync takes in every link due within the next 12 hours, so the links
of one connection converge on one daily request. A link whose bank needs a sign-in keeps the daily
schedule, since retrying can't fix it but the user may fix it at the provider at any time

A connection's next scheduled sync is the earliest time any of its links is due, among those active
and not held back by the review pause. Each is due when the window planner would take it in: at its
next attempt, or at once when none is set, such as while it imports, but not before the first day it
needs has started in the owner's timezone, so no sync is queued that would find no day to fetch for
it. A link waiting to retry is due at its retry, so the scan merges into the retry queued for it, or
queues one when the job that should have queued it stopped first.
A link waiting for its bank account to be chosen again syncs nothing, but keeps the connection's
bank accounts listed a day after the last listing was sent, so the link resumes by itself once the
provider lists its bank account as before. Every job works it out again as it ends, so a link that
changed outside a job, such as one unlinked, at worst brings forward a sync that then finds nothing
due and sends nothing

The due scan queues a scheduled sync for each connection due one, as its owner, to run once the
connection's request budget has a request free, merging into any sync already queued for it. A
connection whose bank accounts were never listed, which has no link to come due, is due a sync that
lists them once nothing is under way for it, so a claim stopped mid-listing isn't left empty. A
connection whose provider this server has turned off gets no scheduled sync, which could only fail,
and stays due, so the first scan after the provider is allowed again queues one. Nothing here
fetches or stores, so another policy, such as syncing inactive users less often, can change who is
due without touching ingestion
"""

import uuid
from datetime import datetime, timedelta
from secrets import randbelow

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState
from app.models.bank_sync_job import BankSyncJobKind
from app.models.user import User
from app.services.bank_sync.availability import LIVE_LINK, adapter_for, enabled_adapters
from app.services.bank_sync.jobs import enqueue_bank_sync_job
from app.services.bank_sync.provider_requests import read_request_budget
from app.services.bank_sync.windows import next_due_at
from app.services.cache_state.updates import mark_user_status_changed
from app.utils.dates import resolve_timezone

# A link up to date syncs again this long after its sync started
DAILY_SYNC_INTERVAL = timedelta(hours=24)

# Plus a random wait of up to this long, so syncs spread out rather than land on the hour, as
# providers ask of their clients
DAILY_SYNC_SPREAD = timedelta(minutes=30)


def next_daily_sync(started_at: datetime) -> datetime:
    """Return when the links a sync started at this moment next sync: 24 hours on, plus a random 0 to 30 minutes

    Counted in elapsed time, so a clock change between the two moves the next sync's local time by
    the hour the clocks moved

    Args:
        started_at: When the sync started, as an aware time
    """
    spread = timedelta(seconds=randbelow(int(DAILY_SYNC_SPREAD.total_seconds()) + 1))
    return started_at + DAILY_SYNC_INTERVAL + spread


async def schedule_next_sync(db: AsyncSession, connection: BankConnection, *, now: datetime) -> None:
    """Set the connection's next scheduled sync to the earliest time any of its links is due

    A link waiting for its bank account to be chosen again is due the connection's next daily
    listing, a day after the last one was sent, whether it worked or failed. A connection with no
    link due has no next scheduled sync, so the due scan passes it by until a link is due again
    through a sync of its own, such as the one a lifted review pause queues

    Args:
        db: The connection owner's session, which the caller commits
        connection: The connection, locked by the caller
        now: The current time, when a link with no next attempt set is due
    """
    # A provider no longer installed is sent nothing, so nothing is scheduled for it
    adapter = adapter_for(connection.provider)
    if adapter is None:
        connection.next_sync_at = None
        return
    links = (await db.scalars(select(BankAccountLink).where(BankAccountLink.connection_id == connection.id, LIVE_LINK))).all()
    timezone = resolve_timezone(await db.scalar(select(User.tz).where(User.id == connection.owner_id)))
    overlap_days = adapter.revisit_overlap_days
    due = [due_at for link in links if (due_at := next_due_at(link, now=now, timezone=timezone, overlap_days=overlap_days)) is not None]
    if any(link.state == BankLinkState.CHOOSE_ACCOUNT for link in links):
        listed = [at for at in (connection.discovered_at, connection.discovery_failed_at) if at is not None]
        due.append(next_daily_sync(max(listed, default=now)))
    connection.next_sync_at = min(due, default=None)


async def queue_scheduled_sync(db: AsyncSession, connection_id: uuid.UUID, *, now: datetime) -> None:
    """Queue a scheduled sync of a connection the due scan found due, for once a request is free

    A sync run while the budget is spent would only find no request and queue itself again, so it
    waits for the oldest request to leave the rolling day, or for the provider's word that its quota
    is spent to run out. A connection whose bank accounts were never listed has them listed first

    Args:
        db: The connection owner's session, which the caller commits
        connection_id: The connection the scan found due
        now: When the scan started
    """
    connection = await db.get(BankConnection, connection_id)

    # Disconnected since the scan listed it, or its provider is turned off or no longer installed on
    # this server, which every sync would fail on until it is back
    if connection is None or connection.provider not in enabled_adapters():
        return
    budget = await read_request_budget(db, connection, now=now)
    discover = connection.discovered_at is None
    await enqueue_bank_sync_job(
        db,
        owner_id=connection.owner_id,
        connection_id=connection.id,
        kind=BankSyncJobKind.SCHEDULED,
        discover=discover,
        run_after=budget.available_again_at,
    )

    # The connection now shows a listing pending, which the owner's open pages are told of
    if discover:
        await mark_user_status_changed(db, connection.owner_id)
