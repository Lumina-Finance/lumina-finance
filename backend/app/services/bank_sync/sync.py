"""Running one claimed bank sync job: a discovery when one is due, then date windows of a connection's links

A job lists the connection's bank accounts first only when it was flagged to, a link waits in Choose
bank account, or the last listing is over 7 days old. A daily sync lists nothing otherwise, since
its fetch brings back each linked bank account's balance, and one that vanished from the fetch
queues the next job to list first. A window whose response may have been cut short
is fetched again in halves. So is a window the provider refused for a link, meaning it brought
back no data for it, when it spans over 45 days, and only for the links refused. A refusal of a
window of 45 days or less stops those links with a reason and no next attempt, until a Sync now
or a reconnect asks again at the full window, and never moves a checkpoint. The links
the same request brought data for keep it. An outage retries without end, while any other failure
retrying may fix, such as an unreadable response, gets one retry series and then stops its links as a
refusal does. A rejected credential, a bank sign-in and a payment problem keep their own handling.
Each request is counted against the connection's budget in a
transaction of its own before it is sent, and a job that finds the budget spent queues itself again
for when a request frees. A link whose fetch failed is left out of the rest of the job, and the job
it queues plans it only once no other link is due, so a link failing on every request can't take
each request that frees ahead of links that can progress. A job holds no database connection while
it waits on the provider. A link the user asked to sync now is due whatever its next attempt, and
one a job ends without an attempt for, such as one an import's earlier window didn't reach, passes
to the job it queues next

A bank account a fetch lists in a currency other than its account's isn't brought back whole, since
its amounts would be read at the wrong precision, and one it leaves out altogether isn't either.
The job queues the next one to list the bank accounts first. That moves its link to Choose bank
account when the listing agrees. A job that listed them itself queues no
listing, so a provider whose listing and fetch disagree can't spend request after request, and nor
does a job that ends on a rejected credential, since it can't list anything

Each attempt is recorded on the links it was for, as the retries module describes: a link brought
up to date succeeded, and one a request or listing failed for, or a response didn't bring back
whole, failed with the reason. A link fails at most once a job, so the halves of a window are one
attempt for it, and every job that ends queues its connection's next retry. A link brought up to
date through today, or whose bank needs a sign-in, next syncs a day after the job started, as the
schedule module describes, and every job that ends sets its connection's next scheduled sync

What a job stores, the balances and booked records each part brings back, the pending items a part
ending today brings back, its checkpoints, discoveries and its own end, is stored only while the job
holds itself, so a runner that lost its lease stores nothing and a link that changed while the job
fetched gets none of its results. Each such step locks the connection first, then the job, then any
bank accounts it stores a listing or balances for, then the links, then any bank transactions it
stores, then the ledger rows a correction compares with, then any pending items it
replaces, then the owner's cache row. The request
counts and the budget-spent mark lock only the connection and are written outside the job's fence,
since they record requests already sent, whoever holds the job. An answer to a request sent with a
credential the connection no longer holds is dropped whole, budget-spent mark included, and the job
ends without it

A job ending on a rejected credential marks the connection Reconnect needed as it ends, a link an
attempt fails on a bank sign-in is marked Bank sign-in needed until it comes back whole, and a link the
job's listing moves to Choose bank account waits there, each emailing the owner once as the
action_needed module describes. The emails a save records go out right after it commits, within the
job's time limit, so a later step that fails or runs past the limit can't hold them back, and a send
that fails can't undo the sync. One the limit cuts off is logged as unsent rather than sent past the
limit, so a mail server that hangs can't hold the runner
"""

import asyncio
import logging
import uuid
from collections.abc import Collection, Mapping, Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.encryption import decrypt
from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection, BankExternalAccount, BankLinkState, ProviderRequestPurpose
from app.models.bank_sync_job import BankSyncJob, ProviderErrorKind
from app.models.user import User
from app.services.bank_sync.action_needed import (
    ActionEmail,
    choose_account_emails,
    clear_signin_needed,
    flag_rejected_credential,
    flag_signin_needed,
    log_unsent_action_emails,
    send_action_emails,
)
from app.services.bank_sync.availability import LINK_LISTING, PROVIDER_GONE_DETAIL, adapter_for, enabled_adapters, provider_label
from app.services.bank_sync.discovery import apply_discovery, store_fetched_balances
from app.services.bank_sync.history_reminder import (
    clear_no_history_reminders,
    flag_cut_off_day,
    note_history_returned,
    raise_history_reminders,
)
from app.services.bank_sync.holds import store_holds
from app.services.bank_sync.ingestion import store_booked_records
from app.services.bank_sync.jobs import ClaimedJob, JobNotHeld, enqueue_bank_sync_job, finish_job, lock_covered_links, lock_held_job
from app.services.bank_sync.pending import store_pending_records
from app.services.bank_sync.provider_requests import (
    RequestBudgetSpent,
    is_quota_spent,
    mark_request_budget_spent,
    read_request_budget,
    reserve_provider_request,
)
from app.services.bank_sync.providers.contract import ExternalAccount, FetchResult, ProviderAdapter, ProviderError
from app.services.bank_sync.retries import (
    is_waiting_to_retry,
    queue_next_retry,
    record_failed_attempt,
    record_refused_attempt,
    record_successful_attempt,
)
from app.services.bank_sync.review_pause import apply_review_pauses
from app.services.bank_sync.schedule import next_daily_sync, schedule_next_sync
from app.services.bank_sync.windows import LinkNeed, SyncWindow, find_due_links, first_missing_day, plan_window
from app.services.cache_state.updates import mark_user_status_changed
from app.services.fx.currency_exponent_helpers import get_all_currency_exponents
from app.utils.dates import resolve_timezone

logger = logging.getLogger(__name__)

# A job lists the connection's bank accounts again once the last listing is older than this. A fetch
# already brings back every linked bank account's balance, so a listing only shows a bank added at
# the provider, which the link flow asks for when it opens. A week keeps the listing from going
# stale for good, at a request a week rather than one a day
DISCOVERY_MAX_AGE = timedelta(days=7)

# Why a link's attempt failed when a response listed its bank account in another currency than its
# account's, as the account's sync status shows it
_CURRENCY_CHANGED_REASON = "{provider} now reports this bank account in {currency}, not {account_currency}"

# A window longer than this that the provider refuses is asked for again in two halves. One this long
# or shorter that it refuses stops the link, since asking again would meet the same refusal. The
# provider notes any request over 45 days as past its recommended range
REFUSED_WINDOW_RETRY_DAYS = 45

# Why a link stopped when the provider refused even a short window for it, as the account's sync status shows it
_REFUSED_REASON = "{provider} refused the dates asked for. Use Sync now to try again"


class _CredentialReplaced(Exception):
    """The connection's credential was replaced while a request sent with the old one was out, so its answer is dropped"""


async def run_sync_job(job: ClaimedJob) -> None:
    """Run a claimed job as its owner, and record it as finished or failed, queueing what comes next

    The worker has already set the owner's identity, so every session opened here works under
    row-level security as that user. A rejected credential can't work until the user reconnects, so
    nothing is sent with it. A job that met an answer to a credential since replaced ends there,
    neither failed nor queued again, so whatever replaces a connection's credential has to queue the
    connection's next sync itself. The action-needed emails a save recorded are sent right after it
    commits, within the job's time limit. One a cancelled job hadn't sent is logged as unsent

    Args:
        job: The job as claimed

    Raises:
        JobNotHeld: A later attempt holds the job, or the connection was deleted with its jobs, so
            whatever this attempt found was discarded
        CancelledError: The job's time limit, or the worker stopping, cancelled it
    """
    now = datetime.now(UTC)
    async with async_session() as db:
        connection = await db.get(BankConnection, job.connection_id)
        if connection is None:
            raise JobNotHeld(f"Bank sync job {job.id}'s connection was deleted")
        deferred, requested = (
            await db.execute(select(BankSyncJob.deferred_link_ids, BankSyncJob.requested_link_ids).where(BankSyncJob.id == job.id))
        ).one()
        timezone = resolve_timezone(await db.scalar(select(User.tz).where(User.id == job.owner_id)))
        currency_exponents = await get_all_currency_exponents(db)

    # The emails of each save that committed, until they are sent
    outbox: list[ActionEmail] = []
    try:
        adapter = enabled_adapters().get(connection.provider)
        if adapter_for(connection.provider) is None:
            await _end_job(job, ProviderError(ProviderErrorKind.UNKNOWN, PROVIDER_GONE_DETAIL), started_at=now, outbox=outbox)
        elif adapter is None:
            error = ProviderError(ProviderErrorKind.UNKNOWN, f"{provider_label(connection.provider)} is turned off on this server")
            await _end_job(job, error, started_at=now, outbox=outbox)
        elif connection.credential_rejected_at is not None:
            await _end_job(job, started_at=now, outbox=outbox)
        else:
            run = _JobRun(
                job,
                connection,
                adapter,
                outbox=outbox,
                deferred=deferred,
                requested=requested,
                timezone=timezone,
                currency_exponents=currency_exponents,
                now=now,
            )
            try:
                await run.run()
            except _CredentialReplaced:
                await _end_job(job, started_at=now, outbox=outbox)
    except asyncio.CancelledError:
        # The time limit or the worker stopping ended the job, so nothing is sent after it. A
        # mail server that hangs would hold the runner
        log_unsent_action_emails(outbox)
        raise
    except Exception:
        # A save that committed before the error still sends what it recorded
        await send_action_emails(outbox)
        raise
    await send_action_emails(outbox)


async def fail_sync_job(job: ClaimedJob, error: ProviderError, *, started_at: datetime) -> None:
    """Record a job its runner couldn't finish as failed, and the error as a failed attempt for each link it was syncing

    Each link the job had started on and recorded no attempt for fails, and its retry is queued like
    any job's. A link the attempt already recorded keeps that record, a failure as well as a
    success: a failure moves its series on once a job, and a success it brought in stays one, with
    an import carrying on at the next scheduled sync rather than waiting out a retry

    Args:
        job: The job as claimed
        error: Why the job couldn't finish
        started_at: When the runner started the attempt

    Raises:
        JobNotHeld: A later attempt holds the job, it already finished, or the connection was
            deleted with its jobs, so nothing was written
    """
    async with async_session() as db:
        covered = await db.scalar(select(BankSyncJob.covered_link_ids).where(BankSyncJob.id == job.id))
        links = (await db.scalars(select(BankAccountLink).where(BankAccountLink.id.in_(covered or ())))).all()
    recorded_already = {link.id for link in links if link.last_attempt_at is not None and link.last_attempt_at >= started_at}
    # Only a time limit or an unexpected error fails a job here, and neither starts a state that
    # emails the owner, so the outbox stays empty and nothing holds the runner past the limit
    await _end_job(job, error, failed=[link for link in links if link.id not in recorded_already], started_at=started_at, outbox=[])


class _JobRun:
    """One attempt at a job, with what it read as it started and the links it found failing"""

    def __init__(
        self,
        job: ClaimedJob,
        connection: BankConnection,
        adapter: ProviderAdapter,
        *,
        outbox: list[ActionEmail],
        deferred: Collection[uuid.UUID],
        requested: Collection[uuid.UUID],
        timezone: ZoneInfo,
        currency_exponents: Mapping[str, int],
        now: datetime,
    ) -> None:
        """Hold the job, its connection as read, its provider, its emails' outbox, the links it plans last or syncs now, and when it started"""
        self.job = job
        self.connection = connection
        self.adapter = adapter

        # The action-needed emails of each save once it commits, sent right after it and logged as
        # unsent by the caller when the job is cancelled first
        self.outbox = outbox
        self.timezone = timezone
        self.currency_exponents = currency_exponents
        self.now = now
        self.today: date = now.astimezone(timezone).date()

        # When the links this job brings up to date through today next sync
        self.next_sync = next_daily_sync(now)

        # The links a part of this job didn't bring back whole, left out of the rest of it
        self.failed: set[uuid.UUID] = set()

        # Those among them the provider refused even a short window for, which no later part of the job asks for
        self.stopped: set[uuid.UUID] = set()

        # The links the user asked to sync now, due whatever their next attempt. Those this job ends
        # without an attempt for pass to the job it queues next
        self.requested: set[uuid.UUID] = set(requested)

        # The links an earlier job couldn't bring back whole and this one hasn't yet, planned only
        # once no other link is due. One the user asked to sync now is planned with the rest
        self.deferred: set[uuid.UUID] = set(deferred) - self.requested

        # The links this job recorded an attempt for, successful or failed
        self.attempted: set[uuid.UUID] = set()

        # Each linked account's currency (it never changes), read with the links
        self.account_currencies: dict[uuid.UUID, str] = {}

        # The bank login each linked bank account was listed under, by external id, read with the
        # links, for one a response leaves out
        self.bank_logins: dict[str, str | None] = {}

        # Whether this job listed the bank accounts, and whether the next one lists them, as a fetch
        # found one in a currency other than its account's, or left one out, in a job that didn't
        self.listed = False
        self.relist = False

    async def run(self) -> None:
        """List the connection's bank accounts if due, fetch windows for its due links, and record the job as finished

        A link whose fetch failed is left out of the rest of the job, so one failing on every request
        can't hold up the others: a window that ends before today and moves no checkpoint is followed
        in the same job by the next window the remaining links need. Retrying the failed link waits
        for its retry time and a later job. That job plans it once no other link is due, and a job that
        leaves a retry that was due for links that could progress queues it again at once

        Raises:
            _CredentialReplaced: An answer came back for a credential since replaced, and nothing of
                it was stored
        """
        links = await self._read_links()
        if self._needs_discovery(links):
            if not await self._discover(links):
                return
            links = await self._read_links()

        covered: set[uuid.UUID] = set()
        while True:
            due = self._due(links)
            window = self._plan([need for need in due if need.link.id not in self.deferred]) or self._plan(due)
            if window is None:
                await self._end()
                return
            covered |= {need.link.id for need in window.needs}
            await self._record_covered_links(covered)

            moved = await self._fetch(window)
            if moved is None:
                return
            if window.last_day == self.today or moved:
                # The last part written ends where the window does, so a link it moved is synced through the window
                overdue = any(is_waiting_to_retry(need.link) and need.link.id not in covered for need in due)
                await self._end(again=window.last_day < self.today, retry_overdue=overdue)
                return
            links = await self._read_links()

    def _due(self, links: list[BankAccountLink]) -> list[LinkNeed]:
        """Return the links due to sync now, each with the first day it needs, leaving out those this job found failing"""
        due = find_due_links(
            links, now=self.now, timezone=self.timezone, overlap_days=self.adapter.revisit_overlap_days, requested=self.requested
        )
        return [need for need in due if need.link.id not in self.failed]

    def _plan(self, needs: list[LinkNeed]) -> SyncWindow | None:
        """Return the window to fetch next for these links, or None when none of them is due"""
        return plan_window(needs, today=self.today, timezone=self.timezone, max_days=self.adapter.max_window_days)

    def _asks_for_pending(self, part: SyncWindow) -> bool:
        """Return whether a part asks for pending records, and so replaces the pending items of the accounts it brings back whole

        Only a part ending today does, so an import's earlier windows leave the pending items alone
        """
        return part.last_day == self.today

    async def _read_links(self) -> list[BankAccountLink]:
        """Return every link on the connection, as committed now, noting each linked account's currency and its bank login"""
        async with async_session() as db:
            rows = await db.execute(
                select(BankAccountLink, Account.currency, BankExternalAccount.login_key)
                .join(Account, Account.id == BankAccountLink.account_id)
                .outerjoin(BankExternalAccount, LINK_LISTING)
                .where(BankAccountLink.connection_id == self.connection.id)
            )
            links = rows.all()
        self.account_currencies = {link.account_id: currency for link, currency, _ in links}
        self.bank_logins = {link.external_account_id: login for link, _, login in links}
        return [link for link, *_ in links]

    def _needs_discovery(self, links: list[BankAccountLink]) -> bool:
        """Return whether the job lists the bank accounts first: flagged to, a link waits in Choose bank account, or the listing is old

        The listing is old once it is over 7 days. A link waiting for its bank account to return can only move on when a listing shows it. An
        old listing matters only while a link could sync, and a connection without one gets a fresh
        listing when the user opens the link flow
        """
        if self.job.discover or any(link.state == BankLinkState.CHOOSE_ACCOUNT for link in links):
            return True
        discovered_at = self.connection.discovered_at
        stale = discovered_at is None or self.now - discovered_at > DISCOVERY_MAX_AGE
        return stale and any(link.state == BankLinkState.ACTIVE for link in links)

    async def _discover(self, links: list[BankAccountLink]) -> bool:
        """List the connection's bank accounts and store what came back, if the job still holds itself

        A discovery waiting on the budget passes on the job's own flag, so a connection whose listing
        was asked for still shows one pending while one merely rediscovered daily doesn't. One that
        failed is recorded on the connection and fails the job, and with it the attempt of each link
        the job was to sync. Each link one moves to Choose bank account gets an email to its owner,
        sent as soon as the listing's save commits

        Args:
            links: Every link on the connection, as the job read them before listing

        Returns:
            Whether the bank accounts were listed, so the job goes on to its window
        """
        try:
            sent_at, credential = await self._count_request(ProviderRequestPurpose.DISCOVERY)
        except RequestBudgetSpent as spent:
            await self._end(again=True, run_after=spent.available_again_at, discover=self.job.discover)
            return False

        result = await self.adapter.discover(credential, currency_exponents=self.currency_exponents)
        async with async_session() as db:
            connection, _ = await _hold_for_finish(db, self.job, sent_with=credential)
            connection.provider_name = self.adapter.provider_name
            moved = await apply_discovery(db, connection, result, now=sent_at)
            emails = await choose_account_emails(db, connection, moved)

            # After the discovery's links, the order an unlink takes them in, so the two can't deadlock
            await mark_user_status_changed(db, self.job.owner_id)
            await db.commit()
            self.outbox += emails
        await send_action_emails(self.outbox)
        if result.request_error is not None:
            due = [need.link for need in self._due(links)]
            await self._stop_for(result.request_error, sent_with=credential, discover=self.job.discover, attempted=due, sent_at=sent_at)
            return False
        self.listed = True
        return True

    async def _record_covered_links(self, covered: set[uuid.UUID]) -> None:
        """Record the links the job syncs on it, for their status to say a sync is under way, and tell the owner's open pages"""
        async with async_session() as db:
            await _hold_for_finish(db, self.job)
            await db.execute(update(BankSyncJob).where(BankSyncJob.id == self.job.id).values(covered_link_ids=list(covered)))
            await mark_user_status_changed(db, self.job.owner_id)
            await db.commit()

    async def _fetch(self, window: SyncWindow) -> bool | None:
        """Fetch the window and write what it found, noting each link a part didn't bring back whole

        The contract has no paging, so a response that may have been cut short is set aside and its days
        fetched again in halves, down to a single day. That day is kept however long, and the links it
        brought back whole remind the user that some of that day's transactions may be missing.
        Parts are written as they come back, earliest first, so those fetched before the budget ran
        out or a request failed keep their progress

        Returns:
            Whether the last part written (it ends where the window does) moved a checkpoint, or
            None when the job ended instead
        """
        parts = [window]
        moved = False
        while parts:
            part = parts.pop()

            # A link the provider refused even a short window for takes no later part of this one
            live = tuple(need for need in part.needs if need.link.id not in self.stopped)
            if not live:
                continue
            if len(live) != len(part.needs):
                part = replace(part, needs=live)
            answered = await self._fetch_part(part)
            if answered is None:
                return None
            result, credential, sent_at = answered
            if result.possibly_cut_off and part.first_day < part.last_day:
                earlier, later = part.halves()
                parts += [later, earlier]
                continue
            if result.possibly_cut_off:
                logger.warning("Bank sync job %s kept %s whole, though its response may have been cut short", self.job.id, part.first_day)
            synced = _synced_bank_accounts(result)
            failures: dict[uuid.UUID, ProviderError] = {}
            refusals: dict[uuid.UUID, str] = {}
            retry_needs: list[LinkNeed] = []
            for need in part.needs:
                link = need.link
                bank_account = synced.get(link.external_account_id)
                account_currency = self.account_currencies[link.account_id]
                failure = None
                if bank_account is not None and bank_account.currency != account_currency:
                    del synced[link.external_account_id]
                    self.relist = not self.listed
                    reason = _CURRENCY_CHANGED_REASON.format(
                        provider=self.adapter.provider_name, currency=bank_account.currency_raw, account_currency=account_currency
                    )
                    failure = ProviderError(ProviderErrorKind.UNKNOWN, reason)
                elif bank_account is None:
                    login = self.bank_logins.get(link.external_account_id)
                    failure = _failure_of(result, link.external_account_id, login)

                    # A bank account the response leaves out, with no sign-in at its bank to explain
                    # it, may have vanished at the provider, which only a listing shows. Only the
                    # first miss after a success asks for one, so a bank account the provider keeps
                    # failing for doesn't double the requests each retry spends
                    left_out = all(listed.external_id != link.external_account_id for listed in result.accounts)
                    if left_out and login not in result.login_errors and link.last_failure_reason is None:
                        self.relist = not self.listed
                    if _is_refusal(result, link.external_account_id, failure):
                        # Asked again for a shorter window, first half then second, for the links
                        # refused. Where the window is already short, the link stops with the reason
                        if part.days > REFUSED_WINDOW_RETRY_DAYS:
                            retry_needs.append(need)
                            continue
                        if link.id not in self.failed:
                            self.failed.add(link.id)
                            self.stopped.add(link.id)
                            refusals[link.id] = _REFUSED_REASON.format(provider=self.adapter.provider_name)
                        continue
                if failure is None:
                    self.deferred.discard(link.id)
                elif link.id not in self.failed:
                    self.failed.add(link.id)
                    failures[link.id] = failure
            moved = await self._write(part, synced, failures, refusals, sent_with=credential, sent_at=sent_at, cut_off=result.possibly_cut_off)
            if retry_needs:
                earlier, later = SyncWindow(part.first_day, part.last_day, tuple(retry_needs)).halves()
                parts += [later, earlier]
        return moved

    async def _fetch_part(self, part: SyncWindow) -> tuple[FetchResult, str, datetime] | None:
        """Count and send one request for a part of the window

        Returns:
            What came back, the credential it was sent with and when it was sent, or None when the
            job ended instead: queued again for when the budget frees, or failed with the request's error
        """
        try:
            sent_at, credential = await self._count_request(ProviderRequestPurpose.SYNC)
        except RequestBudgetSpent as spent:
            await self._end(again=True, run_after=spent.available_again_at)
            return None

        start, end = part.bounds(self.timezone)
        result = await self.adapter.fetch(
            credential,
            account_ids=[need.link.external_account_id for need in part.needs],
            start=start,
            end=end,
            include_pending=self._asks_for_pending(part),
            timezone=self.timezone,
            currency_exponents=self.currency_exponents,
        )
        if is_quota_spent(result):
            await self._mark_budget_spent(sent_with=credential)
        if result.request_error is not None:
            attempted = [need.link for need in part.needs if need.link.id not in self.failed]
            await self._stop_for(result.request_error, sent_with=credential, attempted=attempted, sent_at=sent_at)
            return None
        return result, credential, sent_at

    async def _write(
        self,
        part: SyncWindow,
        synced: Mapping[str, ExternalAccount],
        failures: Mapping[uuid.UUID, ProviderError],
        refusals: Mapping[uuid.UUID, str],
        *,
        sent_with: str,
        sent_at: datetime,
        cut_off: bool,
    ) -> bool:
        """Store the records and pending items of each link brought back whole, move checkpoints and record attempts, if the job still holds it

        The balance each bank account brought back whole was read at is stored first, whatever its
        link does, as a listing would store it. Records are stored whatever the checkpoint does, since each is kept by its identity and a
        later sync reading it again changes nothing. A checkpoint moves only over days the link's data
        is complete for, so the part has to start no later than the first day the link lacks. The last
        successful sync is stamped when the checkpoint moves, or when the part brought the link back
        whole through today, with the job's start, the moment today was read, so the day it falls on
        is never before the checkpoint. The attempt succeeded when it is stamped, and failed for each
        link given a failure. A link the part brought through today next syncs a day on, while one
        with days still to catch up stays due for the job's next window

        A part ending today also replaces the pending items of those links' accounts with what it
        found pending, whatever their checkpoints, since what is pending now doesn't depend on the
        days a link still lacks

        A link brought back whole is no longer waiting on a bank sign-in, even when re-reading days it
        has doesn't count as a success, since its bank login answered. One that failed on a bank
        sign-in is marked as waiting on one, and when that starts its bank login's state, the login's
        email goes out once the part's save commits. Each link brought back whole notes the history
        its import or catch-up has returned and ends a reminder that nothing came back once booked
        history from that reminder's first day on arrives. One the part brought through today raises
        the reminder if it fell short, as a single day that may have been cut short does on each link
        it brought back whole. Last, an import the part brought through today ends, and each link no
        import is running on pauses or resumes by its account's review backlog, the whole part
        counted. A link that failed wasn't brought back whole,
        so its import keeps running and the pause leaves it as it was

        Args:
            part: The days fetched, and the links they were fetched for
            synced: The bank accounts the response brought back whole, by external id
            failures: Why the response failed each link it hadn't already failed in this job, by link id
            refusals: The reason each link stops for that the provider refused even a short window for, by link id
            sent_with: The credential the request went out with
            sent_at: When the request went out, the time its records were observed at
            cut_off: The response may have been cut short, but only a single day's is when written

        Returns:
            Whether a checkpoint moved
        """
        moved = False
        succeeded = []
        async with async_session() as db:
            connection = await _hold_job(db, self.job, sent_with=sent_with)

            # Between the job and the links, the order a listing writes bank accounts in
            balances_changed = await store_fetched_balances(db, connection, synced.values())
            held = await lock_covered_links(db, [need.link for need in part.needs])
            whole = [link for link in held if link.external_account_id in synced]
            deliveries = [(link, synced[link.external_account_id].records) for link in whole]
            stored_changed = await store_booked_records(db, deliveries, observed_at=sent_at)
            holds_changed = await store_holds(db, deliveries, first_day=part.first_day, last_day=part.last_day, observed_at=sent_at)

            # A part ending today is the job's last write, so the job's end tells the owner's pages of it
            if self._asks_for_pending(part):
                await store_pending_records(db, deliveries, observed_at=sent_at)
            note_history_returned(deliveries, today=self.today)
            for link in whole:
                if first_missing_day(link) < part.first_day:
                    continue
                advanced = part.last_day > link.checkpoint
                if advanced:
                    link.checkpoint = part.last_day
                    moved = True
                if advanced or part.last_day == self.today:
                    link.last_success_at = self.now
                    record_successful_attempt(link, at=sent_at, next_sync=self.next_sync if part.last_day == self.today else None)
                    succeeded.append(link)
            failed = [link for link in held if link.id in failures or link.id in refusals]
            for link in failed:
                if link.id in refusals:
                    record_refused_attempt(link, refusals[link.id], at=sent_at)
                else:
                    record_failed_attempt(link, failures[link.id], at=sent_at, next_sync=self.next_sync)
            clear_signin_needed(whole)
            signin_needed = [link for link in failed if link.id in failures and failures[link.id].kind == ProviderErrorKind.BANK_LOGIN_NEEDED]
            emails = await flag_signin_needed(db, connection, signin_needed, at=sent_at)
            cleared = clear_no_history_reminders(deliveries)
            reminded = raise_history_reminders(whole, today=self.today) or cleared
            if cut_off:
                reminded = flag_cut_off_day(whole, part.first_day) or reminded
            paused_or_imported = await apply_review_pauses(db, whole, today=self.today)

            # A sync never changes the owner's ledger, only what their pages show, so an import saved
            # before it can still be undone
            if stored_changed or holds_changed or balances_changed or succeeded or failed or reminded or paused_or_imported:
                await mark_user_status_changed(db, self.job.owner_id)
            await db.commit()
            self.outbox += emails
            self.attempted |= {link.id for link in succeeded + failed}
        await send_action_emails(self.outbox)
        return moved

    async def _count_request(self, purpose: ProviderRequestPurpose) -> tuple[datetime, str]:
        """Count a request against the connection's budget and commit it, before it is sent

        Returns:
            When the request is sent, and the credential to send it with, read as it is counted so
            a credential a reconnect replaced since the job started is never sent

        Raises:
            RequestBudgetSpent: No request is left, carrying when the next one frees up
        """
        sent_at = datetime.now(UTC)
        async with async_session() as db:
            await reserve_provider_request(db, self.connection, purpose=purpose, now=sent_at)
            credential = await db.scalar(select(BankConnection.credential_encrypted).where(BankConnection.id == self.connection.id))
            await db.commit()
        return sent_at, decrypt(credential)

    async def _mark_budget_spent(self, *, sent_with: str) -> None:
        """Count the connection's budget as spent, as the provider said its quota is for the credential the request went out with"""
        async with async_session() as db:
            connection = await _lock_connection(db, self.connection.id)
            _refuse_a_replaced_credential(connection, sent_with)
            await mark_request_budget_spent(db, connection, now=datetime.now(UTC))
            await db.commit()

    async def _stop_for(
        self,
        error: ProviderError,
        *,
        sent_with: str,
        attempted: Sequence[BankAccountLink],
        sent_at: datetime,
        discover: bool = False,
    ) -> None:
        """End the job on a request that failed, queueing it again for when the budget frees if the provider asked to slow down

        A slow-down was checked against a replaced credential as the budget was marked spent. Any
        other failure is checked again as the job ends, a failed listing too, since a reconnect can
        commit after the listing was stored, and a rejection of the credential it replaced must not
        mark the connection. A slow-down is no attempt, so only another failure is recorded on the links

        Args:
            error: Why the request failed
            sent_with: The credential the request went out with
            attempted: The links the request was for. They failed with it
            sent_at: When the request was sent
            discover: Whether the job queued again lists the bank accounts first
        """
        if error.kind != ProviderErrorKind.RATE_LIMITED:
            await self._end(error, sent_with=sent_with, failed=attempted, attempted_at=sent_at)
            return
        async with async_session() as db:
            connection = await db.get(BankConnection, self.connection.id)
            budget = await read_request_budget(db, connection, now=datetime.now(UTC))
        await self._end(again=True, run_after=budget.available_again_at, discover=discover)

    async def _end(
        self,
        error: ProviderError | None = None,
        *,
        again: bool = False,
        run_after: datetime | None = None,
        discover: bool = False,
        sent_with: str | None = None,
        failed: Sequence[BankAccountLink] = (),
        attempted_at: datetime | None = None,
        retry_overdue: bool = False,
    ) -> None:
        """Record the job as finished or failed, and queue the next one when asked, planning last the links this one found failing

        The next one is queued to list the bank accounts first, whatever was asked, once a fetch
        found one in a currency other than its account's, or left one out for the first time since
        its link last succeeded, in a job that didn't list them, unless the
        provider has since rejected the credential: a listing would only spend a request on it.
        It syncs now each link the user asked for that this one ends without an attempt for, such as
        one an import's earlier window on the same connection didn't reach

        Args:
            error: What stopped the job, or None when it did all it could
            again: Whether to queue another job of the same kind
            run_after: When that job may run, or at once when not given
            discover: Whether that job lists the bank accounts first
            sent_with: The credential of the request whose answer ends the job, or None when none does
            failed: The links the error failed an attempt for
            attempted_at: When the failed attempt's request was sent
            retry_overdue: Whether the job left a link whose retry was due
        """
        relist = self.relist and (error is None or error.kind != ProviderErrorKind.CREDENTIAL_REJECTED)
        await _end_job(
            self.job,
            error,
            again=again or relist,
            run_after=run_after,
            discover=discover or relist,
            deferred=self.failed | self.deferred,
            requested=self.requested - self.attempted - {link.id for link in failed},
            sent_with=sent_with,
            failed=failed,
            attempted_at=attempted_at,
            retry_overdue=retry_overdue,
            started_at=self.now,
            outbox=self.outbox,
        )
        await send_action_emails(self.outbox)


async def _hold_for_finish(
    db: AsyncSession,
    job: ClaimedJob,
    links: Sequence[BankAccountLink] = (),
    *,
    sent_with: str | None = None,
) -> tuple[BankConnection, list[BankAccountLink]]:
    """Lock the job's connection, then the job and the links it may still write for, as each step that stores what it found starts

    Connection, job, links is the one order the connection's writers take their locks in, so none
    can hold a link another waits for while waiting on the connection that one holds

    Args:
        db: The job owner's session. The step then writes in it
        job: The job as claimed
        links: The links the step writes for, as the step read them
        sent_with: The credential the request whose answer the step stores went out with, or None
            when the step stores no answer

    Returns:
        The connection freshly read, and the links still covered, freshly read and locked

    Raises:
        JobNotHeld: A later attempt holds the job, it already finished, or the connection was
            deleted with its jobs
        _CredentialReplaced: The connection no longer holds the credential the request went out with
    """
    connection = await _hold_job(db, job, sent_with=sent_with)
    return connection, await lock_covered_links(db, links)


async def _hold_job(db: AsyncSession, job: ClaimedJob, *, sent_with: str | None = None) -> BankConnection:
    """Lock the job's connection, then the job, the first half of _hold_for_finish, for a step that writes bank accounts before the links

    Returns:
        The connection freshly read

    Raises:
        JobNotHeld: A later attempt holds the job, it already finished, or the connection was
            deleted with its jobs
        _CredentialReplaced: The connection no longer holds the credential the request went out with
    """
    connection = await _lock_connection(db, job.connection_id)

    # A deleted connection took its jobs with it, so this raises before a missing connection is returned
    await lock_held_job(db, job)
    if sent_with is not None:
        _refuse_a_replaced_credential(connection, sent_with)
    return connection


async def _lock_connection(db: AsyncSession, connection_id: uuid.UUID) -> BankConnection | None:
    """Lock the connection's row and return it freshly read, or None when it was deleted"""
    return await db.scalar(
        select(BankConnection).where(BankConnection.id == connection_id).with_for_update().execution_options(populate_existing=True)
    )


def _refuse_a_replaced_credential(connection: BankConnection, sent_with: str) -> None:
    """Raise _CredentialReplaced when the connection, locked, no longer holds the credential a request went out with"""
    if decrypt(connection.credential_encrypted) != sent_with:
        raise _CredentialReplaced(f"Bank connection {connection.id}'s credential was replaced while a request sent with the old one was out")


def _synced_bank_accounts(result: FetchResult) -> dict[str, ExternalAccount]:
    """Return the bank accounts a response brought back whole, by external id: listed, with no error of their own or their bank login's"""
    return {
        account.external_id: account
        for account in result.accounts
        if account.external_id not in result.account_errors and account.bank_login not in result.login_errors
    }


def _is_refusal(result: FetchResult, external_id: str, failure: ProviderError) -> bool:
    """Return whether a failure is the provider refusing the dates: an error of the account's own, or its being left out

    A bank login's error comes first in the failure, so it is never one. An outage or a slow-down
    fails the whole request instead and never reaches an account
    """
    return failure.kind in (ProviderErrorKind.TEMPORARY, ProviderErrorKind.UNKNOWN) and result.account_errors.get(external_id) is failure


def _failure_of(result: FetchResult, external_id: str, stored_login: str | None) -> ProviderError:
    """Return why a response didn't bring a bank account back whole: its bank login's error, or else its own

    A bank login's error comes first, since a sign-in at the bank is what the user has to fix. A bank
    account the response left out is under the bank login its listing stored, and the provider gives
    each one it leaves out an error of its own
    """
    listed = next((account for account in result.accounts if account.external_id == external_id), None)
    login = listed.bank_login if listed is not None else stored_login
    if login in result.login_errors:
        return result.login_errors[login]
    return result.account_errors[external_id]


async def _end_job(
    job: ClaimedJob,
    error: ProviderError | None = None,
    *,
    again: bool = False,
    run_after: datetime | None = None,
    discover: bool = False,
    deferred: Collection[uuid.UUID] = (),
    requested: Collection[uuid.UUID] = (),
    sent_with: str | None = None,
    failed: Sequence[BankAccountLink] = (),
    attempted_at: datetime | None = None,
    retry_overdue: bool = False,
    started_at: datetime,
    outbox: list[ActionEmail],
) -> None:
    """Record a job as finished, or failed with an error, and queue the connection's next job in the same step when asked

    The error is recorded as a failed attempt on the links it failed for, the connection's next
    retry is queued, and its next scheduled sync is set from what its links now wait for. A rejected
    credential marks the connection Reconnect needed, since the request was checked against the
    credential the connection holds. The owner's open pages are told, since the sync status changes
    with it. The action-needed emails the step recorded join the outbox as it commits, for the
    caller to send

    Args:
        job: The job as claimed
        error: What stopped the job, or None when it did all it could
        again: Whether to queue another job of the same kind. It merges into one already queued
        run_after: When that job may run, or at once when not given
        discover: Whether that job lists the bank accounts first
        deferred: The links that job plans only once no other link is due
        requested: The links that job syncs whatever their next attempt, as the user asked
        sent_with: The credential of the request whose answer ends the job, or None when none does
        failed: The links the error failed an attempt for, as the caller read them
        attempted_at: When the failed attempt's request was sent, or now when not given
        retry_overdue: Whether the job left a link whose retry was due
        started_at: When the job's attempt started. It found the links due at that time
        outbox: Where the emails the step recorded wait to be sent

    Raises:
        JobNotHeld: A later attempt holds the job, so nothing was written
        _CredentialReplaced: The connection no longer holds the credential the request went out
            with, so nothing was written
    """
    async with async_session() as db:
        connection, held = await _hold_for_finish(db, job, failed if error is not None else (), sent_with=sent_with)
        now = datetime.now(UTC)
        next_sync = next_daily_sync(started_at)
        for link in held:
            record_failed_attempt(link, error, at=attempted_at or now, next_sync=next_sync)
        emails = []
        if error is not None and error.kind == ProviderErrorKind.CREDENTIAL_REJECTED:
            emails = await flag_rejected_credential(db, connection, at=attempted_at or now)
        elif error is not None and error.kind == ProviderErrorKind.BANK_LOGIN_NEEDED:
            emails = await flag_signin_needed(db, connection, held, at=attempted_at or now)
        if again:
            await enqueue_bank_sync_job(
                db,
                owner_id=job.owner_id,
                connection_id=job.connection_id,
                kind=job.kind,
                discover=discover,
                run_after=run_after,
                deferred_link_ids=deferred,
                requested_link_ids=requested,
            )
        await queue_next_retry(db, connection, ended_by=error, overdue=retry_overdue, started_at=started_at, now=now)
        await schedule_next_sync(db, connection, now=now)
        await finish_job(db, job, error)
        await mark_user_status_changed(db, job.owner_id)
        await db.commit()
        outbox += emails
