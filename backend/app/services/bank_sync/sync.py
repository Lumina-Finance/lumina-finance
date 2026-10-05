"""Running one claimed bank sync job: a discovery when one is due, then one date window of a connection's links

A job lists the connection's bank accounts first when it was flagged to, or when the last listing
is over 20 hours old, so a daily sync shows a bank added at the provider and stops a linked bank
account that vanished before the window is planned. A window whose response may have been cut short is
fetched again in halves. Each request is counted against the connection's budget in a transaction
of its own before it is sent, and a job that finds the budget spent queues itself again for when a
request frees. A job holds no database connection while it waits on the provider, and everything it
writes goes through lock_job_for_finish, so a runner that lost its lease writes nothing and a link
that changed while the job fetched gets none of its results
"""

import logging
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, update

from app.database import async_session
from app.encryption import decrypt
from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState, ProviderRequestPurpose
from app.models.bank_sync_job import BankSyncJob, ProviderErrorKind
from app.models.user import User
from app.services.bank_sync.availability import ENABLED_ADAPTERS, PROVIDER_ADAPTERS
from app.services.bank_sync.discovery import apply_discovery
from app.services.bank_sync.jobs import ClaimedJob, JobNotHeld, enqueue_bank_sync_job, finish_job, lock_job_for_finish
from app.services.bank_sync.provider_requests import (
    RequestBudgetSpent,
    is_quota_spent,
    mark_request_budget_spent,
    read_request_budget,
    reserve_provider_request,
)
from app.services.bank_sync.providers.contract import FetchResult, ProviderAdapter, ProviderError
from app.services.bank_sync.windows import SyncWindow, find_due_links, first_missing_day, plan_window
from app.services.cache_state.updates import mark_user_cache_changed
from app.services.fx.currency_exponent_helpers import get_all_currency_exponents
from app.utils.dates import resolve_timezone

logger = logging.getLogger(__name__)

# A job lists the connection's bank accounts again once the last listing is older than this: a day
# less a margin, since a listing is timed from when its request was sent and a daily sync can start
# hours earlier than the day before, so each daily sync rediscovers, never twice within 20 hours
DISCOVERY_MAX_AGE = timedelta(hours=20)

# The link states a discovery moves between, so a connection with a link in one is kept listed
_DISCOVERED_LINK_STATES = (BankLinkState.ACTIVE, BankLinkState.CHOOSE_ACCOUNT)


async def run_sync_job(job: ClaimedJob) -> None:
    """Run a claimed job as its owner, and record it as finished or failed, queueing what comes next

    The worker has already set the owner's identity, so every session opened here works under
    row-level security as that user. A rejected credential can't work until the user reconnects, so
    nothing is sent with it

    Args:
        job: The job as claimed

    Raises:
        JobNotHeld: A later attempt holds the job, or the connection was deleted with its jobs, so
            whatever this attempt found was discarded
    """
    now = datetime.now(UTC)
    async with async_session() as db:
        connection = await db.get(BankConnection, job.connection_id)
        if connection is None:
            raise JobNotHeld(f"Bank sync job {job.id}'s connection was deleted")
        timezone = resolve_timezone(await db.scalar(select(User.tz).where(User.id == job.owner_id)))
        currency_exponents = await get_all_currency_exponents(db)

    adapter = ENABLED_ADAPTERS.get(connection.provider)
    if adapter is None:
        provider_name = PROVIDER_ADAPTERS[connection.provider].provider_name
        await _end_job(job, ProviderError(ProviderErrorKind.UNKNOWN, f"{provider_name} is turned off on this server"))
    elif connection.credential_rejected_at is not None:
        await _end_job(job)
    else:
        await _JobRun(job, connection, adapter, timezone=timezone, currency_exponents=currency_exponents, now=now).run()


@dataclass(frozen=True)
class _Fetched:
    """What fetching one window did"""

    # Whether the last part written moved a checkpoint, which ends where the window does
    moved: bool

    # The links a part didn't bring back whole
    failed: set[uuid.UUID]


class _JobRun:
    """One attempt at a job, with what it read as it started"""

    def __init__(
        self,
        job: ClaimedJob,
        connection: BankConnection,
        adapter: ProviderAdapter,
        *,
        timezone: ZoneInfo,
        currency_exponents: Mapping[str, int],
        now: datetime,
    ) -> None:
        """Hold the job, its connection as read and its provider, and the time it started"""
        self.job = job
        self.connection = connection
        self.adapter = adapter
        self.timezone = timezone
        self.currency_exponents = currency_exponents
        self.now = now
        self.today: date = now.astimezone(timezone).date()

    async def run(self) -> None:
        """List the connection's bank accounts if due, fetch windows for its due links, and record the job as finished

        A link whose fetch failed is left out of the rest of the job, so one failing on every request
        can't hold up the others: a window that ends before today and moves no checkpoint past its
        failures is followed in the same job by the next window the remaining links need. Retrying
        the failed link waits for a later job
        """
        links = await self._read_links()
        if self._needs_discovery(links):
            if not await self._discover():
                return
            links = await self._read_links()

        failed: set[uuid.UUID] = set()
        covered: set[uuid.UUID] = set()
        while True:
            needs = find_due_links(links, now=self.now, timezone=self.timezone, overlap_days=self.adapter.revisit_overlap_days)
            window = plan_window(
                [need for need in needs if need.link.id not in failed],
                today=self.today,
                timezone=self.timezone,
                max_days=self.adapter.max_window_days,
            )
            if window is None:
                await _end_job(self.job)
                return
            covered |= {need.link.id for need in window.needs}
            await self._record_covered_links(covered)

            fetched = await self._fetch(window)
            if fetched is None:
                return
            if window.last_day == self.today or fetched.moved or not fetched.failed:
                # The last part written ends where the window does, so a link it moved is synced through the window
                await _end_job(self.job, again=fetched.moved and window.last_day < self.today)
                return
            failed |= fetched.failed
            links = await self._read_links()

    async def _read_links(self) -> list[BankAccountLink]:
        """Return every link on the connection, as committed now"""
        async with async_session() as db:
            return list(await db.scalars(select(BankAccountLink).where(BankAccountLink.connection_id == self.connection.id)))

    def _needs_discovery(self, links: list[BankAccountLink]) -> bool:
        """Return whether the job lists the bank accounts first: flagged to, or the last listing is over 20 hours old

        An old listing matters only while a link could sync or wait for its bank account to return,
        and a connection without one gets a fresh listing when the user opens the link flow
        """
        if self.job.discover:
            return True
        discovered_at = self.connection.discovered_at
        stale = discovered_at is None or self.now - discovered_at > DISCOVERY_MAX_AGE
        return stale and any(link.state in _DISCOVERED_LINK_STATES for link in links)

    async def _discover(self) -> bool:
        """List the connection's bank accounts and store what came back, if the job still holds itself

        A discovery waiting on the budget passes on the job's own flag, so a connection whose listing
        was asked for still shows one pending while one merely rediscovered daily doesn't. One that
        failed is recorded on the connection and fails the job

        Returns:
            Whether the bank accounts were listed, so the job goes on to its window
        """
        try:
            sent_at = await self._count_request(ProviderRequestPurpose.DISCOVERY)
        except RequestBudgetSpent as spent:
            await _end_job(self.job, again=True, run_after=spent.available_again_at, discover=self.job.discover)
            return False

        result = await self.adapter.discover(decrypt(self.connection.credential_encrypted), currency_exponents=self.currency_exponents)
        async with async_session() as db:
            await lock_job_for_finish(db, self.job, ())
            connection = await db.scalar(
                select(BankConnection)
                .where(BankConnection.id == self.connection.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            await apply_discovery(db, connection, result, now=sent_at)
            await db.commit()
        if result.request_error is not None:
            await self._stop_for(result.request_error, discover=self.job.discover)
            return False
        return True

    async def _record_covered_links(self, covered: set[uuid.UUID]) -> None:
        """Record the links the job syncs on it, for their status to say a sync is under way"""
        async with async_session() as db:
            await lock_job_for_finish(db, self.job, ())
            await db.execute(update(BankSyncJob).where(BankSyncJob.id == self.job.id).values(covered_link_ids=list(covered)))
            await db.commit()

    async def _fetch(self, window: SyncWindow) -> _Fetched | None:
        """Fetch the window and write what it found

        SimpleFIN has no paging, so a response that may have been cut short is set aside and its days
        fetched again in halves, down to a single day, which is kept however long. Parts are written
        as they come back, earliest first, so those fetched before the budget ran out or a request
        failed keep their progress

        Returns:
            What the window moved and which links failed, or None when the job ended instead
        """
        parts = [window]
        moved = False
        failed: set[uuid.UUID] = set()
        while parts:
            part = parts.pop()
            result = await self._fetch_part(part)
            if result is None:
                return None
            if result.possibly_cut_off and part.first_day < part.last_day:
                earlier, later = part.halves()
                parts += [later, earlier]
                continue
            if result.possibly_cut_off:
                logger.warning("Bank sync job %s kept %s whole, though its response may have been cut short", self.job.id, part.first_day)
            synced = _synced_bank_accounts(result)
            failed |= {need.link.id for need in part.needs if need.link.external_account_id not in synced}
            moved = await self._write(part, synced)
        return _Fetched(moved=moved, failed=failed)

    async def _fetch_part(self, part: SyncWindow) -> FetchResult | None:
        """Count and send one request for a part of the window

        Returns:
            What came back, or None when the job ended instead: queued again for when the budget
            frees, or failed with the request's error
        """
        try:
            await self._count_request(ProviderRequestPurpose.SYNC)
        except RequestBudgetSpent as spent:
            await _end_job(self.job, again=True, run_after=spent.available_again_at)
            return None

        start, end = part.bounds(self.timezone)
        result = await self.adapter.fetch(
            decrypt(self.connection.credential_encrypted),
            account_ids=[need.link.external_account_id for need in part.needs],
            start=start,
            end=end,
            include_pending=part.last_day == self.today,
            timezone=self.timezone,
            currency_exponents=self.currency_exponents,
        )
        if is_quota_spent(result):
            await self._mark_budget_spent()
        if result.request_error is not None:
            await self._stop_for(result.request_error)
            return None
        return result

    async def _write(self, part: SyncWindow, synced: set[str]) -> bool:
        """Move the checkpoint of each link the response brought back whole, if the job still holds it

        A checkpoint moves only over days the link's data is complete for, so the part has to start no
        later than the first day the link lacks. The last successful sync is stamped when the checkpoint
        moves, or when the part brought the link back whole through today, with the job's start, the
        moment today was read, so the day it falls on is never before the checkpoint

        Args:
            part: The days fetched, and the links they were fetched for
            synced: The bank accounts the response brought back whole

        Returns:
            Whether a checkpoint moved
        """
        moved = False
        async with async_session() as db:
            for link in await lock_job_for_finish(db, self.job, [need.link for need in part.needs]):
                if link.external_account_id not in synced or first_missing_day(link) < part.first_day:
                    continue
                advanced = part.last_day > link.checkpoint
                if advanced:
                    link.checkpoint = part.last_day
                    moved = True
                if advanced or part.last_day == self.today:
                    link.last_success_at = self.now
            await mark_user_cache_changed(db, self.job.owner_id)
            await db.commit()
        return moved

    async def _count_request(self, purpose: ProviderRequestPurpose) -> datetime:
        """Count a request against the connection's budget and commit it, before it is sent

        Returns:
            When the request is sent

        Raises:
            RequestBudgetSpent: No request is left, carrying when the next one frees up
        """
        sent_at = datetime.now(UTC)
        async with async_session() as db:
            await reserve_provider_request(db, self.connection, purpose=purpose, now=sent_at)
            await db.commit()
        return sent_at

    async def _mark_budget_spent(self) -> None:
        """Count the connection's budget as spent, as the provider said its quota is"""
        async with async_session() as db:
            connection = await db.get(BankConnection, self.connection.id)
            await mark_request_budget_spent(db, connection, now=datetime.now(UTC))
            await db.commit()

    async def _stop_for(self, error: ProviderError, *, discover: bool = False) -> None:
        """End the job on a request that failed, queueing it again for when the budget frees if the provider asked to slow down

        Args:
            error: Why the request failed
            discover: Whether the job queued again lists the bank accounts first
        """
        if error.kind != ProviderErrorKind.RATE_LIMITED:
            await _end_job(self.job, error)
            return
        async with async_session() as db:
            connection = await db.get(BankConnection, self.connection.id)
            budget = await read_request_budget(db, connection, now=datetime.now(UTC))
        await _end_job(self.job, again=True, run_after=budget.available_again_at, discover=discover)


def _synced_bank_accounts(result: FetchResult) -> set[str]:
    """Return the bank accounts a response brought back whole: listed, with no error of their own and none for their bank login"""
    return {
        account.external_id
        for account in result.accounts
        if account.external_id not in result.account_errors and account.bank_login not in result.login_errors
    }


async def _end_job(
    job: ClaimedJob,
    error: ProviderError | None = None,
    *,
    again: bool = False,
    run_after: datetime | None = None,
    discover: bool = False,
) -> None:
    """Record a job as finished, or failed with an error, and queue the connection's next job in the same step when asked

    Args:
        job: The job as claimed
        error: What stopped the job, or None when it did all it could
        again: Whether to queue another job of the same kind, which merges into one already queued
        run_after: When that job may run, or at once when not given
        discover: Whether that job lists the bank accounts first

    Raises:
        JobNotHeld: A later attempt holds the job, so nothing was written
    """
    async with async_session() as db:
        await lock_job_for_finish(db, job, ())
        if again:
            await enqueue_bank_sync_job(
                db, owner_id=job.owner_id, connection_id=job.connection_id, kind=job.kind, discover=discover, run_after=run_after
            )
        await finish_job(db, job, error)
        await db.commit()
