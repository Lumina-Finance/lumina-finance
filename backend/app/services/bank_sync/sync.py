"""Running one claimed bank sync job: one date window of a connection's links

Each request is counted against the connection's budget in a transaction of its own before it is
sent, and a job that finds the budget spent queues itself again for when a request frees. A job
holds no database connection while it waits on the provider, and everything it writes goes through
lock_job_for_finish, so a runner that lost its lease writes nothing and a link that changed while
the job fetched gets none of its results
"""

from collections.abc import Mapping
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, update

from app.database import async_session
from app.encryption import decrypt
from app.models.bank_connection import BankAccountLink, BankConnection, ProviderRequestPurpose
from app.models.bank_sync_job import BankSyncJob, ProviderErrorKind
from app.models.user import User
from app.services.bank_sync.availability import ENABLED_ADAPTERS, PROVIDER_ADAPTERS
from app.services.bank_sync.jobs import ClaimedJob, JobNotHeld, enqueue_bank_sync_job, finish_job, lock_job_for_finish
from app.services.bank_sync.provider_requests import (
    RequestBudgetSpent,
    is_quota_spent,
    mark_request_budget_spent,
    read_request_budget,
    reserve_provider_request,
)
from app.services.bank_sync.providers.contract import FetchResult, ProviderAdapter, ProviderError
from app.services.bank_sync.windows import SyncWindow, find_due_links, plan_window
from app.services.cache_state.updates import mark_user_cache_changed
from app.services.fx.currency_exponent_helpers import get_all_currency_exponents
from app.utils.dates import resolve_timezone

_ONE_DAY = timedelta(days=1)


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
        """Fetch the window the connection's due links need, and record the job as finished"""
        async with async_session() as db:
            links = await db.scalars(select(BankAccountLink).where(BankAccountLink.connection_id == self.connection.id))
            needs = find_due_links(links, now=self.now, timezone=self.timezone, overlap_days=self.adapter.revisit_overlap_days)

        window = plan_window(needs, today=self.today, timezone=self.timezone, max_days=self.adapter.max_window_days)
        if window is None:
            await _end_job(self.job)
            return
        await self._record_covered_links(window)
        await self._fetch(window)

    async def _record_covered_links(self, window: SyncWindow) -> None:
        """Record the links the job syncs on it, for their status to say a sync is under way"""
        async with async_session() as db:
            await lock_job_for_finish(db, self.job, ())
            await db.execute(
                update(BankSyncJob).where(BankSyncJob.id == self.job.id).values(covered_link_ids=[need.link.id for need in window.needs])
            )
            await db.commit()

    async def _fetch(self, window: SyncWindow) -> None:
        """Fetch the window and write what it found, queueing the next window at once while a link is still behind"""
        try:
            await self._count_request(ProviderRequestPurpose.SYNC)
        except RequestBudgetSpent as spent:
            await _end_job(self.job, again=True, run_after=spent.available_again_at)
            return

        start, end = window.bounds(self.timezone)
        result = await self.adapter.fetch(
            decrypt(self.connection.credential_encrypted),
            account_ids=[need.link.external_account_id for need in window.needs],
            start=start,
            end=end,
            include_pending=window.last_day == self.today,
            timezone=self.timezone,
            currency_exponents=self.currency_exponents,
        )
        if is_quota_spent(result):
            await self._mark_budget_spent()
        if result.request_error is not None:
            await self._stop_for(result.request_error)
            return

        behind = await self._write(window, result)
        await _end_job(self.job, again=behind)

    async def _write(self, window: SyncWindow, result: FetchResult) -> bool:
        """Move the checkpoint of each link the response brought back whole, if the job still holds it

        A checkpoint moves only over days the link's data is complete for, so the window has to start
        no later than the day after it. The last successful sync is stamped with the job's start, the
        moment today was read, so the day it falls on is the day the checkpoint was set

        Returns:
            Whether a link moved on but is still short of today
        """
        synced = _synced_bank_accounts(result)
        behind = False
        async with async_session() as db:
            for link in await lock_job_for_finish(db, self.job, [need.link for need in window.needs]):
                if link.external_account_id in synced and link.checkpoint + _ONE_DAY >= window.first_day and window.last_day > link.checkpoint:
                    link.checkpoint = window.last_day
                    link.last_success_at = self.now
                    behind |= link.checkpoint < self.today
            await mark_user_cache_changed(db, self.job.owner_id)
            await db.commit()
        return behind

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

    async def _stop_for(self, error: ProviderError) -> None:
        """End the job on a request that failed, queueing it again for when the budget frees if the provider asked to slow down"""
        if error.kind != ProviderErrorKind.RATE_LIMITED:
            await _end_job(self.job, error)
            return
        async with async_session() as db:
            connection = await db.get(BankConnection, self.connection.id)
            budget = await read_request_budget(db, connection, now=datetime.now(UTC))
        await _end_job(self.job, again=True, run_after=budget.available_again_at)


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
) -> None:
    """Record a job as finished, or failed with an error, and queue the connection's next job in the same step when asked

    Args:
        job: The job as claimed
        error: What stopped the job, or None when it did all it could
        again: Whether to queue another job of the same kind, which merges into one already queued
        run_after: When that job may run, or at once when not given

    Raises:
        JobNotHeld: A later attempt holds the job, so nothing was written
    """
    async with async_session() as db:
        await lock_job_for_finish(db, job, ())
        if again:
            await enqueue_bank_sync_job(db, owner_id=job.owner_id, connection_id=job.connection_id, kind=job.kind, run_after=run_after)
        await finish_job(db, job, error)
        await db.commit()
