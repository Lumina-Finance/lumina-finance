"""Running a bank sync job: the listing it reads first, the windows it fetches, the records and checkpoints it stores and the job it queues next

Jobs run through the worker's run_jobs, as their owner under row-level security, against a scripted
provider. A checkpoint moved for days a response didn't bring back whole hides that gap for good, a
long import that stops after its first window leaves months missing, a job that keeps sending once
the request budget is spent can get the user's Fake Bank token disabled, and a link failing on every
request that holds up the others, or takes each request that frees ahead of them, stalls their
imports. A booked record dropped is a transaction the user never sees, one stored twice or brought
back after a dismissal is a duplicate to clear, and one that skips review moves balances unchecked.
A pending item kept after it posted or was dropped shows a hold that's gone, and pending items
replaced by a window before today or for an account a fetch failed for hide holds still pending.
A job that skips its listing leaves new bank accounts unlisted and vanished ones syncing, and one
that stores what it found after losing its lease, for a link unlinked mid-fetch, or from a request
sent with a credential replaced mid-flight overwrites what the user, a reconnect or a later attempt
did. An attempt left unrecorded shows a sync that never happened, a retry sent early or for a failure
retrying can't fix spends requests for nothing, and one never queued leaves an account stale. An
account that keeps syncing past 100 new items waiting buries the user in review, one paused by
corrections or a pause on another account stops for nothing, and an import the pause stops part way
leaves a gap in the history. An opening adjustment offered while the import's items still wait
closes a gap reviewing them would have, and one a later sync's balance never offers leaves the
ledger apart from the bank for good. Days a catch-up re-reads counted as reaching its first day
hide the gap after them, and an import or catch-up that gets less history than it asked for
without a reminder leaves a gap in the ledger nobody notices, as does an import that gets nothing
without reminding at once, however recent its start, while one reminding of a quiet first
week, a catch-up of a few days or a cut-short day the user already dismissed nags, as does one
saying nothing came back once a later sync has brought history from the day it asked from. A
bank change to a transaction already in the ledger that reaches it without review when set to
review, overwrites a value the user edited or kept, or moves it without its balances, changes the
user's money unseen, and a correction opened again for what the user already decided keeps asking the
same question. Something only the user can fix that isn't marked,
or isn't emailed, leaves accounts silently stale, while one emailed twice, marked from a refusal of
a credential since replaced, or whose failed email undoes the sync, nags or misleads the user

The daily schedule, and the due scan that queues it, called on its own as the worker's loop calls it,
come last. A link synced through today that is fetched again before tomorrow spends a request for
nothing, one whose next sync is never set stops syncing, and a schedule that counts a paused or
unchosen link, or queues a sync before a request frees, sends what the review pause or the budget
holds back. One that counts a link before the first day it needs has started queues syncs that find
nothing to fetch, and one that passes over a retry no job was queued for leaves the account stale.
A scan that queues syncs for a rejected credential or a turned-off provider spends requests or jobs
on failures, and one that drops a bank sign-in's daily sync misses the user signing in again
"""

import asyncio
import logging
import uuid
from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from typing import override
from zoneinfo import ZoneInfo

import pytest
from freezegun import freeze_time
from sqlalchemy import delete, func, select, text, update

from app.encryption import encrypt
from app.models.account import Account
from app.models.account_review_preference import AccountReviewPreference, ReviewDecision
from app.models.bank_connection import (
    BankAccountLink,
    BankConnection,
    BankExternalAccount,
    BankImportKind,
    BankLinkState,
    BankProviderRequest,
    ProviderRequestPurpose,
)
from app.models.bank_hold import BankHold
from app.models.bank_pending_transaction import BankPendingTransaction
from app.models.bank_sync_job import BankSyncJob, BankSyncJobKind, ProviderErrorKind
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition, OpenReviewKind
from app.models.cache_state import UserCacheState
from app.models.category import Category
from app.models.import_run import ImportRun
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.models.transaction_link import TransactionLink
from app.models.user import User
from app.schemas.transaction import UpdateTransactionRequest
from app.services.accounts.snapshots import recompute_account_snapshots
from app.services.bank_sync import action_needed, schedule, sync
from app.services.bank_sync.availability import PROVIDER_GONE_DETAIL
from app.services.bank_sync.connections import build_connection_responses
from app.services.bank_sync.jobs import enqueue_bank_sync_job
from app.services.bank_sync.provider_requests import read_request_budget, reserve_provider_request
from app.services.bank_sync.providers.contract import FetchResult, ProviderError, ProviderRecord
from app.services.bank_sync.review_pause import lift_review_pauses, lock_account_links
from app.services.bank_sync.schedule import next_daily_sync, queue_scheduled_sync, schedule_next_sync
from app.services.bank_sync.transaction_hash import hash_bank_transaction_id
from app.services.bank_sync.worker import enqueue_due_work, run_jobs
from app.services.cache_state import get_visible_cache_status, mark_user_cache_changed
from app.services.email import RenderedEmail
from app.services.email import contract as email_contract
from app.services.importers.shared.run_history import get_last_import
from app.services.merchants.defaults import SELF_MERCHANT_NAME
from app.services.transactions.update import apply_transaction_update
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _DISMISSED,
    _attempts,
    _balances,
    _build_account,
    _build_bank_connection,
    _build_bank_link,
    _build_bank_transaction,
    _build_external_account,
    _build_ledger_transaction,
    _build_pending_transaction,
    _commit_accepted_items,
    _commit_bank_connection,
    _commit_waiting_items,
    _dismiss_items,
    _expire_lease,
    _job_states,
    _ledger_rows,
    _owner_session,
    _queued_jobs,
    _seed_job,
    _spend_requests,
)
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.services.bank_sync.fake_provider import FAKE_PROVIDER, FakeProviderAdapter, _bank_account, _returned, remove_provider, use_adapter

# Without clock changes, so the examples' windows are whole runs of 90 calendar days. The frozen
# clock reads 1 pm on 4 October there
_BRISBANE = ZoneInfo("Australia/Brisbane")
_TODAY = date(2026, 10, 4)

# West of UTC without clock changes. The frozen clock reads 8 pm on 3 October there, already
# 4 October in UTC, so a day taken in the wrong timezone shows
_PHOENIX = ZoneInfo("America/Phoenix")

# Where clocks go forward an hour at 2 am on 4 October, so a time worked out on the clock rather
# than in elapsed time shows
_SYDNEY = ZoneInfo("Australia/Sydney")

# Yesterday's daily sync. It left a link complete through 3 October
_YESTERDAYS_SYNC = datetime(2026, 10, 3, 9, 0, tzinfo=_BRISBANE)

# More jobs than any test here queues, so a job that keeps queueing another fails the test
_MOST_JOBS = 10

# A stored bank transaction keeps only the keyed hash of the ID the bank sent. Naming this column in what
# _bank_transactions returns reads that ID back, from the IDs the tests have sent so far
_BANK_ID = BankTransaction.external_transaction_hash.label("bank_id")
_KNOWN_BANK_IDS: set[str] = set()

# Long enough for any step here to finish, so a missing protection fails the test rather than hanging it
_WAIT_SECONDS = 10

# Requests a connection may send in 24 hours
_DAILY_REQUESTS = FakeProviderAdapter.daily_request_budget

# The connection's credential, and the one reconnecting it stores in its place
_CREDENTIAL = "https://user:secret@bridge.example/simplefin"
_RENEWED = "https://user:renewed@bridge.example/simplefin"

pytestmark = pytest.mark.usefixtures("worker_sessions")


@pytest.fixture
def provider(monkeypatch) -> FakeProviderAdapter:
    """Serve the connections' provider through a scripted fake"""
    fake = FakeProviderAdapter()
    use_adapter(monkeypatch, fake)
    return fake


@pytest.fixture
async def connection(connections, frozen_now) -> BankConnection:
    """The first owner's connection, with a credential the job can read, listed an hour ago, and its owner in Brisbane"""
    async with TestSession() as session:
        stored = await session.get(BankConnection, connections[0].id)
        stored.credential_encrypted = encrypt(_CREDENTIAL)
        stored.discovered_at = frozen_now - timedelta(hours=1)
        (await session.get(User, stored.owner_id)).tz = "Australia/Brisbane"
        await session.commit()
    return stored


async def _link(connection: BankConnection, external_id: str, **values) -> BankAccountLink:
    """Commit an account linked to the bank account, its link's fields set as given"""
    account = _build_account(connection.owner_id, name=external_id)
    link = _build_bank_link(account, connection, external_id)
    for field, value in values.items():
        setattr(link, field, value)
    async with TestSession() as session:
        session.add(account)
        await session.flush()
        session.add(link)
        await session.commit()
    return link


def _synced_through_yesterday(**values) -> dict:
    """Return the fields of a link whose import ended long ago and which yesterday's daily sync left complete through 3 October"""
    return {"import_start": date(2026, 1, 1), "checkpoint": date(2026, 10, 3), "last_success_at": _YESTERDAYS_SYNC, "importing": False} | values


def _returned_with(records: dict[str, Sequence[ProviderRecord]]) -> FetchResult:
    """Return a response bringing back each bank account whole with its records"""
    return FetchResult(accounts=tuple(_bank_account(external_id, records=account_records) for external_id, account_records in records.items()))


def _record(
    external_id: str,
    day: date = date(2026, 10, 2),
    *,
    amount: int | None = -4_50,
    raw_amount: str = "-4.50",
    description: str = "POS 4411 COFFEE",
    **values,
) -> ProviderRecord:
    """Return a booked record as the provider sends it, a $4.50 coffee on 2 October unless told otherwise"""
    _KNOWN_BANK_IDS.add(external_id)
    fields = {"pending": False} | values
    return ProviderRecord(external_id=external_id, date=day, amount=amount, raw_amount=raw_amount, description=description, **fields)


def _pending_record(external_id: str, day: date = _TODAY, **values) -> ProviderRecord:
    """Return a record still pending at the bank, a $4.50 coffee today described by its ID unless told otherwise

    A pending item keeps no ID, so the description is what tells one stored item from another
    """
    return _record(external_id, day, pending=True, **{"description": external_id} | values)


def _read_back_id(provider: str, bank_account: str, stored_hash: str) -> str:
    """Return the ID the tests sent that a bank transaction's keyed hash stands for, or the hash itself when none matches"""
    sent = (bank_id for bank_id in _KNOWN_BANK_IDS if hash_bank_transaction_id(provider, bank_account, bank_id) == stored_hash)
    return next(sent, stored_hash)


async def _bank_transactions(*columns) -> list[tuple]:
    """Return these columns of every stored bank transaction, by bank account and then the ID the bank sent

    Only the keyed hash of that ID is stored, so _BANK_ID reads back the ID among those the tests sent
    """
    async with TestSession() as session:
        rows = await session.execute(
            select(BankTransaction.provider, BankTransaction.external_account_id, BankTransaction.external_transaction_hash, *columns)
        )
    found = [
        (bank_account, _read_back_id(provider, bank_account, stored_hash), values) for provider, bank_account, stored_hash, *values in rows
    ]
    return [
        tuple(bank_id if column is _BANK_ID else value for column, value in zip(columns, values, strict=True))
        for _, bank_id, values in sorted(found, key=lambda stored: stored[:2])
    ]


async def _pending_transactions(*columns) -> list[tuple]:
    """Return these columns of every stored pending item, by description"""
    async with TestSession() as session:
        rows = await session.execute(select(*columns).order_by(BankPendingTransaction.description))
        return [tuple(row) for row in rows]


async def _store_pending(link: BankAccountLink, description: str, **values) -> None:
    """Commit a pending item an earlier sync found for the link's account, as the shared builder makes it unless told otherwise"""
    async with TestSession() as session:
        account = await session.get(Account, link.account_id)
        item = _build_pending_transaction(account, description)
        for field, value in values.items():
            setattr(item, field, value)
        session.add(item)
        await session.commit()


async def _store_bank_transaction(link: BankAccountLink, external_transaction_id: str, **values) -> uuid.UUID:
    """Commit a bank transaction the link's bank account sent, awaiting review as the shared builder makes it unless told otherwise

    Returns:
        Its id, the same as its review item's
    """
    _KNOWN_BANK_IDS.add(external_transaction_id)
    async with TestSession() as session:
        account = await session.get(Account, link.account_id)
        record = _build_bank_transaction(account, external_transaction_id, external_account_id=link.external_account_id)
        for field, value in values.items():
            setattr(record, field, value)
        session.add(record)
        await session.commit()
    return record.id


def _cut_off(*external_ids: str) -> FetchResult:
    """Return a response with 1,000 transactions or more, since Fake Bank may have cut it short"""
    return FetchResult(accounts=tuple(_bank_account(external_id) for external_id in external_ids), possibly_cut_off=True)


def _window(
    first_day: date,
    last_day: date,
    accounts: Sequence[str] = ("ACT-1",),
    *,
    pending: bool = False,
    timezone: ZoneInfo = _BRISBANE,
) -> tuple:
    """Return a fetch of the bank accounts from midnight on the first day to midnight after the last, in Brisbane unless told otherwise"""
    start = datetime(first_day.year, first_day.month, first_day.day, tzinfo=timezone)
    end = datetime(last_day.year, last_day.month, last_day.day, tzinfo=timezone) + timedelta(days=1)
    return tuple(sorted(accounts)), start, end, pending


def _fetched(provider: FakeProviderAdapter) -> list[tuple]:
    """Return each fetch the provider was asked for, in the shape _window builds"""
    return [(tuple(sorted(call.account_ids)), call.start, call.end, call.include_pending) for call in provider.fetches]


async def _run_jobs_until_none_is_due() -> None:
    """Run jobs one at a time until none is due, failing rather than looping if jobs keep coming"""
    for _ in range(_MOST_JOBS):
        if not await run_jobs(1):
            return
    pytest.fail(f"Jobs were still queued after {_MOST_JOBS} ran")


async def _checkpoints(*links: BankAccountLink) -> list[date]:
    """Return each link's committed checkpoint"""
    async with TestSession() as session:
        return [await session.scalar(select(BankAccountLink.checkpoint).where(BankAccountLink.id == link.id)) for link in links]


async def _link_states(*links: BankAccountLink) -> list[str]:
    """Return each link's committed state"""
    async with TestSession() as session:
        return [await session.scalar(select(BankAccountLink.state).where(BankAccountLink.id == link.id)) for link in links]


async def _set_owner_timezone(connection: BankConnection, timezone: ZoneInfo) -> None:
    """Commit the connection's owner's profile timezone"""
    async with TestSession() as session:
        (await session.get(User, connection.owner_id)).tz = timezone.key
        await session.commit()


async def _set_discovered_at(connection: BankConnection, discovered_at: datetime) -> None:
    """Commit when the connection's bank accounts were last listed"""
    async with TestSession() as session:
        await session.execute(update(BankConnection).where(BankConnection.id == connection.id).values(discovered_at=discovered_at))
        await session.commit()


async def _bring_next_syncs_round(connection: BankConnection, at: datetime) -> None:
    """Commit each of the connection's links as next syncing at this time, as a day passing would, though the clock is frozen"""
    async with TestSession() as session:
        await session.execute(update(BankAccountLink).where(BankAccountLink.connection_id == connection.id).values(next_attempt_at=at))
        await session.commit()


async def _next_sync(connection: BankConnection) -> datetime | None:
    """Return the connection's committed next scheduled sync"""
    async with TestSession() as session:
        return await session.scalar(select(BankConnection.next_sync_at).where(BankConnection.id == connection.id))


async def _set_next_sync(connection: BankConnection, at: datetime) -> None:
    """Commit the connection's next scheduled sync, as the job before set it"""
    async with TestSession() as session:
        await session.execute(update(BankConnection).where(BankConnection.id == connection.id).values(next_sync_at=at))
        await session.commit()


async def _schedule_next_sync(connection: BankConnection, now: datetime) -> None:
    """Work out and commit the connection's next scheduled sync as its owner, as a job ending does"""
    async with _owner_session(connection.owner_id) as session:
        await schedule_next_sync(session, await session.get(BankConnection, connection.id), now=now)
        await session.commit()


async def _free_requests(connection: BankConnection) -> None:
    """Let a day pass for the budget: the connection's requests leave it, and its queued job is due"""
    async with TestSession() as session:
        await session.execute(delete(BankProviderRequest).where(BankProviderRequest.connection_id == connection.id))
        await session.execute(update(BankConnection).where(BankConnection.id == connection.id).values(request_budget_spent_until=None))
        await session.execute(
            update(BankSyncJob).where(BankSyncJob.status == "queued").values(run_after=datetime.now(UTC) - timedelta(minutes=1))
        )
        await session.commit()


async def _free_oldest_request(connection: BankConnection) -> None:
    """Let the connection's oldest request leave the rolling day, and its queued job run, as when that request frees"""
    async with TestSession() as session:
        oldest = await session.scalar(
            select(func.min(BankProviderRequest.requested_at)).where(BankProviderRequest.connection_id == connection.id)
        )
        await session.execute(
            delete(BankProviderRequest).where(BankProviderRequest.connection_id == connection.id, BankProviderRequest.requested_at == oldest)
        )
        await session.execute(
            update(BankSyncJob).where(BankSyncJob.status == "queued").values(run_after=datetime.now(UTC) - timedelta(minutes=1))
        )
        await session.commit()


async def _replace_credential(connection: BankConnection) -> None:
    """Commit a new credential for the connection, as reconnecting it does"""
    async with TestSession() as session:
        await session.execute(update(BankConnection).where(BankConnection.id == connection.id).values(credential_encrypted=encrypt(_RENEWED)))
        await session.commit()


async def _listing(connection: BankConnection) -> tuple[bool, list[str]]:
    """Return whether the connection shows a listing pending, and the bank accounts it lists, as its owner sees them"""
    async with TestSession() as session:
        stored = await session.get(BankConnection, connection.id)
        [response] = await build_connection_responses(session, connection.owner_id, [stored])
    return response.discovery_pending, [account.external_id for account in response.accounts]


async def _told_at(connection: BankConnection) -> datetime | None:
    """Return when the owner's open pages were last told something changed, their data or a sync's status, or None when they never were"""
    async with TestSession() as session:
        return (await get_visible_cache_status(session, connection.owner_id)).personal.changed_at


class _HeldProvider(FakeProviderAdapter):
    """Waits in each request it holds, after the answer is decided, until the test releases it, as a slow provider would

    Requests are numbered from 1 in the order they are sent, listings and fetches alike
    """

    def __init__(self, held: Sequence[int] = (1,)) -> None:
        """Hold the requests numbered, the first unless told otherwise, none of them sent yet"""
        super().__init__()
        self.sent = 0
        self.sending = {number: asyncio.Event() for number in held}
        self.release = {number: asyncio.Event() for number in held}

    @override
    async def discover(self, credential: str, **options) -> FetchResult:
        return await self._answer(await super().discover(credential, **options))

    @override
    async def fetch(self, credential: str, **window) -> FetchResult:
        return await self._answer(await super().fetch(credential, **window))

    async def _answer(self, result: FetchResult) -> FetchResult:
        """Return the answer, holding a request it holds until released"""
        self.sent += 1
        if self.sent in self.sending:
            self.sending[self.sent].set()
            await self.release[self.sent].wait()
        return result


async def _jobs() -> list[tuple]:
    """Return each job's kind, status, error and the links it covered, oldest first"""
    async with TestSession() as session:
        rows = await session.execute(
            select(BankSyncJob.kind, BankSyncJob.status, BankSyncJob.last_error_kind, BankSyncJob.covered_link_ids).order_by(
                BankSyncJob.created_at
            )
        )
        return [(kind, status, error, set(covered or ())) for kind, status, error, covered in rows]


@pytest.mark.parametrize(
    ("values", "windows"),
    [
        (
            {"import_start": date(2026, 1, 1), "checkpoint": date(2025, 12, 31)},
            [
                _window(date(2026, 1, 1), date(2026, 3, 31)),
                _window(date(2026, 4, 1), date(2026, 6, 29)),
                _window(date(2026, 6, 30), date(2026, 9, 27)),
                _window(date(2026, 9, 28), _TODAY, pending=True),
            ],
        ),
        (
            {"import_start": date(2026, 1, 1), "checkpoint": date(2026, 4, 30), "last_success_at": datetime(2026, 4, 30, 9, tzinfo=_BRISBANE)},
            [_window(date(2026, 4, 16), date(2026, 7, 14)), _window(date(2026, 7, 15), _TODAY, pending=True)],
        ),
    ],
    ids=["import_from_1_january", "catch_up_after_the_worker_stopped_from_1_may"],
)
async def test_job_fetches_windows_of_at_most_90_days_one_job_after_another_until_today(connection, provider, values, windows):
    """A 12-month import and a catch-up after a long gap each fetch window after window, and only the last asks for pending

    The catch-up re-reads 14 days before its checkpoint, then carries on from the end of each window
    """
    link = await _link(connection, "ACT-1", **values)
    provider.outcomes = [_returned("ACT-1") for _ in windows]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == windows
    assert await _checkpoints(link) == [_TODAY]


async def test_job_fetches_a_new_links_import_alone_until_its_window_reaches_the_other_links_reread(connection, provider, frozen_now):
    """Savings, linked from 1 June, imports alone until its window reaches Everyday, due in 70 minutes, then both share it"""
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday(next_attempt_at=frozen_now + timedelta(minutes=70)))
    savings = await _link(connection, "ACT-savings", import_start=date(2026, 6, 1), checkpoint=date(2026, 5, 31))
    provider.outcomes = [_returned("ACT-savings"), _returned("ACT-savings", "ACT-everyday")]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [
        _window(date(2026, 6, 1), date(2026, 8, 29), ["ACT-savings"]),
        _window(date(2026, 8, 30), _TODAY, ["ACT-savings", "ACT-everyday"], pending=True),
    ]
    assert [covered for *_, covered in await _jobs()] == [{savings.id}, {savings.id, everyday.id}]
    assert await _checkpoints(everyday, savings) == [_TODAY, _TODAY]


async def test_job_keeps_records_and_moves_checkpoints_only_for_bank_accounts_the_response_brought_back_whole(connection, provider):
    """Savings has an error of its own, Card's bank login needs a sign-in and Travel didn't come back

    Only Everyday's coffee is kept and only its checkpoint moves, so the others' next sync re-reads those days
    """
    names = ("ACT-everyday", "ACT-savings", "ACT-card", "ACT-travel")
    links = [await _link(connection, name, **_synced_through_yesterday()) for name in names]
    provider.outcomes = [
        FetchResult(
            accounts=(
                _bank_account("ACT-everyday", records=[_record("TRN-coffee")]),
                _bank_account("ACT-savings", records=[_record("TRN-interest")]),
                _bank_account("ACT-card", login_key="CON-card", records=[_record("TRN-fuel")]),
            ),
            account_errors={"ACT-savings": ProviderError(ProviderErrorKind.TEMPORARY, "Fake Bank Online reported a problem")},
            login_errors={"CON-card": ProviderError(ProviderErrorKind.BANK_LOGIN_NEEDED, "Sign in to your bank again")},
        )
    ]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(BankTransaction.external_account_id, _BANK_ID) == [("ACT-everyday", "TRN-coffee")]
    assert await _checkpoints(*links) == [_TODAY, date(2026, 10, 3), date(2026, 10, 3), date(2026, 10, 3)]
    assert [(kind, status) for kind, status, *_ in await _jobs()] == [("scheduled", "succeeded"), ("retry", "queued")]


async def test_job_keeps_a_bank_transaction_by_the_keyed_hash_of_its_id_and_stores_a_resent_one_once(connection, provider):
    """Everyday's coffee is kept as the hash of the bank account and ID, never as the ID the bank sent

    A second job brings the same record back as the same transaction rather than a new one. That is
    what keeps a transaction the user approved or dismissed from returning for review
    """
    link = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    provider.outcomes = [_returned_with({"ACT-everyday": [_record("TRN-coffee")]}), _returned_with({"ACT-everyday": [_record("TRN-coffee")]})]

    for _ in range(2):
        await _seed_job(connection, BankSyncJobKind.MANUAL)
        assert await run_jobs(1) == 1

    stored = await _bank_transactions(BankTransaction.external_transaction_hash)
    assert stored == [(hash_bank_transaction_id(link.provider, "ACT-everyday", "TRN-coffee"),)]
    assert "TRN-coffee" not in stored[0][0]


class _CardFailingProvider(FakeProviderAdapter):
    """Brings back each bank account asked for whole, except Card, as its bank login needs a sign-in on every request"""

    @override
    async def fetch(self, credential: str, **window) -> FetchResult:
        accounts = tuple(
            _bank_account(external_id, login_key="CON-card" if external_id == "ACT-card" else "CON-harbour")
            for external_id in window["account_ids"]
        )
        problem = ProviderError(ProviderErrorKind.BANK_LOGIN_NEEDED, "Sign in to your bank again")
        self.outcomes = [FetchResult(accounts=accounts, login_errors={"CON-card": problem})]
        return await super().fetch(credential, **window)


async def test_job_leaves_out_a_link_whose_fetch_failed_and_syncs_the_others(connection, monkeypatch):
    """Card, importing from 1 January, fails on every request, so after its window fails the job goes on to Everyday's daily re-read"""
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    card = await _link(connection, "ACT-card", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    provider = _CardFailingProvider()
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [
        _window(date(2026, 1, 1), date(2026, 3, 31), ["ACT-card"]),
        _window(date(2026, 9, 19), _TODAY, ["ACT-everyday"], pending=True),
    ]
    assert await _checkpoints(everyday, card) == [_TODAY, date(2025, 12, 31)]
    assert [status for _, status, *_ in await _jobs()] == ["succeeded"]


async def test_job_ends_once_its_window_reaches_today_though_a_link_in_it_failed(connection, monkeypatch):
    """Sync now, with Everyday synced through today at 8 am and Card's bank login needing a sign-in, sends one request

    The window re-reads both through today, so nothing is left for Everyday once Card fails, and
    each Sync now while Card waits for a sign-in costs one request rather than two
    """
    await _link(
        connection, "ACT-everyday", **_synced_through_yesterday(checkpoint=_TODAY, last_success_at=datetime(2026, 10, 4, 8, tzinfo=_BRISBANE))
    )
    await _link(connection, "ACT-card", **_synced_through_yesterday())
    provider = _CardFailingProvider()
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 9, 19), _TODAY, ["ACT-card", "ACT-everyday"], pending=True)]


async def test_job_spends_a_request_that_frees_on_a_link_that_can_progress_before_one_that_just_failed(connection, monkeypatch, frozen_now):
    """Everyday and Card import from 1 January with one request left in the budget, and Card's bank login needs a sign-in

    The first window moves Everyday and fails Card, the job queued after it finds no request left,
    and the request that frees next fetches Everyday's following window rather than Card's again
    """
    everyday = await _link(connection, "ACT-everyday", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    card = await _link(connection, "ACT-card", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    await _spend_requests(connection, _DAILY_REQUESTS - 1, frozen_now - timedelta(hours=20))
    provider = _CardFailingProvider()
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    assert await run_jobs(1) == 1
    assert await run_jobs(1) == 1
    await _free_oldest_request(connection)
    assert await run_jobs(1) == 1

    assert _fetched(provider) == [
        _window(date(2026, 1, 1), date(2026, 3, 31), ["ACT-card", "ACT-everyday"]),
        _window(date(2026, 4, 1), date(2026, 6, 29), ["ACT-everyday"]),
    ]
    assert await _checkpoints(everyday, card) == [date(2026, 6, 29), date(2025, 12, 31)]


async def test_job_plans_a_link_an_earlier_job_found_failing_once_no_other_link_is_due(connection, provider):
    """Card failed in the job before, so it waits for the other links, and with Everyday paused for review it is the only one due

    Its window comes back whole, so the job queued after it no longer holds Card back
    """
    await _link(connection, "ACT-everyday", **_synced_through_yesterday(paused=True))
    card = await _link(connection, "ACT-card", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    provider.outcomes = [_returned("ACT-card")]
    await _seed_job(connection, BankSyncJobKind.INITIAL, deferred_link_ids=[card.id])

    assert await run_jobs(1) == 1

    assert _fetched(provider) == [_window(date(2026, 1, 1), date(2026, 3, 31), ["ACT-card"])]
    async with TestSession() as session:
        assert await session.scalar(select(BankSyncJob.deferred_link_ids).where(BankSyncJob.status == "queued")) == []


async def test_job_brings_up_to_date_a_link_whose_checkpoint_is_long_before_its_import_start(connection, provider):
    """The link's checkpoint is a month before its import start, so it needs nothing before 1 September and the window from then moves it"""
    link = await _link(connection, "ACT-1", import_start=date(2026, 9, 1), checkpoint=date(2026, 8, 1))
    provider.outcomes = [_returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 9, 1), _TODAY, pending=True)]
    assert await _checkpoints(link) == [_TODAY]


async def test_job_takes_days_in_the_profile_timezone_west_of_utc(connection, provider):
    """In Phoenix it's 8 pm on 3 October, already 4 October in UTC, and the link last synced at 7 pm on 2 October through that day

    So it re-reads from 18 September to 3 October. Dates taken in UTC would carry on from 3 October to 4 October
    """
    await _set_owner_timezone(connection, _PHOENIX)
    link = await _link(
        connection,
        "ACT-1",
        **_synced_through_yesterday(checkpoint=date(2026, 10, 2), last_success_at=datetime(2026, 10, 2, 19, tzinfo=_PHOENIX)),
    )
    provider.outcomes = [_returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 9, 18), date(2026, 10, 3), pending=True, timezone=_PHOENIX)]
    assert await _checkpoints(link) == [date(2026, 10, 3)]


async def test_job_imports_a_link_whose_import_starts_today(connection, provider):
    """A link imported from today needs one window of today. That window asks for pending transactions and brings it up to date"""
    link = await _link(connection, "ACT-1", import_start=_TODAY, checkpoint=date(2026, 10, 3))
    provider.outcomes = [_returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(_TODAY, _TODAY, pending=True)]
    assert await _checkpoints(link) == [_TODAY]


async def test_job_records_a_second_sync_the_same_day_as_the_links_last_success(connection, provider, frozen_now):
    """The link synced through today at 8 am and again at 1 pm, so it reads as synced at 1 pm though its checkpoint stays today

    The last successful sync is what the account's sync status is to show, so a Sync now that brings
    the bank account back whole has to move it
    """
    await _link(connection, "ACT-1", **_synced_through_yesterday(checkpoint=_TODAY, last_success_at=datetime(2026, 10, 4, 8, tzinfo=_BRISBANE)))
    provider.outcomes = [_returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 9, 20), _TODAY, pending=True)]
    async with TestSession() as session:
        assert (await session.execute(select(BankAccountLink.checkpoint, BankAccountLink.last_success_at))).one() == (_TODAY, frozen_now)


async def test_job_syncs_a_link_asked_for_now_while_it_waits_to_retry_and_leaves_the_others_to_their_retry(
    connection, provider, frozen_now, day_later
):
    """Everyday and Savings failed at 12:50 pm and retry at 1:20, and at 1 pm the user asks Everyday to sync now

    Everyday is fetched alone and next syncs tomorrow, while Savings still retries at 1:20, and its
    status reads as a retry. Left out, Everyday would skip the account the user sees failing
    """
    retry_at = frozen_now + timedelta(minutes=20)
    failed = _synced_through_yesterday(retry_count=1, last_failure_reason="Fake Bank Online reported a problem", next_attempt_at=retry_at)
    everyday = await _link(connection, "ACT-everyday", **failed)
    savings = await _link(connection, "ACT-savings", **failed)
    provider.outcomes = [_returned("ACT-everyday")]
    await _seed_job(connection, BankSyncJobKind.MANUAL, requested_link_ids=[everyday.id])

    assert await run_jobs(1) == 1

    assert _fetched(provider) == [_window(date(2026, 9, 19), _TODAY, ["ACT-everyday"], pending=True)]
    assert [(count, next_at) for *_, count, next_at in await _attempts(everyday, savings)] == [
        (0, frozen_now + day_later),
        (1, retry_at),
    ]


async def test_job_plans_a_link_asked_for_now_with_the_others_though_an_earlier_job_found_it_failing(connection, provider):
    """Card failed in the job before, so it would wait for Everyday's window, but the user asked Card to sync now

    So one request fetches both. Planning Card last would spend a second request on it
    """
    await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    card = await _link(connection, "ACT-card", **_synced_through_yesterday())
    provider.outcomes = [_returned("ACT-card", "ACT-everyday")]
    await _seed_job(connection, BankSyncJobKind.MANUAL, deferred_link_ids=[card.id], requested_link_ids=[card.id])

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 9, 19), _TODAY, ["ACT-card", "ACT-everyday"], pending=True)]


async def test_job_passes_a_link_asked_for_now_to_the_next_job_until_a_window_reaches_it(connection, provider, frozen_now, day_later):
    """Savings, linked from 1 June, is importing when the user asks Everyday, next due in 20 hours, to sync now

    Savings imports alone until its window reaches Everyday's re-read, in the job after the one asked
    for, and Everyday joins it there and next syncs tomorrow. Dropped by the first job, Everyday
    would wait for its daily sync
    """
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday(next_attempt_at=frozen_now + timedelta(hours=20)))
    savings = await _link(connection, "ACT-savings", import_start=date(2026, 6, 1), checkpoint=date(2026, 5, 31))
    provider.outcomes = [_returned("ACT-savings"), _returned("ACT-savings", "ACT-everyday")]
    await _seed_job(connection, BankSyncJobKind.MANUAL, requested_link_ids=[everyday.id])

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [
        _window(date(2026, 6, 1), date(2026, 8, 29), ["ACT-savings"]),
        _window(date(2026, 8, 30), _TODAY, ["ACT-savings", "ACT-everyday"], pending=True),
    ]
    assert await _checkpoints(everyday, savings) == [_TODAY, _TODAY]
    assert (await _attempts(everyday))[0][4] == frozen_now + day_later


async def test_job_syncing_a_link_asked_for_now_takes_in_one_due_within_12_hours_in_the_same_request(
    connection, provider, frozen_now, day_later
):
    """The user asks Everyday to sync now while Savings is due in 6 hours, with 6 of the connection's 20 requests used

    One request brings both up to date, so Savings next syncs a day on with Everyday and the
    connection has used 7. Left to its own time, Savings would spend another request in 6 hours
    """
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday(next_attempt_at=frozen_now + timedelta(hours=20)))
    savings = await _link(connection, "ACT-savings", **_synced_through_yesterday(next_attempt_at=frozen_now + timedelta(hours=6)))
    await _spend_requests(connection, 6, frozen_now - timedelta(hours=10))
    provider.outcomes = [_returned("ACT-everyday", "ACT-savings")]
    await _seed_job(connection, BankSyncJobKind.MANUAL, requested_link_ids=[everyday.id])

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 9, 19), _TODAY, ["ACT-everyday", "ACT-savings"], pending=True)]
    assert [next_at for *_, next_at in await _attempts(everyday, savings)] == [frozen_now + day_later, frozen_now + day_later]
    async with TestSession() as session:
        budget = await read_request_budget(session, await session.get(BankConnection, connection.id), now=frozen_now)
    assert (budget.used, budget.limit) == (7, _DAILY_REQUESTS)


async def test_job_whose_request_fails_records_the_failure_and_moves_no_checkpoint(connection, monkeypatch, frozen_now):
    """Fake Bank Online can't be reached: the job records why, the owner's open pages are told again as it ends, and the checkpoint stays

    The account shows why its attempt failed and keeps yesterday's last sync, and is retried 30
    minutes on
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    provider = _HeldProvider()
    provider.outcomes = [FetchResult(request_error=ProviderError(ProviderErrorKind.TEMPORARY, "Fake Bank Online couldn't be reached"))]
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await provider.sending[1].wait()
        told_while_fetching = await _told_at(connection)
        provider.release[1].set()
        await running

    assert await _checkpoints(link) == [date(2026, 10, 3)]
    assert [(kind, status, error) for kind, status, error, _ in await _jobs()] == [
        ("scheduled", "failed", "temporary"),
        ("retry", "queued", None),
    ]
    assert await _attempts(link) == [
        (_YESTERDAYS_SYNC, frozen_now, "Fake Bank Online couldn't be reached", 1, frozen_now + timedelta(minutes=30))
    ]
    assert await _queued_jobs() == [("retry", timedelta(minutes=30), False)]
    assert await _told_at(connection) > told_while_fetching


@pytest.mark.parametrize("cause", ["budget_spent", "provider_asked_to_slow_down"])
async def test_job_without_a_request_to_spend_queues_itself_for_when_one_frees(connection, provider, frozen_now, cause):
    """An import waits for the request budget rather than failing, and fetches nothing it can't count

    The oldest request in the rolling day leaves it 24 hours after it was sent, so the job runs again then
    """
    link = await _link(connection, "ACT-1", import_start=date(2026, 9, 1), checkpoint=date(2026, 8, 31))
    oldest = frozen_now - timedelta(hours=20)
    await _spend_requests(connection, _DAILY_REQUESTS if cause == "budget_spent" else 1, oldest)
    provider.outcomes = [FetchResult(request_error=ProviderError(ProviderErrorKind.RATE_LIMITED, "Fake Bank Online asked for fewer requests"))]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    assert await run_jobs(1) == 1

    assert len(provider.fetches) == (0 if cause == "budget_spent" else 1)
    assert [(kind, status) for kind, status, *_ in await _jobs()] == [("initial", "succeeded"), ("initial", "queued")]
    assert await _queued_jobs() == [("initial", oldest + timedelta(hours=24) - frozen_now, False)]
    assert await _checkpoints(link) == [date(2026, 8, 31)]


def _reported_a_problem() -> ProviderError:
    """Return an error of a bank account's own, and retrying may fix it"""
    return ProviderError(ProviderErrorKind.TEMPORARY, "Fake Bank Online reported a problem")


async def test_job_syncs_the_bank_accounts_it_brought_back_whole_and_retries_the_others_30_minutes_on(
    connection, provider, frozen_now, day_later
):
    """At 1 pm Everyday comes back whole, while Savings has an error of its own and Travel didn't come back

    Everyday reads as synced now and next syncs tomorrow. Savings and Travel keep yesterday's last
    sync, show why this attempt failed and are retried at 1:30 pm. The queued retry and the
    connection's next scheduled sync wait for that
    """
    everyday, savings, travel = [
        await _link(connection, name, **_synced_through_yesterday()) for name in ("ACT-everyday", "ACT-savings", "ACT-travel")
    ]
    provider.outcomes = [
        FetchResult(
            accounts=(_bank_account("ACT-everyday"), _bank_account("ACT-savings")), account_errors={"ACT-savings": _reported_a_problem()}
        )
    ]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    retry_at = frozen_now + timedelta(minutes=30)
    assert await _attempts(everyday, savings, travel) == [
        (frozen_now, frozen_now, None, 0, frozen_now + day_later),
        (_YESTERDAYS_SYNC, frozen_now, "Fake Bank Online reported a problem", 1, retry_at),
        (_YESTERDAYS_SYNC, frozen_now, "Fake Bank didn't return this account", 1, retry_at),
    ]
    assert await _queued_jobs() == [("retry", timedelta(minutes=30), False)]
    assert await _next_sync(connection) == retry_at


@pytest.mark.parametrize(
    ("failures_so_far", "failures", "wait"),
    [
        (0, 1, timedelta(minutes=30)),
        (1, 2, timedelta(minutes=60)),
        (2, 3, timedelta(minutes=90)),
        (3, 4, timedelta(hours=12)),
        (4, 1, timedelta(minutes=30)),
    ],
    ids=["first_failure", "first_retry", "second_retry", "third_retry", "attempt_after_the_rest"],
)
async def test_job_retries_a_failing_link_after_30_60_and_90_minutes_then_rests_12_hours_before_a_new_series(
    connection, provider, frozen_now, failures_so_far, failures, wait
):
    """A failure at 1 pm is retried at 1:30, 2:30 and 4 pm, then automatic sync rests until 4 am, and a failure then starts a new series

    Each case is the link's attempt due at 1 pm after the failures its series has had so far, and
    the queued retry waits for the attempt after it
    """
    link = await _link(
        connection,
        "ACT-1",
        **_synced_through_yesterday(retry_count=failures_so_far, next_attempt_at=frozen_now if failures_so_far else None),
    )
    provider.outcomes = [FetchResult(account_errors={"ACT-1": _reported_a_problem()})]
    await _seed_job(connection, BankSyncJobKind.RETRY if failures_so_far else BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert [(count, next_at) for *_, count, next_at in await _attempts(link)] == [(failures, frozen_now + wait)]
    assert await _queued_jobs() == [("retry", wait, False)]


@pytest.mark.parametrize("later_half", ["fails_for_the_bank_account", "request_fails"])
async def test_job_counts_a_window_fetched_in_halves_as_one_attempt_for_a_link_failing_in_both(connection, provider, frozen_now, later_half):
    """1 January to 31 March comes back cut short, the bank account has an error of its own in the earlier half, and the later half fails too

    The later half fails for the bank account alone or for its whole request, and either way the
    link's series has one failure
    """
    link = await _link(connection, "ACT-1", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    failing = FetchResult(account_errors={"ACT-1": _reported_a_problem()})
    unreachable = FetchResult(request_error=ProviderError(ProviderErrorKind.TEMPORARY, "Fake Bank Online couldn't be reached"))
    provider.outcomes = [_cut_off("ACT-1"), failing, failing if later_half == "fails_for_the_bank_account" else unreachable]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert len(provider.fetches) == 3
    assert [(count, next_at) for *_, count, next_at in await _attempts(link)] == [(1, frozen_now + timedelta(minutes=30))]


@pytest.mark.parametrize("cause", ["budget_spent", "provider_asked_to_slow_down"])
async def test_job_queues_a_retry_due_while_no_request_is_free_for_when_one_frees(connection, provider, frozen_now, cause):
    """A second retry fails at 1 pm, so the third is due at 2:30 pm, but no request is free until 5:10 pm

    Its request was the last the budget had, or the provider asked for fewer requests, so the retry
    is queued for 5:10 pm, rather than finding no request free at 2:30 pm
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday(retry_count=2, next_attempt_at=frozen_now))
    oldest = frozen_now - timedelta(hours=19, minutes=50)
    await _spend_requests(connection, _DAILY_REQUESTS - 1 if cause == "budget_spent" else 1, oldest)
    slow_down = ProviderError(ProviderErrorKind.RATE_LIMITED, "Fake Bank Online asked for fewer requests")
    provider.outcomes = [
        FetchResult(
            account_errors={"ACT-1": _reported_a_problem()},
            warnings=(slow_down,) if cause == "provider_asked_to_slow_down" else (),
        )
    ]
    await _seed_job(connection, BankSyncJobKind.RETRY)

    await _run_jobs_until_none_is_due()

    assert [next_at for *_, next_at in await _attempts(link)] == [frozen_now + timedelta(minutes=90)]
    assert await _queued_jobs() == [("retry", oldest + timedelta(hours=24) - frozen_now, False)]


async def test_job_for_a_retry_due_while_the_budget_is_spent_records_no_attempt_and_runs_once_a_request_frees(
    connection, provider, frozen_now, day_later
):
    """The third retry is due at 1 pm with no request free until 5:10 pm, so nothing is sent and the link still shows its last failure

    Waiting for a request is no attempt, so the series doesn't move on. Once a request frees the
    retry brings the bank account back whole. That ends the series and puts it back on the daily
    schedule
    """
    failed_at = frozen_now - timedelta(minutes=90)
    link = await _link(
        connection,
        "ACT-1",
        **_synced_through_yesterday(
            last_attempt_at=failed_at, last_failure_reason="Fake Bank Online reported a problem", retry_count=3, next_attempt_at=frozen_now
        ),
    )
    oldest = frozen_now - timedelta(hours=19, minutes=50)
    await _spend_requests(connection, _DAILY_REQUESTS, oldest)
    provider.outcomes = [_returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.RETRY)

    await _run_jobs_until_none_is_due()

    assert provider.fetches == []
    assert await _attempts(link) == [(_YESTERDAYS_SYNC, failed_at, "Fake Bank Online reported a problem", 3, frozen_now)]
    assert await _queued_jobs() == [("retry", oldest + timedelta(hours=24) - frozen_now, False)]

    await _free_oldest_request(connection)
    await _run_jobs_until_none_is_due()

    assert len(provider.fetches) == 1
    assert await _attempts(link) == [(frozen_now, frozen_now, None, 0, frozen_now + day_later)]
    assert await _queued_jobs() == []


@pytest.mark.parametrize("answer", ["listed_with_an_error_of_its_own", "left_out_of_the_response", "the_whole_request_failed"])
async def test_job_starts_no_retry_series_for_a_bank_account_whose_bank_needs_a_sign_in(connection, provider, frozen_now, day_later, answer):
    """Card's first retry finds its bank login needing a sign-in, and retrying can't fix a sign-in

    The response lists Card with an error of its own as well, or leaves it out, when the bank login
    its listing stored names it, or the whole request fails with the sign-in. Either way Card shows
    the sign-in as why it failed and leaves its retry series for the daily schedule, so no retry is
    queued and the connection's next sync is a day on, when the user may have signed in
    """
    card = await _link(connection, "ACT-card", **_synced_through_yesterday(retry_count=1, next_attempt_at=frozen_now))
    listed = _build_external_account(connection, "ACT-card")
    listed.login_key = "CON-card"
    async with TestSession() as session:
        session.add(listed)
        await session.commit()
    sign_in = ProviderError(ProviderErrorKind.BANK_LOGIN_NEEDED, "Sign in to your bank again")
    provider.outcomes = [
        FetchResult(request_error=sign_in)
        if answer == "the_whole_request_failed"
        else FetchResult(
            accounts=(_bank_account("ACT-card", login_key="CON-card"),) if answer == "listed_with_an_error_of_its_own" else (),
            account_errors={"ACT-card": _reported_a_problem()} if answer == "listed_with_an_error_of_its_own" else {},
            login_errors={"CON-card": sign_in},
        )
    ]
    await _seed_job(connection, BankSyncJobKind.RETRY)

    await _run_jobs_until_none_is_due()

    assert await _attempts(card) == [(_YESTERDAYS_SYNC, frozen_now, "Sign in to your bank again", 0, frozen_now + day_later)]
    assert await _queued_jobs() == []
    assert await _next_sync(connection) == frozen_now + day_later


async def test_job_whose_request_met_a_payment_problem_starts_no_retry_series(connection, provider, frozen_now, day_later):
    """Card's daily sync is refused with a payment problem, and waiting minutes can't fix that

    Card shows the payment problem as why it failed and rests until the next daily sync, with no
    retry queued, so the user's one request a day is all it spends while the problem stands
    """
    card = await _link(connection, "ACT-card", **_synced_through_yesterday())
    reason = "Fake Bank Online reports a payment problem"
    provider.outcomes = [FetchResult(request_error=ProviderError(ProviderErrorKind.PAYMENT_REQUIRED, reason))]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _attempts(card) == [(_YESTERDAYS_SYNC, frozen_now, reason, 0, frozen_now + day_later)]
    assert await _queued_jobs() == []
    assert await _next_sync(connection) == frozen_now + day_later


async def test_job_ending_on_a_rejected_credential_queues_no_retry_or_listing(connection, provider, frozen_now):
    """Everyday's import comes back in the bank's own points currency, then Savings' first retry finds the credential rejected

    Neither a retry nor a listing can work until the user reconnects, so nothing is queued. Savings
    shows the rejection and leaves its series, and Everyday shows the currency as the provider sent
    it, since a currency of the bank's own has no code
    """
    everyday = await _link(connection, "ACT-everyday", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    savings = await _link(connection, "ACT-savings", **_synced_through_yesterday(retry_count=1, next_attempt_at=frozen_now))
    provider.outcomes = [
        FetchResult(accounts=(_bank_account("ACT-everyday", currency=None, currency_raw="https://rewards.example/points"),)),
        FetchResult(
            request_error=ProviderError(ProviderErrorKind.CREDENTIAL_REJECTED, "Fake Bank Online rejected the stored access credential")
        ),
    ]
    await _seed_job(connection, BankSyncJobKind.RETRY)

    assert await run_jobs(1) == 1

    assert _fetched(provider) == [
        _window(date(2026, 1, 1), date(2026, 3, 31), ["ACT-everyday"]),
        _window(date(2026, 9, 19), _TODAY, ["ACT-savings"], pending=True),
    ]
    assert [(kind, status, error) for kind, status, error, _ in await _jobs()] == [("retry", "failed", "credential_rejected")]
    assert [attempt[2:] for attempt in await _attempts(everyday, savings)] == [
        ("Fake Bank now reports this bank account in https://rewards.example/points, not CAD", 1, frozen_now + timedelta(minutes=30)),
        ("Fake Bank Online rejected the stored access credential", 0, None),
    ]


def _rejected() -> ProviderError:
    """Return Fake Bank Online refusing the stored access"""
    return ProviderError(ProviderErrorKind.CREDENTIAL_REJECTED, "Fake Bank Online rejected the stored access credential")


async def _rejection(connection: BankConnection) -> datetime | None:
    """Return when the connection's credential was marked rejected, or None while it isn't"""
    async with TestSession() as session:
        return await session.scalar(select(BankConnection.credential_rejected_at).where(BankConnection.id == connection.id))


# The subject of each kind of action-needed email. test_action_needed pins its wording
_RECONNECT_SUBJECT = "Reconnect Fake Bank to resume syncing"
_SIGNIN_SUBJECT = "Sign in to your bank again in Fake Bank Online"
_CHOOSE_SUBJECT = "Choose a bank account again to resume syncing"


def _emailed(sent: Sequence[tuple[str, RenderedEmail]], *names: str) -> list[tuple[str, str, list[str]]]:
    """Return each email sent as its recipient, its subject and which of the names given its text mentions"""
    return [(recipient, message.subject, [name for name in names if name in message.text_body]) for recipient, message in sent]


def _email(subject: str, *names: str) -> tuple[str, str, list[str]]:
    """Return an email to the first connection's owner with the subject, mentioning the names, as _emailed gives it"""
    return ("owner0@example.com", subject, list(names))


async def test_job_ending_on_a_rejected_credential_marks_the_connection_reconnect_needed_and_emails_its_owner_once(
    connection, provider, frozen_now, sent_action_emails
):
    """Fake Bank Online refuses the stored access for Everyday's daily sync

    The connection is marked from when the refused request went out, and the owner is emailed once,
    naming every account still linked through it: Card, waiting for its bank account to be chosen
    again, too, but not Old, unlinked last month. A later sync sends nothing, and nothing more is emailed
    """
    await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    await _link(connection, "ACT-card", **_synced_through_yesterday(state=BankLinkState.CHOOSE_ACCOUNT))
    await _link(connection, "ACT-old", state=BankLinkState.UNLINKED, unlinked_at=frozen_now - timedelta(days=30))
    provider.outcomes = [FetchResult(request_error=_rejected())]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _rejection(connection) == frozen_now
    names = ("ACT-card", "ACT-everyday", "ACT-old")
    assert _emailed(sent_action_emails, *names) == [_email(_RECONNECT_SUBJECT, "ACT-card", "ACT-everyday")]

    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()

    assert len(provider.fetches) == 1
    assert [(status, error) for _, status, error, _ in await _jobs()] == [("failed", "credential_rejected"), ("succeeded", None)]
    assert len(sent_action_emails) == 1


async def test_job_whose_listing_meets_a_rejected_credential_marks_the_connection_and_emails_its_owner(
    connection, provider, frozen_now, sent_action_emails
):
    """The claim couldn't list the bank accounts, and the job flagged to list them finds the stored access refused

    Nothing is linked through the connection yet, and its owner is still told to reconnect it
    """
    provider.outcomes = [FetchResult(request_error=_rejected())]
    await _seed_job(connection, BankSyncJobKind.INITIAL, discover=True)

    await _run_jobs_until_none_is_due()

    assert await _rejection(connection) == frozen_now
    assert _emailed(sent_action_emails) == [_email(_RECONNECT_SUBJECT)]


async def test_job_ending_on_a_rejected_credential_marks_and_emails_only_for_that_connection_of_its_owner(
    connection, provider, frozen_now, sent_action_emails
):
    """The owner also syncs Joint through a second connection and Fake Bank Online still accepts it, when it refuses Everyday's

    Only Everyday's connection is marked, and the email and the accounts needing a reconnect name
    Everyday alone, while Joint carries on as before
    """
    other = _build_bank_connection(connection.owner_id)
    async with TestSession() as session:
        session.add(other)
        await session.commit()
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    joint = await _link(other, "ACT-joint", **_synced_through_yesterday())
    provider.outcomes = [FetchResult(request_error=_rejected())]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert (await _rejection(connection), await _rejection(other)) == (frozen_now, None)
    assert _emailed(sent_action_emails, "ACT-everyday", "ACT-joint") == [_email(_RECONNECT_SUBJECT, "ACT-everyday")]
    async with _owner_session(connection.owner_id) as session:
        needed = await action_needed.read_actions_needed(session, [everyday.account_id, joint.account_id])
    assert needed == {everyday.account_id: action_needed.ActionNeeded(action_needed.ActionNeededKind.RECONNECT, frozen_now)}


async def test_job_whose_listing_was_refused_marks_nothing_once_a_reconnect_replaced_the_credential(
    connection, provider, monkeypatch, sent_action_emails
):
    """The job's listing is refused, and the user reconnects after the job stored the failed listing but before the job ends

    The refusal was of the credential the reconnect replaced, so the connection isn't marked, no email
    goes out, and the job ends without failing
    """
    await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    provider.outcomes = [FetchResult(request_error=_rejected())]
    end_job = sync._end_job

    async def reconnect_first(*args, **kwargs):
        await _replace_credential(connection)
        return await end_job(*args, **kwargs)

    monkeypatch.setattr(sync, "_end_job", reconnect_first)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED, discover=True)

    await _run_jobs_until_none_is_due()

    assert await _rejection(connection) is None
    assert sent_action_emails == []
    assert [(status, error) for _, status, error, _ in await _jobs()] == [("succeeded", None)]


async def test_job_failing_on_a_server_this_instance_doesnt_allow_marks_nothing(connection, provider, sent_action_emails):
    """A development instance restored from production allows only its fake Bridge, so it refuses the connection's real one

    That says nothing about the credential or the bank login, so neither the connection nor Everyday
    is marked and its owner isn't emailed
    """
    await _list_under(connection, "CON-harbour", "Harbour Bank", "ACT-everyday")
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    provider.outcomes = [
        FetchResult(
            request_error=ProviderError(ProviderErrorKind.UNKNOWN, "This Lumina Finance server is not set up to contact bridge.example")
        )
    ]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert [(kind, status, error) for kind, status, error, _ in await _jobs()] == [
        ("scheduled", "failed", "unknown"),
        ("retry", "queued", None),
    ]
    assert (await _rejection(connection), await _signin_marks(everyday)) == (None, [None])
    assert sent_action_emails == []


async def test_job_whose_email_fails_to_send_keeps_everything_it_recorded(connection, provider, frozen_now, monkeypatch):
    """The mail server refuses the Reconnect needed email

    The email went out after the job's last step, so the job stays failed on the rejected credential,
    with the connection marked and Everyday's attempt recorded, rather than failing as stopped
    """
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    provider.outcomes = [FetchResult(request_error=_rejected())]

    async def refuse(recipient: str, message: RenderedEmail) -> None:
        raise ConnectionRefusedError("The mail server refused the connection")

    monkeypatch.setattr(email_contract, "_active_sender", SimpleNamespace(send=refuse))
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    async with asyncio.timeout(_WAIT_SECONDS):
        assert await run_jobs(1) == 1

    assert [(status, error) for _, status, error, _ in await _jobs()] == [("failed", "credential_rejected")]
    assert await _rejection(connection) == frozen_now
    assert [attempt[2:] for attempt in await _attempts(everyday)] == [("Fake Bank Online rejected the stored access credential", 0, None)]


_SIGNIN_REASON = "Fake Bank Online says your bank needs you to sign in again"


def _signin_needed() -> ProviderError:
    """Return Fake Bank Online saying a bank needs the user to sign in again"""
    return ProviderError(ProviderErrorKind.BANK_LOGIN_NEEDED, _SIGNIN_REASON)


async def _list_under(connection: BankConnection, login_key: str, institution: str, *external_ids: str) -> None:
    """Commit the bank accounts as the connection's last listing showed them, under one bank login at the institution"""
    async with TestSession() as session:
        for external_id in external_ids:
            listed = _build_external_account(connection, external_id)
            listed.login_key = login_key
            listed.institution_name = institution
            session.add(listed)
        await session.commit()


async def _signin_marks(*links: BankAccountLink) -> list[datetime | None]:
    """Return when each link was marked as waiting on a bank sign-in, or None for one that isn't"""
    async with TestSession() as session:
        return [await session.scalar(select(BankAccountLink.signin_needed_since).where(BankAccountLink.id == link.id)) for link in links]


async def test_job_finding_a_bank_login_needs_a_sign_in_marks_its_accounts_and_emails_once_while_the_others_sync(
    connection, provider, frozen_now, day_later, sent_action_emails
):
    """Fake Bank Online says the Chase login needs a sign-in, on a connection that also holds an Amex login

    Chase Checking and Chase Card are marked from when the request went out, and one email names
    both. Amex syncs, and no retry is queued for the Chase accounts. They wait for the next daily sync
    """
    await _list_under(connection, "CON-chase", "Chase", "ACT-chase-checking", "ACT-chase-card")
    await _list_under(connection, "CON-amex", "American Express", "ACT-amex")
    checking = await _link(connection, "ACT-chase-checking", **_synced_through_yesterday())
    card = await _link(connection, "ACT-chase-card", **_synced_through_yesterday())
    amex = await _link(connection, "ACT-amex", **_synced_through_yesterday())
    provider.outcomes = [FetchResult(accounts=(_bank_account("ACT-amex", login_key="CON-amex"),), login_errors={"CON-chase": _signin_needed()})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _signin_marks(checking, card, amex) == [frozen_now, frozen_now, None]
    names = ("ACT-amex", "ACT-chase-card", "ACT-chase-checking")
    assert _emailed(sent_action_emails, *names) == [_email(_SIGNIN_SUBJECT, "ACT-chase-card", "ACT-chase-checking")]
    assert [attempt[1:] for attempt in await _attempts(checking, card, amex)] == [
        (frozen_now, _SIGNIN_REASON, 0, frozen_now + day_later),
        (frozen_now, _SIGNIN_REASON, 0, frozen_now + day_later),
        (frozen_now, None, 0, frozen_now + day_later),
    ]
    assert await _queued_jobs() == []


async def test_job_finding_a_bank_login_still_needs_a_sign_in_emails_nothing_more(connection, provider, frozen_now, sent_action_emails):
    """Chase Checking has waited on a Chase sign-in since yesterday, and Chase Card, linked since, meets it too

    The login's state started yesterday and was emailed then, so nothing more is sent: Checking keeps
    when it was marked, and Card is marked from now
    """
    yesterday = frozen_now - timedelta(days=1)
    await _list_under(connection, "CON-chase", "Chase", "ACT-chase-checking", "ACT-chase-card")
    checking = await _link(connection, "ACT-chase-checking", **_synced_through_yesterday(signin_needed_since=yesterday))
    card = await _link(connection, "ACT-chase-card", import_start=date(2026, 9, 1), checkpoint=date(2026, 8, 31))
    provider.outcomes = [FetchResult(login_errors={"CON-chase": _signin_needed()})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert len(provider.fetches) == 1
    assert await _signin_marks(checking, card) == [yesterday, frozen_now]
    assert sent_action_emails == []


async def test_job_finding_two_bank_logins_need_a_sign_in_emails_only_for_the_one_not_already_waiting(
    connection, provider, frozen_now, sent_action_emails
):
    """Chase Checking has waited on a Chase sign-in since yesterday, and Fake Bank Online now says the Amex login needs one too

    Chase's state started yesterday and was emailed then, so only Amex's starts, and its email names Amex alone
    """
    yesterday = frozen_now - timedelta(days=1)
    await _list_under(connection, "CON-chase", "Chase", "ACT-chase-checking")
    await _list_under(connection, "CON-amex", "American Express", "ACT-amex")
    checking = await _link(connection, "ACT-chase-checking", **_synced_through_yesterday(signin_needed_since=yesterday))
    amex = await _link(connection, "ACT-amex", **_synced_through_yesterday())
    provider.outcomes = [FetchResult(login_errors={"CON-chase": _signin_needed(), "CON-amex": _signin_needed()})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _signin_marks(checking, amex) == [yesterday, frozen_now]
    assert _emailed(sent_action_emails, "ACT-amex", "ACT-chase-checking") == [_email(_SIGNIN_SUBJECT, "ACT-amex")]


async def test_job_marks_no_bank_sign_in_for_an_account_failing_for_another_reason(connection, provider, sent_action_emails):
    """Fake Bank Online reports a problem with Everyday alone, and a retry can fix it, so nothing asks the user to act"""
    await _list_under(connection, "CON-harbour", "Harbour Bank", "ACT-everyday")
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    provider.outcomes = [FetchResult(account_errors={"ACT-everyday": _reported_a_problem()})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _signin_marks(everyday) == [None]
    assert sent_action_emails == []


async def test_job_whose_request_needs_a_bank_sign_in_marks_every_account_in_it_and_emails_once_per_login(
    connection, provider, frozen_now, sent_action_emails
):
    """Fake Bank Online reports a bank sign-in problem naming no login, and it applies to every account in the request

    Chase Checking, under the Chase login, and Amex, under the Amex one, are both marked, and each
    login gets an email of its own
    """
    await _list_under(connection, "CON-chase", "Chase", "ACT-chase-checking")
    await _list_under(connection, "CON-amex", "American Express", "ACT-amex")
    checking = await _link(connection, "ACT-chase-checking", **_synced_through_yesterday())
    amex = await _link(connection, "ACT-amex", **_synced_through_yesterday())
    provider.outcomes = [FetchResult(request_error=_signin_needed())]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _signin_marks(checking, amex) == [frozen_now, frozen_now]
    assert _emailed(sent_action_emails, "ACT-amex", "ACT-chase-checking") == [
        _email(_SIGNIN_SUBJECT, "ACT-amex"),
        _email(_SIGNIN_SUBJECT, "ACT-chase-checking"),
    ]
    assert await _queued_jobs() == []


async def test_job_bringing_a_bank_login_back_clears_its_sign_in_and_emails_again_when_the_bank_next_asks(
    connection, provider, frozen_now, day_later, sent_action_emails
):
    """The user signed in to Chase again in Fake Bank Online, and the next daily sync brings Chase Checking back whole

    The daily sync tries Checking with no retry queued for it and clears its mark. That ends the
    login's state, since Chase Savings, unlinked while it waited on the same sign-in, doesn't keep it
    going. When a later sync finds the login needing a sign-in again, a new email goes out
    """
    yesterday = frozen_now - timedelta(days=1)
    await _list_under(connection, "CON-chase", "Chase", "ACT-chase-checking", "ACT-chase-savings")
    await _link(connection, "ACT-chase-savings", state=BankLinkState.UNLINKED, unlinked_at=yesterday, signin_needed_since=yesterday)
    checking = await _link(
        connection,
        "ACT-chase-checking",
        **_synced_through_yesterday(signin_needed_since=yesterday, last_attempt_at=yesterday, last_failure_reason=_SIGNIN_REASON),
    )
    provider.outcomes = [_returned("ACT-chase-checking")]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 9, 19), _TODAY, ["ACT-chase-checking"], pending=True)]
    assert await _signin_marks(checking) == [None]
    assert [attempt[1:] for attempt in await _attempts(checking)] == [(frozen_now, None, 0, frozen_now + day_later)]

    provider.outcomes = [FetchResult(login_errors={"CON-chase": _signin_needed()})]
    await _bring_next_syncs_round(connection, frozen_now)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()

    assert await _signin_marks(checking) == [frozen_now]
    assert _emailed(sent_action_emails, "ACT-chase-checking", "ACT-chase-savings") == [_email(_SIGNIN_SUBJECT, "ACT-chase-checking")]


async def test_job_clears_a_bank_sign_in_once_its_account_comes_back_whole_though_a_later_part_fails(connection, provider, frozen_now):
    """Chase Checking has waited on a Chase sign-in since yesterday, and the daily sync's window may be cut short, so it is fetched in halves

    The earlier half brings Checking back whole, though only over days it already has. That shows
    the login answering again, so its mark clears. The later half fails for a reason of its own.
    A retry handles it, and the mark stays cleared, so a later sign-in problem starts afresh
    """
    yesterday = frozen_now - timedelta(days=1)
    await _list_under(connection, "CON-chase", "Chase", "ACT-chase-checking")
    checking = await _link(connection, "ACT-chase-checking", **_synced_through_yesterday(signin_needed_since=yesterday))
    provider.outcomes = [
        _cut_off("ACT-chase-checking"),
        _returned("ACT-chase-checking"),
        FetchResult(account_errors={"ACT-chase-checking": _reported_a_problem()}),
    ]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    assert await run_jobs(1) == 1

    assert _fetched(provider) == [
        _window(date(2026, 9, 19), _TODAY, ["ACT-chase-checking"], pending=True),
        _window(date(2026, 9, 19), date(2026, 9, 26), ["ACT-chase-checking"]),
        _window(date(2026, 9, 27), _TODAY, ["ACT-chase-checking"], pending=True),
    ]
    assert await _signin_marks(checking) == [None]
    assert [attempt[2:4] for attempt in await _attempts(checking)] == [("Fake Bank Online reported a problem", 1)]


@pytest.mark.parametrize(
    ("answer", "rejects"),
    [
        (FetchResult(request_error=_rejected()), True),
        (FetchResult(request_error=_signin_needed()), False),
        (FetchResult(login_errors={"CON-chase": _signin_needed()}), False),
    ],
    ids=["credential_rejected", "sign_in_for_the_request", "sign_in_for_the_login"],
)
async def test_job_marks_what_the_user_must_do_from_when_its_request_went_out_not_when_it_saved(
    connection, provider, frozen_now, monkeypatch, answer, rejects
):
    """Fake Bank Online takes 2 minutes to refuse the stored access, or to say the Chase login needs a sign-in, for Chase Checking's daily sync

    The problem was seen as the request went out, so the mark starts then rather than as the job saved it
    """
    await _list_under(connection, "CON-chase", "Chase", "ACT-chase-checking")
    checking = await _link(connection, "ACT-chase-checking", **_synced_through_yesterday())
    provider.outcomes = [answer]
    fetch = provider.fetch
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    with freeze_time(frozen_now, real_asyncio=True) as clock:

        async def answer_2_minutes_later(credential: str, **window) -> FetchResult:
            """Answer as the scripted provider does, with the clock 2 minutes on"""
            result = await fetch(credential, **window)
            clock.tick(timedelta(minutes=2))
            return result

        monkeypatch.setattr(provider, "fetch", answer_2_minutes_later)
        assert await run_jobs(1) == 1

    marks = (frozen_now, [None]) if rejects else (None, [frozen_now])
    assert (await _rejection(connection), await _signin_marks(checking)) == marks


async def test_job_stopped_by_an_error_still_sends_the_email_an_earlier_step_saved(connection, provider, frozen_now, sent_action_emails):
    """The first window of Everyday's and Chase Card's imports may be cut short, so the job fetches it again in halves

    The earlier half finds the Chase login needing a sign-in, and the later half stops the job on an
    error. The step that marked Chase Card had saved, so its email still goes out as the job ends
    """
    await _list_under(connection, "CON-chase", "Chase", "ACT-chase-card")
    card = await _link(connection, "ACT-chase-card", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    await _link(connection, "ACT-everyday", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    provider.outcomes = [
        _cut_off("ACT-chase-card", "ACT-everyday"),
        FetchResult(accounts=(_bank_account("ACT-everyday"),), login_errors={"CON-chase": _signin_needed()}),
        RuntimeError("Unexpected bank data"),
    ]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert len(provider.fetches) == 3
    assert [(kind, status, error) for kind, status, error, _ in await _jobs()] == [("initial", "failed", "unknown")]
    assert await _signin_marks(card) == [frozen_now]
    assert _emailed(sent_action_emails, "ACT-chase-card", "ACT-everyday") == [_email(_SIGNIN_SUBJECT, "ACT-chase-card")]


# The Choose bank account email for Everyday, naming it and its bank account, listed as Everyday Chequing
_CHOOSE_EVERYDAY = _email(_CHOOSE_SUBJECT, "ACT-everyday", "Everyday Chequing")


@pytest.mark.parametrize("listed", ["not_at_all", "in_another_currency"])
async def test_job_whose_listing_moves_a_link_to_choose_bank_account_emails_once_naming_its_account(
    connection, provider, sent_action_emails, listed
):
    """The listing no longer shows Everyday's bank account, or shows it in US dollars, so Everyday waits for its bank account to be chosen again

    The owner gets one email naming Everyday and its bank account. The next listing still
    doesn't show it as before and sends nothing more
    """
    await _list_under(connection, "CON-harbour", "Harbour Bank", "ACT-everyday")
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    listing = FetchResult(accounts=(_bank_account("ACT-everyday", currency="USD"),)) if listed == "in_another_currency" else FetchResult()
    provider.outcomes = [listing, listing]

    for _ in range(2):
        await _seed_job(connection, BankSyncJobKind.MANUAL, discover=True)
        await _run_jobs_until_none_is_due()

    assert (len(provider.discoveries), provider.fetches) == (2, [])
    assert await _link_states(everyday) == ["choose_account"]
    assert _emailed(sent_action_emails, "ACT-everyday", "Everyday Chequing") == [_CHOOSE_EVERYDAY]


async def test_job_whose_listing_misses_a_whole_bank_login_emails_once_for_each_account_it_moves(connection, provider, sent_action_emails):
    """The listing no longer shows the Harbour Bank login, so Everyday and Savings both wait for their bank accounts to be chosen again

    Each gets an email of its own naming that account and its own bank account
    """
    await _list_under(connection, "CON-harbour", "Harbour Bank", "ACT-everyday", "ACT-savings")
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    savings = await _link(connection, "ACT-savings", **_synced_through_yesterday(external_account_name="High Interest Savings"))
    provider.outcomes = [FetchResult()]
    await _seed_job(connection, BankSyncJobKind.MANUAL, discover=True)

    await _run_jobs_until_none_is_due()

    assert await _link_states(everyday, savings) == ["choose_account", "choose_account"]
    names = ("ACT-everyday", "Everyday Chequing", "ACT-savings", "High Interest Savings")
    assert sorted(_emailed(sent_action_emails, *names)) == [_CHOOSE_EVERYDAY, _email(_CHOOSE_SUBJECT, "ACT-savings", "High Interest Savings")]


async def test_job_whose_listing_shows_a_bank_account_again_resumes_its_link_unannounced_and_emails_when_it_next_goes(
    connection, provider, sent_action_emails
):
    """Everyday's bank account leaves the listing, comes back before the user chooses one, and then leaves again

    Everyday returns to active with nothing sent as its bank account comes back, and leaving again
    starts the state again and emails again
    """
    await _list_under(connection, "CON-harbour", "Harbour Bank", "ACT-everyday")
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    provider.outcomes = [FetchResult(), _returned("ACT-everyday"), _returned("ACT-everyday"), FetchResult()]
    states = []
    for _ in range(3):
        await _seed_job(connection, BankSyncJobKind.MANUAL, discover=True)
        await _run_jobs_until_none_is_due()
        states += await _link_states(everyday)

    assert states == ["choose_account", "active", "choose_account"]
    assert len(provider.fetches) == 1
    assert _emailed(sent_action_emails, "ACT-everyday", "Everyday Chequing") == [_CHOOSE_EVERYDAY, _CHOOSE_EVERYDAY]


async def test_job_whose_listing_still_misses_a_bank_account_a_reconnect_left_to_choose_emails_nothing(
    connection, provider, sent_action_emails
):
    """A reconnect left Everyday waiting for its bank account to be chosen again, and the next listing still misses it

    Everyday was already waiting and the user saw that in the app as they reconnected, so no email goes out
    """
    await _list_under(connection, "CON-harbour", "Harbour Bank", "ACT-everyday")
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday(state=BankLinkState.CHOOSE_ACCOUNT))
    provider.outcomes = [FetchResult()]
    await _seed_job(connection, BankSyncJobKind.INITIAL, discover=True)

    await _run_jobs_until_none_is_due()

    assert len(provider.discoveries) == 1
    assert await _link_states(everyday) == ["choose_account"]
    assert sent_action_emails == []


@pytest.mark.parametrize(
    ("listed_hours_ago", "answer", "failing_call", "marked", "email"),
    [
        (1, FetchResult(request_error=_rejected()), 2, (True, False, "active"), _email(_RECONNECT_SUBJECT, "ACT-everyday")),
        (
            1,
            FetchResult(login_errors={"CON-harbour": _signin_needed()}),
            2,
            (False, True, "active"),
            _email(_SIGNIN_SUBJECT, "ACT-everyday"),
        ),
        (21, FetchResult(), 1, (False, False, "choose_account"), _CHOOSE_EVERYDAY),
    ],
    ids=["reconnect_needed_as_the_job_ends", "bank_sign_in_needed_as_a_part_is_written", "choose_bank_account_as_the_listing_is_stored"],
)
async def test_job_whose_save_starting_a_state_fails_emails_nothing_and_the_next_job_emails_once(
    connection, provider, frozen_now, monkeypatch, sent_action_emails, listed_hours_ago, answer, failing_call, marked, email
):
    """The commit of the save that would start a state fails, after the save recorded the state and told the owner's pages

    The state is Reconnect needed as the job ends, Bank sign-in needed as a part is written, or
    Choose bank account as the listing is stored. None started, so nothing is marked and no email
    goes out, and the job fails on the error. The connection's next job 30 minutes on meets the
    same answer. That starts the state from when that job's request went out and emails once
    """
    await _set_discovered_at(connection, frozen_now - timedelta(hours=listed_hours_ago))
    await _list_under(connection, "CON-harbour", "Harbour Bank", "ACT-everyday")
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    provider.outcomes = [answer, answer]
    mark_user_status_changed = sync.mark_user_status_changed
    calls = 0

    async def fail_to_commit() -> None:
        """Fail as a database that drops the connection mid-commit does, leaving the save uncommitted"""
        raise RuntimeError("The database dropped the connection while committing")

    async def fail_the_saves_commit(db, *args, **kwargs) -> None:
        """Tell the owner's pages, and in the first job's save starting the state, have that save's commit fail next"""
        nonlocal calls
        calls += 1
        await mark_user_status_changed(db, *args, **kwargs)
        if calls == failing_call:
            monkeypatch.setattr(db, "commit", fail_to_commit)

    async def states() -> tuple:
        """Return when the connection was marked rejected, when Everyday was marked as waiting on a sign-in, and its state"""
        return await _rejection(connection), await _signin_marks(everyday), await _link_states(everyday)

    monkeypatch.setattr(sync, "mark_user_status_changed", fail_the_saves_commit)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    with freeze_time(frozen_now, real_asyncio=True) as clock:
        assert await run_jobs(1) == 1
        assert (await states(), sent_action_emails) == ((None, [None], ["active"]), [])
        assert (await _jobs())[0][1:3] == ("failed", "unknown")

        # The next daily scan queues the connection's sync, merging into the retry the failed job queued, if any
        clock.tick(timedelta(minutes=30))
        async with _owner_session(connection.owner_id) as session:
            await enqueue_bank_sync_job(session, owner_id=connection.owner_id, connection_id=connection.id, kind=BankSyncJobKind.SCHEDULED)
            await session.commit()
        assert await run_jobs(1) == 1

    later = frozen_now + timedelta(minutes=30)
    rejected, signin_needed, state = marked
    assert await states() == (later if rejected else None, [later if signin_needed else None], [state])
    assert _emailed(sent_action_emails, "ACT-everyday", "Everyday Chequing") == [email]


def _sender_hanging_on_the_second_email(sent: list[tuple[str, RenderedEmail]]) -> SimpleNamespace:
    """Return a sender whose mail server takes the first email, noting it, and never answers the next, setting hanging as it starts to"""
    hanging = asyncio.Event()

    async def send(recipient: str, message: RenderedEmail) -> None:
        if sent:
            hanging.set()
            await asyncio.Event().wait()
        sent.append((recipient, message))

    return SimpleNamespace(send=send, hanging=hanging)


def _unsent(caplog: pytest.LogCaptureFixture) -> list[str]:
    """Return what the log says of each action-needed email left unsent"""
    return [record.getMessage() for record in caplog.records if record.name == action_needed.__name__ and "unsent" in record.getMessage()]


async def test_job_whose_mail_server_hangs_past_the_time_limit_logs_the_email_left_unsent_naming_no_one(
    connection, provider, frozen_now, monkeypatch, caplog, job_time_limits
):
    """The Chase and Amex logins both need a sign-in, and the mail server takes the Amex email but never answers the Chase one

    The job's time limit cuts that send off, so the Chase email alone is logged as unsent, by its
    state, its bank login and the connection, naming no address or account. Both marks stay, and the
    job stays failed on the sign-in rather than failing as stopped
    """
    await _list_under(connection, "CON-chase", "Chase", "ACT-chase-checking")
    await _list_under(connection, "CON-amex", "American Express", "ACT-amex")
    checking = await _link(connection, "ACT-chase-checking", **_synced_through_yesterday())
    amex = await _link(connection, "ACT-amex", **_synced_through_yesterday())
    provider.outcomes = [FetchResult(request_error=_signin_needed())]
    sent = []
    sender = _sender_hanging_on_the_second_email(sent)
    monkeypatch.setattr(email_contract, "_active_sender", sender)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    with caplog.at_level(logging.WARNING, logger=action_needed.__name__):
        async with asyncio.timeout(_WAIT_SECONDS):
            running = asyncio.create_task(run_jobs(1))
            await sender.hanging.wait()
            job_time_limits.end_running()
            assert await running == 1

    assert _emailed(sent, "ACT-amex", "ACT-chase-checking") == [_email(_SIGNIN_SUBJECT, "ACT-amex")]
    assert _unsent(caplog) == [
        f"The action-needed email for Bank sign-in needed for bank login CON-chase on connection {connection.id} was left unsent, "
        "as its job was stopped"
    ]
    assert await _signin_marks(checking, amex) == [frozen_now, frozen_now]
    assert [(status, error) for _, status, error, _ in await _jobs()] == [("failed", "bank_login_needed")]


async def test_job_stopped_by_its_time_limit_has_already_sent_the_email_its_listing_saved(
    connection, monkeypatch, caplog, sent_action_emails, job_time_limits
):
    """The listing moves Everyday to Choose bank account, and Savings's fetch then outlasts the job's time limit

    The email went out as the listing's save committed, so the owner is told though the job then
    fails as timed out, and no later job would tell them, since it finds Everyday already moved
    """
    await _list_under(connection, "CON-harbour", "Harbour Bank", "ACT-everyday", "ACT-savings")
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    await _link(connection, "ACT-savings", **_synced_through_yesterday())
    provider = _HeldProvider(held=(2,))
    provider.outcomes = [_returned("ACT-savings"), _returned("ACT-savings")]
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.MANUAL, discover=True)

    with caplog.at_level(logging.WARNING, logger=action_needed.__name__):
        async with asyncio.timeout(_WAIT_SECONDS):
            running = asyncio.create_task(run_jobs(1))
            await provider.sending[2].wait()
            job_time_limits.end_running()
            assert await running == 1

    assert await _link_states(everyday) == ["choose_account"]
    assert _emailed(sent_action_emails, "ACT-everyday", "Everyday Chequing") == [_CHOOSE_EVERYDAY]
    assert _unsent(caplog) == []
    assert [(kind, status, error) for kind, status, error, _ in await _jobs()] == [("manual", "failed", "temporary"), ("retry", "queued", None)]


async def test_job_stopped_by_its_time_limit_has_already_sent_the_email_a_part_saved(
    connection, frozen_now, monkeypatch, caplog, sent_action_emails, job_time_limits
):
    """The first window of Everyday's and Chase Card's imports may be cut short, so the job fetches it again in halves

    The earlier half finds the Chase login needing a sign-in, and the later half then outlasts the
    job's time limit. The email went out as the earlier half's save committed, so the owner is told
    though the job then fails as timed out
    """
    await _list_under(connection, "CON-chase", "Chase", "ACT-chase-card")
    card = await _link(connection, "ACT-chase-card", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    await _link(connection, "ACT-everyday", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    provider = _HeldProvider(held=(3,))
    provider.outcomes = [
        _cut_off("ACT-chase-card", "ACT-everyday"),
        FetchResult(accounts=(_bank_account("ACT-everyday"),), login_errors={"CON-chase": _signin_needed()}),
        _returned("ACT-everyday"),
    ]
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    with caplog.at_level(logging.WARNING, logger=action_needed.__name__):
        async with asyncio.timeout(_WAIT_SECONDS):
            running = asyncio.create_task(run_jobs(1))
            await provider.sending[3].wait()
            job_time_limits.end_running()
            assert await running == 1

    assert provider.sent == 3
    assert await _signin_marks(card) == [frozen_now]
    assert _emailed(sent_action_emails, "ACT-chase-card", "ACT-everyday") == [_email(_SIGNIN_SUBJECT, "ACT-chase-card")]
    assert _unsent(caplog) == []
    assert [(kind, status, error) for kind, status, error, _ in await _jobs()] == [("initial", "failed", "temporary")]


async def test_job_stopped_by_its_time_limit_keeps_the_success_a_link_already_recorded(connection, monkeypatch, frozen_now, job_time_limits):
    """The first window of Everyday's and Savings's imports is cut short, and the earlier half brings Everyday back whole and not Savings

    The later half outlasts the job's time limit. Savings keeps the failure the earlier half recorded, while Everyday keeps
    the success it recorded, with no failure for days it already brought in
    """
    everyday = await _link(connection, "ACT-everyday", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    savings = await _link(connection, "ACT-savings", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    provider = _HeldProvider(held=(3,))
    provider.outcomes = [_cut_off("ACT-everyday", "ACT-savings"), _returned("ACT-everyday"), _returned("ACT-everyday")]
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await provider.sending[3].wait()
        job_time_limits.end_running()
        assert await running == 1

    assert [attempt[2:4] for attempt in await _attempts(everyday)] == [(None, 0)]
    assert [attempt[2:4] for attempt in await _attempts(savings)] == [("Fake Bank didn't return this account", 1)]


async def test_job_the_worker_stops_on_an_error_fails_each_link_once(connection, provider, frozen_now):
    """Card's third retry fails in the job's first window, and the job then stops on an error while fetching Everyday

    Card's failure is already recorded, so it rests 12 hours as its series says, rather than failing
    again into a new series, and only Everyday takes the stopped job's failure
    """
    card = await _link(
        connection, "ACT-card", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31), retry_count=3, next_attempt_at=frozen_now
    )
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    provider.outcomes = [FetchResult(account_errors={"ACT-card": _reported_a_problem()}), RuntimeError("Unexpected bank data")]
    await _seed_job(connection, BankSyncJobKind.RETRY)

    await _run_jobs_until_none_is_due()

    assert len(provider.fetches) == 2
    assert [attempt[2:] for attempt in await _attempts(card, everyday)] == [
        ("Fake Bank Online reported a problem", 4, frozen_now + timedelta(hours=12)),
        ("The sync stopped because of an unexpected error", 1, frozen_now + timedelta(minutes=30)),
    ]


async def test_job_the_worker_stops_on_an_error_fails_only_the_links_this_attempt_did_not_bring_back(connection, provider, frozen_now):
    """Card failed for the second time in an earlier job, and Everyday's import came back whole for 1 January to 14 February in this one

    The job stops on an error fetching both for 15 February to 31 March, so Card's series moves on to
    its third failure and a retry 90 minutes on, while Everyday keeps the success it recorded, since
    a failure would start a retry series for days it already brought in. Its import carries on at
    the next scheduled sync
    """
    card = await _link(
        connection,
        "ACT-card",
        **_synced_through_yesterday(
            checkpoint=date(2026, 2, 28),
            last_attempt_at=frozen_now - timedelta(minutes=60),
            last_failure_reason="Fake Bank Online reported a problem",
            retry_count=2,
            next_attempt_at=frozen_now,
        ),
    )
    everyday = await _link(connection, "ACT-everyday", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    provider.outcomes = [_cut_off("ACT-card", "ACT-everyday"), _returned("ACT-everyday"), RuntimeError("Unexpected bank data")]
    await _seed_job(connection, BankSyncJobKind.RETRY)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [
        _window(date(2026, 1, 1), date(2026, 3, 31), ["ACT-card", "ACT-everyday"]),
        _window(date(2026, 1, 1), date(2026, 2, 14), ["ACT-everyday"]),
        _window(date(2026, 2, 15), date(2026, 3, 31), ["ACT-card", "ACT-everyday"]),
    ]
    assert await _attempts(card, everyday) == [
        (_YESTERDAYS_SYNC, frozen_now, "The sync stopped because of an unexpected error", 3, frozen_now + timedelta(minutes=90)),
        (frozen_now, frozen_now, None, 0, None),
    ]
    assert await _checkpoints(everyday) == [date(2026, 2, 14)]
    assert await _queued_jobs() == [("retry", timedelta(minutes=90), False)]


async def test_job_queues_a_retry_that_fell_due_while_it_ran_to_run_at_once(connection, monkeypatch, frozen_now):
    """Savings' retry is due at 1:00:05 pm, so the job starting at 1 pm syncs Everyday alone, and ends at 1:00:10 with the retry past due

    The retry is queued to run at once, rather than left until a job comes for another reason
    """
    await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    await _link(connection, "ACT-savings", **_synced_through_yesterday(retry_count=1, next_attempt_at=frozen_now + timedelta(seconds=5)))
    provider = _HeldProvider()
    provider.outcomes = [_returned("ACT-everyday")]
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await provider.sending[1].wait()
        with freeze_time(frozen_now + timedelta(seconds=10), real_asyncio=True):
            provider.release[1].set()
            assert await running == 1

    assert _fetched(provider) == [_window(date(2026, 9, 19), _TODAY, ["ACT-everyday"], pending=True)]
    assert await _queued_jobs() == [("retry", timedelta(0), False)]


async def test_job_leaving_a_due_retry_for_links_that_can_progress_retries_it_at_once(connection, provider, frozen_now, day_later):
    """Card failed in an earlier job and its retry is due, so this job plans it last, and Everyday's re-read reaches today without it

    The retry is queued again at once, with Card no longer held back, so the next job brings Card
    back whole, leaving Everyday, synced through today, for tomorrow
    """
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    card = await _link(connection, "ACT-card", **_synced_through_yesterday(retry_count=1, next_attempt_at=frozen_now))
    provider.outcomes = [_returned("ACT-everyday"), _returned("ACT-card")]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED, deferred_link_ids=[card.id])

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [
        _window(date(2026, 9, 19), _TODAY, ["ACT-everyday"], pending=True),
        _window(date(2026, 9, 19), _TODAY, ["ACT-card"], pending=True),
    ]
    assert [attempt[2:] for attempt in await _attempts(everyday, card)] == [
        (None, 0, frozen_now + day_later),
        (None, 0, frozen_now + day_later),
    ]


async def test_job_leaving_a_link_whose_bank_needs_a_sign_in_queues_nothing(connection, provider, frozen_now):
    """Card's bank needed a sign-in in the job before, so this job plans it last, and Everyday's re-read reaches today without it

    Card waits on no retry, so it waits for the next sync rather than having one queued for it at once
    """
    await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    card = await _link(
        connection, "ACT-card", **_synced_through_yesterday(last_attempt_at=frozen_now, last_failure_reason="Sign in to your bank again")
    )
    provider.outcomes = [_returned("ACT-everyday")]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED, deferred_link_ids=[card.id])

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 9, 19), _TODAY, ["ACT-everyday"], pending=True)]
    assert await _queued_jobs() == []


async def test_job_tells_the_owners_pages_as_a_part_records_a_failed_attempt(connection, monkeypatch):
    """A window cut short fails for the bank account in its earlier half, and the owner's open pages hear of it while the later half is out"""
    await _link(connection, "ACT-1", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    provider = _HeldProvider(held=(1, 3))
    provider.outcomes = [_cut_off("ACT-1"), FetchResult(account_errors={"ACT-1": _reported_a_problem()}), _returned("ACT-1")]
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await provider.sending[1].wait()
        told_as_it_started = await _told_at(connection)
        provider.release[1].set()
        await provider.sending[3].wait()
        told_after_the_earlier_half = await _told_at(connection)
        provider.release[3].set()
        await running

    assert told_after_the_earlier_half > told_as_it_started


async def test_job_fetches_a_window_whose_response_may_be_cut_short_again_in_two_halves(connection, provider):
    """1 January to 31 March brings back 1,000 transactions, so it is fetched again as two 45-day halves, each kept, and the import goes on"""
    link = await _link(connection, "ACT-1", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    provider.outcomes = [
        _cut_off("ACT-1"),
        _returned_with({"ACT-1": [_record("TRN-january", date(2026, 1, 20))]}),
        _returned_with({"ACT-1": [_record("TRN-march", date(2026, 3, 20))]}),
    ]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    assert await run_jobs(1) == 1

    assert _fetched(provider) == [
        _window(date(2026, 1, 1), date(2026, 3, 31)),
        _window(date(2026, 1, 1), date(2026, 2, 14)),
        _window(date(2026, 2, 15), date(2026, 3, 31)),
    ]
    assert await _bank_transactions(_BANK_ID) == [("TRN-january",), ("TRN-march",)]
    assert await _checkpoints(link) == [date(2026, 3, 31)]
    assert [(kind, status) for kind, status, *_ in await _jobs()] == [("initial", "succeeded"), ("initial", "queued")]


@pytest.mark.parametrize(
    ("requests_left", "checkpoint"),
    [(1, date(2025, 12, 31)), (2, date(2026, 2, 14))],
    ids=["only_for_the_whole_window", "for_the_whole_window_and_one_half"],
)
async def test_job_keeps_nothing_from_a_response_that_may_be_cut_short_but_keeps_each_half(
    connection, provider, frozen_now, requests_left, checkpoint
):
    """The budget runs out among the halves: the whole window moved nothing, a half fetched before moved the checkpoint, and the job waits"""
    link = await _link(connection, "ACT-1", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    oldest = frozen_now - timedelta(hours=20)
    await _spend_requests(connection, _DAILY_REQUESTS - requests_left, oldest)
    provider.outcomes = [_cut_off("ACT-1"), _returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    assert await run_jobs(1) == 1

    assert len(provider.fetches) == requests_left
    assert await _checkpoints(link) == [checkpoint]
    assert await _queued_jobs() == [("initial", oldest + timedelta(hours=24) - frozen_now, False)]


async def test_job_moves_no_checkpoint_past_a_half_that_failed_for_the_link(connection, provider):
    """The bank account has an error of its own in the earlier half, so the later half coming back whole can't move it past the days it lacks"""
    link = await _link(connection, "ACT-1", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    provider.outcomes = [
        _cut_off("ACT-1"),
        FetchResult(account_errors={"ACT-1": ProviderError(ProviderErrorKind.TEMPORARY, "Fake Bank Online reported a problem")}),
        _returned("ACT-1"),
    ]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert len(provider.fetches) == 3
    assert await _checkpoints(link) == [date(2025, 12, 31)]


async def test_job_never_moves_a_checkpoint_back_to_the_end_of_an_earlier_half(connection, frozen_now, provider):
    """The daily re-read from 19 September comes back cut short and the budget runs out after the earlier half, and that half ends 26 September

    That half brought the bank account back whole, but the link is complete through 3 October, so its checkpoint stays there
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    await _spend_requests(connection, _DAILY_REQUESTS - 2, frozen_now - timedelta(hours=20))
    provider.outcomes = [_cut_off("ACT-1"), _returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    assert await run_jobs(1) == 1

    assert _fetched(provider) == [_window(date(2026, 9, 19), _TODAY, pending=True), _window(date(2026, 9, 19), date(2026, 9, 26))]
    assert await _checkpoints(link) == [date(2026, 10, 3)]


async def test_job_keeps_a_single_day_whose_response_may_still_be_cut_short(connection, provider):
    """3 to 4 October comes back cut short, and so does each day alone, so each day is kept rather than split any further"""
    link = await _link(connection, "ACT-1", import_start=date(2026, 10, 3), checkpoint=date(2026, 10, 2))
    provider.outcomes = [_cut_off("ACT-1") for _ in range(3)]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [
        _window(date(2026, 10, 3), _TODAY, pending=True),
        _window(date(2026, 10, 3), date(2026, 10, 3)),
        _window(_TODAY, _TODAY, pending=True),
    ]
    assert await _checkpoints(link) == [_TODAY]


async def test_job_sends_nothing_for_a_rejected_connection(connection, provider, frozen_now):
    """A credential the provider rejected can't work until the user reconnects, so the job ends without spending a request

    Nor does it queue the retry Savings waits on, since that couldn't work either
    """
    await _link(connection, "ACT-1", **_synced_through_yesterday())
    await _link(connection, "ACT-savings", **_synced_through_yesterday(retry_count=1, next_attempt_at=frozen_now + timedelta(minutes=20)))
    async with TestSession() as session:
        await session.execute(
            update(BankConnection).where(BankConnection.id == connection.id).values(credential_rejected_at=datetime(2026, 10, 2, tzinfo=UTC))
        )
        await session.commit()
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    await _run_jobs_until_none_is_due()

    assert provider.fetches == []
    async with TestSession() as session:
        assert (await session.scalars(select(BankProviderRequest.id))).all() == []
    assert [status for _, status, *_ in await _jobs()] == ["succeeded"]


async def test_job_for_a_provider_turned_off_records_why_and_sends_nothing(connection, monkeypatch):
    """With the provider turned off in the environment, the job fails with a reason the account's sync details can show"""
    await _link(connection, "ACT-1", **_synced_through_yesterday())
    use_adapter(monkeypatch, FakeProviderAdapter(), enabled=False)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    async with TestSession() as session:
        assert (await session.execute(select(BankSyncJob.status, BankSyncJob.last_error_reason))).one() == (
            "failed",
            "Fake Bank is turned off on this server",
        )


async def test_job_for_a_provider_no_longer_installed_records_why_and_sends_nothing(connection, monkeypatch):
    """With the provider's folder gone from the server, the job fails saying so, and nothing is sent or scheduled"""
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    remove_provider(monkeypatch, FAKE_PROVIDER)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    async with TestSession() as session:
        assert (await session.execute(select(BankSyncJob.status, BankSyncJob.last_error_reason))).one() == ("failed", PROVIDER_GONE_DETAIL)
        assert (await session.scalars(select(BankProviderRequest.id))).all() == []
    assert await _checkpoints(link) == [date(2026, 10, 3)]


async def test_job_flagged_to_discover_lists_the_bank_accounts_a_claim_couldnt(connection, provider):
    """The claim's own listing failed, so it queued a job flagged to list them: the job does, and the listing stops showing as pending

    The connection was listed an hour ago, so only the flag sends this listing
    """
    provider.outcomes = [_returned("ACT-everyday", "ACT-savings")]
    await _seed_job(connection, BankSyncJobKind.RETRY, discover=True)
    assert await _listing(connection) == (True, [])

    await _run_jobs_until_none_is_due()

    assert (len(provider.discoveries), provider.fetches) == (1, [])
    assert await _listing(connection) == (False, ["ACT-everyday", "ACT-savings"])


async def test_listing_refreshes_the_provider_name_the_connection_stored(connection, provider):
    """A connection made while the provider went by another name stores its current name once a job lists its bank accounts"""
    async with TestSession() as session:
        await session.execute(update(BankConnection).where(BankConnection.id == connection.id).values(provider_name="Fake Bank Classic"))
        await session.commit()
    provider.outcomes = [_returned("ACT-everyday")]
    await _seed_job(connection, BankSyncJobKind.RETRY, discover=True)

    await _run_jobs_until_none_is_due()

    async with TestSession() as session:
        assert await session.scalar(select(BankConnection.provider_name).where(BankConnection.id == connection.id)) == "Fake Bank"


@pytest.mark.parametrize("cause", ["budget_spent", "provider_asked_to_slow_down"])
async def test_job_flagged_to_discover_keeps_the_listing_pending_until_a_request_frees(connection, provider, frozen_now, cause):
    """With no request to spend, the flagged job queues itself still flagged, and lists the bank accounts once a request frees"""
    oldest = frozen_now - timedelta(hours=20)
    await _spend_requests(connection, _DAILY_REQUESTS if cause == "budget_spent" else 1, oldest)
    if cause == "provider_asked_to_slow_down":
        provider.outcomes.append(
            FetchResult(request_error=ProviderError(ProviderErrorKind.RATE_LIMITED, "Fake Bank Online asked for fewer requests"))
        )
    provider.outcomes.append(_returned("ACT-everyday"))
    await _seed_job(connection, BankSyncJobKind.RETRY, discover=True)

    assert await run_jobs(1) == 1

    assert await _listing(connection) == (True, [])
    assert await _queued_jobs() == [("retry", oldest + timedelta(hours=24) - frozen_now, True)]

    await _free_requests(connection)
    assert await run_jobs(1) == 1

    assert await _listing(connection) == (False, ["ACT-everyday"])
    assert len(provider.discoveries) == (1 if cause == "budget_spent" else 2)


@pytest.mark.parametrize("cause", ["budget_spent", "provider_asked_to_slow_down"])
async def test_job_relisting_a_stale_listing_waits_for_a_request_without_showing_one_pending(connection, provider, frozen_now, cause):
    """A daily sync's rediscovery has no request to spend, so the job waits unflagged: the bank accounts are listed, only not lately"""
    await _link(connection, "ACT-1", **_synced_through_yesterday())
    async with TestSession() as session:
        session.add(_build_external_account(connection, "ACT-1"))
        await session.commit()
    await _set_discovered_at(connection, frozen_now - timedelta(days=2))
    oldest = frozen_now - timedelta(hours=20)
    await _spend_requests(connection, _DAILY_REQUESTS if cause == "budget_spent" else 1, oldest)
    provider.outcomes = [FetchResult(request_error=ProviderError(ProviderErrorKind.RATE_LIMITED, "Fake Bank Online asked for fewer requests"))]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    assert await run_jobs(1) == 1

    assert await _listing(connection) == (False, ["ACT-1"])
    assert await _queued_jobs() == [("scheduled", oldest + timedelta(hours=24) - frozen_now, False)]


@pytest.mark.parametrize(
    ("listed_ago", "values", "requests"),
    [
        (timedelta(hours=20), {}, (0, 1)),
        (timedelta(hours=20, minutes=1), {}, (1, 1)),
        (timedelta(hours=20, minutes=1), {"state": BankLinkState.CHOOSE_ACCOUNT}, (1, 1)),
        (timedelta(hours=20, minutes=1), {"state": BankLinkState.UNLINKED, "unlinked_at": datetime(2026, 10, 1, tzinfo=UTC)}, (0, 0)),
    ],
    ids=["listed_20_hours_ago", "listed_over_20_hours_ago", "link_waiting_for_its_bank_account", "link_unlinked"],
)
async def test_job_lists_the_bank_accounts_first_once_the_last_listing_is_over_20_hours_old(
    connection, provider, frozen_now, listed_ago, values, requests
):
    """A daily sync rediscovers its connection each day, even starting hours earlier than the day before, and never twice within 20 hours

    A link waiting for its bank account to return goes back to active when the listing shows it, and
    syncs in the same job. A connection whose only link was unlinked has nothing a listing could change
    """
    await _link(connection, "ACT-1", **_synced_through_yesterday(**values))
    await _set_discovered_at(connection, frozen_now - listed_ago)
    provider.outcomes = [_returned("ACT-1"), _returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert (len(provider.discoveries), len(provider.fetches)) == requests


async def test_job_fetches_nothing_for_a_linked_bank_account_its_listing_no_longer_shows(connection, provider, frozen_now):
    """Everyday's bank account is gone from a stale listing, so Everyday waits for it to be chosen again and only Savings syncs"""
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    savings = await _link(connection, "ACT-savings", **_synced_through_yesterday())
    async with TestSession() as session:
        session.add_all([_build_external_account(connection, "ACT-everyday"), _build_external_account(connection, "ACT-savings")])
        await session.commit()
    await _set_discovered_at(connection, frozen_now - timedelta(days=2))
    provider.outcomes = [_returned("ACT-savings"), _returned("ACT-savings")]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 9, 19), _TODAY, ["ACT-savings"], pending=True)]
    assert await _link_states(everyday, savings) == ["choose_account", "active"]
    assert await _checkpoints(everyday, savings) == [date(2026, 10, 3), _TODAY]


def _ramen_in_yen() -> ProviderRecord:
    """Return a 1,500 yen meal, and an account in Canadian dollars would read it as $15.00"""
    return _record("TRN-ramen", amount=-1500, raw_amount="-1500", description="RAMEN BAR")


async def test_job_stores_nothing_for_a_bank_account_a_fetch_lists_in_another_currency_and_lists_the_bank_accounts_next(connection, provider):
    """Sync now, with no listing due, finds Everyday's bank account in yen, though Everyday is in Canadian dollars

    Everyday keeps nothing and its checkpoint stays, while Savings syncs. The next job lists the bank
    accounts first. That leaves Everyday waiting for a bank account to be chosen
    """
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    savings = await _link(connection, "ACT-savings", **_synced_through_yesterday())
    provider.outcomes = [
        FetchResult(
            accounts=(
                _bank_account("ACT-everyday", records=[_ramen_in_yen()], currency="JPY"),
                _bank_account("ACT-savings", records=[_record("TRN-interest", amount=3_20, raw_amount="3.20")]),
            )
        ),
        FetchResult(accounts=(_bank_account("ACT-everyday", currency="JPY"), _bank_account("ACT-savings"))),
    ]
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    assert await run_jobs(1) == 1

    assert await _bank_transactions(BankTransaction.external_account_id, _BANK_ID) == [("ACT-savings", "TRN-interest")]
    assert await _checkpoints(everyday, savings) == [date(2026, 10, 3), _TODAY]
    assert (await _attempts(everyday))[0][2] == "Fake Bank now reports this bank account in JPY, not CAD"
    async with TestSession() as session:
        assert (await session.scalars(select(BankSyncJob.discover).where(BankSyncJob.status == "queued"))).all() == [True]

    await _run_jobs_until_none_is_due()

    # Savings, synced through today, waits for tomorrow, so the listing is all the next job sends
    assert (len(provider.discoveries), len(provider.fetches)) == (1, 1)
    assert await _link_states(everyday, savings) == ["choose_account", "active"]
    assert await _bank_transactions(_BANK_ID) == [("TRN-interest",)]


async def test_job_that_listed_a_bank_account_in_its_accounts_currency_queues_no_listing_when_its_fetch_disagrees(
    connection, provider, frozen_now
):
    """The daily sync's listing shows Everyday's bank account in Canadian dollars, and its fetch in yen

    Nothing is stored and the checkpoint stays, but no listing is queued, so a provider whose answers
    disagree can't have one job after another spend requests on them. Only the retry 30 minutes on
    is queued, and it doesn't list first
    """
    link = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    await _set_discovered_at(connection, frozen_now - timedelta(days=2))
    provider.outcomes = [
        _returned("ACT-everyday"),
        FetchResult(accounts=(_bank_account("ACT-everyday", records=[_ramen_in_yen()], currency="JPY"),)),
    ]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert (len(provider.discoveries), len(provider.fetches)) == (1, 1)
    assert await _bank_transactions(_BANK_ID) == []
    assert (await _link_states(link), await _checkpoints(link)) == (["active"], [date(2026, 10, 3)])
    assert [status for _, status, *_ in await _jobs()] == ["succeeded", "queued"]
    assert await _queued_jobs() == [("retry", timedelta(minutes=30), False)]


async def test_job_whose_listing_fails_records_it_and_fetches_nothing(connection, provider, frozen_now):
    """Fake Bank Online couldn't be reached for a stale listing, so the connection and the job record it, and no window is sent

    The listing was the attempt of the link the job was to sync, so the link records the failure too
    and is retried 30 minutes on. Savings wasn't to sync, since its retry isn't due for 20 minutes, so
    it keeps its own record, and the retry is queued for Savings' sooner one
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    savings_failed_at = frozen_now - timedelta(minutes=10)
    savings_attempt = (_YESTERDAYS_SYNC, savings_failed_at, "Fake Bank Online reported a problem", 1, frozen_now + timedelta(minutes=20))
    savings = await _link(
        connection,
        "ACT-savings",
        **_synced_through_yesterday(
            last_attempt_at=savings_failed_at,
            last_failure_reason="Fake Bank Online reported a problem",
            retry_count=1,
            next_attempt_at=frozen_now + timedelta(minutes=20),
        ),
    )
    await _set_discovered_at(connection, frozen_now - timedelta(days=2))
    provider.outcomes = [FetchResult(request_error=ProviderError(ProviderErrorKind.TEMPORARY, "Fake Bank Online couldn't be reached"))]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert provider.fetches == []
    async with TestSession() as session:
        assert await session.scalar(select(BankConnection.discovery_failed_at).where(BankConnection.id == connection.id)) == frozen_now
    assert [(kind, status, error) for kind, status, error, _ in await _jobs()] == [
        ("scheduled", "failed", "temporary"),
        ("retry", "queued", None),
    ]
    assert await _checkpoints(link) == [date(2026, 10, 3)]
    assert await _attempts(link, savings) == [
        (_YESTERDAYS_SYNC, frozen_now, "Fake Bank Online couldn't be reached", 1, frozen_now + timedelta(minutes=30)),
        savings_attempt,
    ]
    assert await _queued_jobs() == [("retry", timedelta(minutes=20), False)]


async def test_job_finishing_waits_for_the_connection_before_locking_its_links(connection, monkeypatch):
    """An unlink holding the connection locks Everyday's link while the job waits to write, and the job then leaves Everyday alone

    Whatever writes a connection's links locks the connection, then the job, then the links, so a job
    that locked its links first could deadlock with an unlink
    """
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    provider = _HeldProvider()
    provider.outcomes = [_returned("ACT-everyday")]
    use_adapter(monkeypatch, provider)
    job = await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await provider.sending[1].wait()
        async with TestSession() as unlinking:
            blocker_pid = await unlinking.scalar(text("SELECT pg_backend_pid()"))
            await unlinking.execute(select(BankConnection.id).where(BankConnection.id == connection.id).with_for_update())
            provider.release[1].set()
            await _wait_until_waiting_on(blocker_pid, running)

            await unlinking.execute(text("SET LOCAL lock_timeout = '2s'"))
            await unlinking.execute(
                update(BankAccountLink)
                .where(BankAccountLink.id == everyday.id)
                .values(state=BankLinkState.UNLINKED, unlinked_at=datetime(2026, 10, 4, tzinfo=UTC))
            )
            await unlinking.commit()
        assert await running == 1

    assert await _checkpoints(everyday) == [date(2026, 10, 3)]
    assert await _job_states() == {job.id: ("succeeded", 1)}


async def test_job_sends_each_request_with_the_credential_stored_when_it_is_counted(connection, provider, monkeypatch):
    """A reconnect replaces the credential once the job stored its listing, so the window counted next goes out with the new one and is kept"""
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    provider.outcomes = [_returned("ACT-1"), _returned("ACT-1")]

    async def reconnect_before_the_window_is_counted(db, counted, *, purpose, now) -> None:
        """Commit the reconnect just before the window's request is counted"""
        if purpose == ProviderRequestPurpose.SYNC:
            await _replace_credential(connection)
        await reserve_provider_request(db, counted, purpose=purpose, now=now)

    monkeypatch.setattr(sync, "reserve_provider_request", reconnect_before_the_window_is_counted)
    await _seed_job(connection, BankSyncJobKind.RETRY, discover=True)

    await _run_jobs_until_none_is_due()

    assert provider.discoveries == [_CREDENTIAL]
    assert [call.credential for call in provider.fetches] == [_RENEWED]
    assert await _checkpoints(link) == [_TODAY]


@pytest.mark.parametrize(
    "answer",
    [
        _returned_with({"ACT-1": [_record("TRN-coffee")]}),
        FetchResult(request_error=ProviderError(ProviderErrorKind.CREDENTIAL_REJECTED, "Fake Bank Online rejected the access URL")),
        FetchResult(
            accounts=(_bank_account("ACT-1", records=[_record("TRN-coffee")]),),
            warnings=(ProviderError(ProviderErrorKind.RATE_LIMITED, "Fake Bank Online says the daily quota is used up"),),
        ),
    ],
    ids=["brought_back_whole", "credential_rejected", "quota_spent"],
)
async def test_job_stores_nothing_from_a_window_sent_with_a_credential_replaced_while_it_was_out(connection, monkeypatch, answer):
    """A reconnect stores a new credential while the window's request is out, so the answer to the old one is dropped

    It keeps no record, moves no checkpoint, doesn't fail the job, and doesn't count the budget as spent for the new credential
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    provider = _HeldProvider()
    provider.outcomes = [answer]
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await provider.sending[1].wait()
        await _replace_credential(connection)
        provider.release[1].set()
        assert await running == 1

    assert await _bank_transactions(BankTransaction.id) == []
    assert await _checkpoints(link) == [date(2026, 10, 3)]
    assert [(status, error) for _, status, error, _ in await _jobs()] == [("succeeded", None)]
    async with TestSession() as session:
        assert await session.scalar(select(BankConnection.request_budget_spent_until).where(BankConnection.id == connection.id)) is None


async def test_job_stores_nothing_from_a_listing_sent_with_a_credential_replaced_while_it_was_out(connection, monkeypatch, frozen_now):
    """A reconnect stores a new credential while the job's listing is out with the old one, and the old one lists no bank account

    That listing is dropped: the link stays active, the connection keeps when it was listed, and the job neither fails nor sends a window
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    async with TestSession() as session:
        session.add(_build_external_account(connection, "ACT-1"))
        await session.commit()
    provider = _HeldProvider()
    provider.outcomes = [FetchResult()]
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.RETRY, discover=True)

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await provider.sending[1].wait()
        await _replace_credential(connection)
        provider.release[1].set()
        assert await running == 1

    assert await _link_states(link) == ["active"]
    async with TestSession() as session:
        listed = (
            await session.execute(
                select(BankConnection.discovered_at, BankConnection.discovery_failed_at).where(BankConnection.id == connection.id)
            )
        ).one()
    assert tuple(listed) == (frozen_now - timedelta(hours=1), None)
    assert [(status, error) for _, status, error, _ in await _jobs()] == [("succeeded", None)]
    assert provider.fetches == []


async def test_job_tells_the_owners_pages_as_it_starts_syncing_its_links_and_as_each_half_moves_a_checkpoint(connection, monkeypatch):
    """1 January to 31 March comes back cut short, so the job fetches it in halves, and the owner's open pages hear of each step as it lands

    They are told once the links the job syncs are recorded, before the first request goes out, and
    again once the earlier half moves the checkpoint, while the later half is still out
    """
    await _link(connection, "ACT-1", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    provider = _HeldProvider(held=(1, 3))
    provider.outcomes = [_cut_off("ACT-1"), _returned("ACT-1"), _returned("ACT-1")]
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.INITIAL)
    assert await _told_at(connection) is None

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await provider.sending[1].wait()
        told_as_it_started = await _told_at(connection)
        provider.release[1].set()
        await provider.sending[3].wait()
        told_after_the_earlier_half = await _told_at(connection)
        provider.release[3].set()
        await running

    assert told_as_it_started is not None
    assert told_after_the_earlier_half > told_as_it_started


async def test_job_tells_the_owners_pages_as_it_stores_its_listing(connection, provider, frozen_now, monkeypatch):
    """A stale listing finds Savings new and Everyday's bank account gone, and the owner's open pages hear of both as it is stored

    The job tells them again as it ends, so what they heard is read as the job goes back to the
    links once the listing is stored, before anything else it writes
    """
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    async with TestSession() as session:
        session.add(_build_external_account(connection, "ACT-everyday"))
        await session.commit()
    await _set_discovered_at(connection, frozen_now - timedelta(days=2))
    provider.outcomes = [_returned("ACT-savings")]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    told = []
    read_links = sync._JobRun._read_links

    async def read_links_noting_what_the_pages_heard(run):
        """Note when the owner's pages were last told, then read the links as the job does"""
        told.append(await _told_at(connection))
        return await read_links(run)

    monkeypatch.setattr(sync._JobRun, "_read_links", read_links_noting_what_the_pages_heard)

    await _run_jobs_until_none_is_due()

    before_the_listing, once_it_is_stored = told
    assert await _link_states(everyday) == ["choose_account"]
    assert (await _listing(connection))[1] == ["ACT-savings"]
    assert before_the_listing is None
    assert once_it_is_stored is not None


async def test_job_tells_the_owners_pages_of_a_balance_a_part_stores_with_nothing_else(connection, provider, monkeypatch):
    """1 January to 31 March comes back cut short, the earlier half fails for the bank account, and the later half brings back its new balance

    The bank account lacks the earlier half's days, so the later half moves no checkpoint, records
    no attempt and stores no records, yet the owner's open pages still hear of the balance it stores
    """
    await _link(connection, "ACT-1", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    async with TestSession() as session:
        session.add(_build_external_account(connection, "ACT-1"))
        await session.commit()
    provider.outcomes = [
        _cut_off("ACT-1"),
        FetchResult(account_errors={"ACT-1": _reported_a_problem()}),
        FetchResult(accounts=(replace(_bank_account("ACT-1"), balance=250_00),)),
    ]
    told: dict[date, tuple[datetime | None, datetime | None]] = {}
    write = sync._JobRun._write

    async def write_noting_what_the_pages_heard(run, part, *args, **kwargs):
        """Note when the owner's pages were last told before and after the part is written"""
        before = await _told_at(connection)
        moved = await write(run, part, *args, **kwargs)
        told[part.first_day] = (before, await _told_at(connection))
        return moved

    monkeypatch.setattr(sync._JobRun, "_write", write_noting_what_the_pages_heard)
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    before_the_later_half, once_it_is_stored = told[date(2026, 2, 15)]
    assert once_it_is_stored > before_the_later_half


@pytest.mark.parametrize(
    ("listed_at", "kept"),
    [
        pytest.param(datetime(2026, 10, 3, 9, tzinfo=UTC), (250_00, 240_00, datetime(2026, 10, 4, 2, tzinfo=UTC)), id="older-listing"),
        pytest.param(datetime(2026, 10, 4, 2, 30, tzinfo=UTC), (100_00, None, datetime(2026, 10, 4, 2, 30, tzinfo=UTC)), id="newer-listing"),
    ],
)
async def test_job_stores_the_balance_its_fetch_read_over_an_older_one(connection, provider, listed_at, kept):
    """Sync now reads Everyday's $250.00, $240.00 available, as of 2 am UTC, so the bank link shows it without waiting for a listing

    It replaces the $100.00 a listing stored as of an earlier time, but not one a listing read later
    """
    await _link(connection, "ACT-1", **_synced_through_yesterday())
    listed = _build_external_account(connection, "ACT-1")
    listed.balance, listed.balance_at = 100_00, listed_at
    async with TestSession() as session:
        session.add(listed)
        await session.commit()
    read = replace(_bank_account("ACT-1"), balance=250_00, available_balance=240_00, balance_at=datetime(2026, 10, 4, 2, tzinfo=UTC))
    provider.outcomes = [FetchResult(accounts=(read,))]
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    await _run_jobs_until_none_is_due()

    async with TestSession() as session:
        stored = await session.execute(
            select(BankExternalAccount.balance, BankExternalAccount.available_balance, BankExternalAccount.balance_at).where(
                BankExternalAccount.connection_id == connection.id
            )
        )
    assert [tuple(row) for row in stored] == [kept]


async def test_job_flags_an_available_balance_its_fetch_could_not_read(connection, provider):
    """Sync now reads Everyday's available balance with more decimals than its currency holds, so the bank link says so

    A listing read the same $100.00 at the same time with no available balance, so the flag is all that changes
    """
    await _link(connection, "ACT-1", **_synced_through_yesterday())
    listed = _build_external_account(connection, "ACT-1")
    listed.balance, listed.balance_at = 100_00, datetime(2026, 10, 4, tzinfo=UTC)
    async with TestSession() as session:
        session.add(listed)
        await session.commit()
    read = replace(_bank_account("ACT-1"), available_balance_unreadable=True)
    provider.outcomes = [FetchResult(accounts=(read,))]
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    await _run_jobs_until_none_is_due()

    async with TestSession() as session:
        stored = await session.execute(
            select(BankExternalAccount.balance, BankExternalAccount.available_balance, BankExternalAccount.available_balance_unreadable).where(
                BankExternalAccount.connection_id == connection.id
            )
        )
    assert [tuple(row) for row in stored] == [(100_00, None, True)]


async def test_job_stores_nothing_for_a_link_unlinked_while_it_fetched(connection, monkeypatch):
    """Savings is unlinked while the job waits on the provider, so only Everyday keeps its records and pending items and moves its checkpoint"""
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    savings = await _link(connection, "ACT-savings", **_synced_through_yesterday())
    provider = _HeldProvider()
    provider.outcomes = [
        _returned_with(
            {
                "ACT-everyday": [_record("TRN-coffee"), _pending_record("P-fuel")],
                "ACT-savings": [_record("TRN-interest"), _pending_record("P-transfer")],
            }
        )
    ]
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await provider.sending[1].wait()
        async with TestSession() as session:
            await session.execute(
                update(BankAccountLink)
                .where(BankAccountLink.id == savings.id)
                .values(state=BankLinkState.UNLINKED, unlinked_at=datetime(2026, 10, 4, tzinfo=UTC))
            )
            await session.commit()
        provider.release[1].set()
        await running

    assert await _bank_transactions(BankTransaction.external_account_id, _BANK_ID) == [("ACT-everyday", "TRN-coffee")]
    assert await _pending_transactions(BankPendingTransaction.account_id, BankPendingTransaction.description) == [
        (everyday.account_id, "P-fuel")
    ]
    assert await _checkpoints(everyday, savings) == [_TODAY, date(2026, 10, 3)]


async def test_job_attempt_that_lost_its_lease_while_fetching_writes_nothing(connection, monkeypatch):
    """Attempt 1 stalls on the provider past its lease, attempt 2 finds the bank account failing, and attempt 1's late answer stores nothing

    Nor does it record its attempt, so the link still shows attempt 2's failure and waits on its retry
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    provider = _HeldProvider()
    provider.outcomes = [
        _returned_with({"ACT-1": [_record("TRN-coffee")]}),
        FetchResult(account_errors={"ACT-1": ProviderError(ProviderErrorKind.TEMPORARY, "Fake Bank Online reported a problem")}),
    ]
    use_adapter(monkeypatch, provider)
    job = await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    async with asyncio.timeout(_WAIT_SECONDS):
        first_attempt = asyncio.create_task(run_jobs(1))
        await provider.sending[1].wait()
        await _expire_lease(job)
        assert await run_jobs(1) == 1
        provider.release[1].set()
        assert await first_attempt == 1

    assert await _bank_transactions(BankTransaction.id) == []
    assert await _checkpoints(link) == [date(2026, 10, 3)]
    assert (await _job_states())[job.id] == ("succeeded", 2)
    assert [(reason, retries) for _, _, reason, retries, _ in await _attempts(link)] == [("Fake Bank Online reported a problem", 1)]


async def test_job_attempt_that_lost_its_lease_while_listing_stores_nothing(connection, monkeypatch):
    """Attempt 1's listing leaves the bank account out but stalls past the lease, attempt 2's lists it, and attempt 1's answer moves nothing"""
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    async with TestSession() as session:
        session.add(_build_external_account(connection, "ACT-1"))
        await session.commit()
    provider = _HeldProvider()
    provider.outcomes = [FetchResult(), _returned("ACT-1"), _returned("ACT-1")]
    use_adapter(monkeypatch, provider)
    job = await _seed_job(connection, BankSyncJobKind.RETRY, discover=True)

    async with asyncio.timeout(_WAIT_SECONDS):
        first_attempt = asyncio.create_task(run_jobs(1))
        await provider.sending[1].wait()
        await _expire_lease(job)
        assert await run_jobs(1) == 1
        provider.release[1].set()
        assert await first_attempt == 1

    assert await _link_states(link) == ["active"]
    assert await _listing(connection) == (False, ["ACT-1"])
    assert await _job_states() == {job.id: ("succeeded", 2)}


async def test_job_puts_each_new_booked_record_in_the_review_inbox_whatever_the_accounts_preference(connection, provider, frozen_now):
    """Everyday has every review choice set to trust, and a daily sync brings three new booked records

    All three wait for review with the bank's values, and none reaches the ledger, since nothing can
    fill in a merchant and category yet
    """
    link = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    async with TestSession() as session:
        session.add(
            AccountReviewPreference(
                account_id=link.account_id,
                owner_id=connection.owner_id,
                new_transactions=ReviewDecision.TRUST,
                corrections=ReviewDecision.TRUST,
                removals=ReviewDecision.TRUST,
            )
        )
        await session.commit()
    salary = _record("TRN-salary", date(2026, 10, 1), amount=2_650_00, raw_amount="2650.00", description="DIRECT CREDIT BRIGHTWORKS SALARY")
    fuel = _record("TRN-fuel", _TODAY, amount=-72_10, raw_amount="-72.10", description="NORTHERN FUEL STOP")
    coffee = _record("TRN-coffee")
    provider.outcomes = [_returned_with({"ACT-everyday": [salary, fuel, coffee]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    awaiting = BankTransactionDisposition.AWAITING_REVIEW
    assert await _bank_transactions(
        BankTransaction.account_id,
        _BANK_ID,
        BankTransaction.disposition,
        BankTransaction.observed_date,
        BankTransaction.observed_amount,
        BankTransaction.description,
        BankTransaction.observed_at,
    ) == [
        (
            link.account_id,
            "TRN-coffee",
            awaiting,
            date(2026, 10, 2),
            -4_50,
            "POS 4411 COFFEE",
            frozen_now,
        ),
        (link.account_id, "TRN-fuel", awaiting, _TODAY, -72_10, "NORTHERN FUEL STOP", frozen_now),
        (link.account_id, "TRN-salary", awaiting, date(2026, 10, 1), 2_650_00, "DIRECT CREDIT BRIGHTWORKS SALARY", frozen_now),
    ]
    async with TestSession() as session:
        assert (await session.scalars(select(Transaction.id))).all() == []


async def test_job_keeps_an_amount_it_cant_store_exactly_as_the_bank_sent_it_and_still_syncs(connection, provider, frozen_now):
    """-12.345 in a currency of two decimals waits with no amount and its text as sent

    The account still reads as synced: its checkpoint moves to today and its last successful sync is this one
    """
    await _link(connection, "ACT-1", **_synced_through_yesterday())
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-fx", amount=None, raw_amount="-12.345")]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(_BANK_ID, BankTransaction.observed_amount, BankTransaction.raw_amount) == [("TRN-fx", None, "-12.345")]
    async with TestSession() as session:
        assert (await session.execute(select(BankAccountLink.checkpoint, BankAccountLink.last_success_at))).one() == (_TODAY, frozen_now)


async def test_job_reading_the_same_records_again_keeps_one_unchanged_item_each(connection, provider, frozen_now):
    """The next daily sync re-reads the days the one before read, and the same coffee and the same unstorable -12.345 come back

    Each stays one item, untouched, so a bulk approval previewed in between still applies to it
    """
    await _link(connection, "ACT-1", **_synced_through_yesterday())
    response = _returned_with({"ACT-1": [_record("TRN-coffee"), _record("TRN-fx", amount=None, raw_amount="-12.345")]})
    provider.outcomes = [response, response]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()

    # The clock is frozen, so the first sync is moved a day back for a needless refresh to show
    async with TestSession() as session:
        await session.execute(update(BankTransaction).values(observed_at=frozen_now - timedelta(days=1)))
        await session.commit()
    columns = (_BANK_ID, BankTransaction.id, BankTransaction.version, BankTransaction.observed_at)
    stored = await _bank_transactions(*columns)

    await _bring_next_syncs_round(connection, frozen_now)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()

    assert len(provider.fetches) == 2
    assert [status for _, status, *_ in await _jobs()] == ["succeeded", "succeeded"]
    assert [(external_id, version) for external_id, _, version, _ in stored] == [("TRN-coffee", 1), ("TRN-fx", 1)]
    assert await _bank_transactions(*columns) == stored


async def test_job_refreshes_an_item_still_waiting_in_place(connection, provider, frozen_now):
    """An item waiting as POS 4411 COFFEE comes back as BLUE BOTTLE COFFEE: the same item shows the new description, and there is still one"""
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    item_id = await _store_bank_transaction(
        link,
        "TRN-coffee",
        observed_date=date(2026, 10, 2),
        observed_amount=-4_50,
        description="POS 4411 COFFEE",
        observed_at=frozen_now - timedelta(days=1),
    )
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee", description="BLUE BOTTLE COFFEE")]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(
        BankTransaction.id, BankTransaction.disposition, BankTransaction.description, BankTransaction.version, BankTransaction.observed_at
    ) == [(item_id, BankTransactionDisposition.AWAITING_REVIEW, "BLUE BOTTLE COFFEE", 2, frozen_now)]


async def test_job_leaves_a_dismissed_item_dismissed_when_the_bank_sends_it_changed(connection, provider):
    """The user dismissed AMZN Mktp -19.99, and the next re-read returns it as -18.99: it stays dismissed and no item appears"""
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    item_id = await _store_bank_transaction(link, "TRN-amzn", **_DISMISSED)
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-amzn", amount=-18_99, raw_amount="-18.99", description="AMZN Mktp")]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(
        BankTransaction.id, BankTransaction.disposition, BankTransaction.observed_amount, BankTransaction.description, BankTransaction.version
    ) == [(item_id, BankTransactionDisposition.DISMISSED, None, None, 1)]
    assert await _checkpoints(link) == [_TODAY]


@pytest.mark.parametrize("dismissed_from", ["another_bank_account", "another_lumina_account"])
async def test_job_brings_in_an_id_dismissed_under_another_identity_as_a_new_item(connection, provider, dismissed_from):
    """TRN-1 was dismissed when another bank account sent it into this account, or when this bank account fed another account

    The same ID is another transaction here, so it arrives as a new item and the dismissal stays where it was
    """
    if dismissed_from == "another_lumina_account":
        previous = await _link(connection, "ACT-1", state=BankLinkState.UNLINKED, unlinked_at=datetime(2026, 9, 1, tzinfo=UTC))
        link = await _link(connection, "ACT-1", **_synced_through_yesterday())
        await _store_bank_transaction(previous, "TRN-1", **_DISMISSED)
        dismissed = (previous.account_id, "ACT-1", BankTransactionDisposition.DISMISSED)
    else:
        link = await _link(connection, "ACT-1", **_synced_through_yesterday())
        await _store_bank_transaction(link, "TRN-1", external_account_id="ACT-before", **_DISMISSED)
        dismissed = (link.account_id, "ACT-before", BankTransactionDisposition.DISMISSED)
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-1")]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    stored = await _bank_transactions(BankTransaction.account_id, BankTransaction.external_account_id, BankTransaction.disposition)
    assert sorted(stored) == sorted([dismissed, (link.account_id, "ACT-1", BankTransactionDisposition.AWAITING_REVIEW)])


async def test_job_puts_no_pending_or_removed_record_in_the_review_inbox(connection, provider):
    """Beside a booked coffee come a hold still pending at the bank and a record the provider reports removed, and neither becomes an item"""
    await _link(connection, "ACT-1", **_synced_through_yesterday())
    provider.outcomes = [
        _returned_with({"ACT-1": [_record("TRN-coffee"), _record("TRN-hold", pending=True), _record("TRN-gone", removed=True)]})
    ]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(_BANK_ID) == [("TRN-coffee",)]


async def _hold_descriptions() -> list[str]:
    """Return the description of every stored hold"""
    async with TestSession() as session:
        return sorted((await session.scalars(select(BankHold.description))).all())


async def test_job_keeps_a_zero_amount_record_as_a_hold_and_not_a_review_item(connection, provider):
    """A $0 card check beside a booked coffee becomes a hold, and only the coffee waits in review"""
    await _link(connection, "ACT-1", **_synced_through_yesterday())
    check = _record("TRN-check", _TODAY, amount=0, raw_amount="0.00", description="CARD CHECK")
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee", _TODAY), check]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(_BANK_ID) == [("TRN-coffee",)]
    assert await _hold_descriptions() == ["CARD CHECK"]


async def test_job_clears_a_hold_the_bank_no_longer_lists_for_the_days_it_fetched(connection, provider):
    """Yesterday's sync stored a hold dated today, and today's fetch of those days no longer lists it"""
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    async with TestSession() as session:
        session.add(
            BankHold(
                owner_id=link.owner_id,
                account_id=link.account_id,
                provider=link.provider,
                external_account_id=link.external_account_id,
                external_transaction_hash=hash_bank_transaction_id(link.provider, link.external_account_id, "TRN-check"),
                hold_date=_TODAY,
                description="CARD CHECK",
                observed_at=datetime(2026, 10, 3, 9, 0, tzinfo=UTC),
            )
        )
        await session.commit()
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee", _TODAY)]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _hold_descriptions() == []


async def test_job_replaces_each_accounts_pending_items_with_those_still_pending_at_the_bank(connection, provider, frozen_now):
    """A sync finds COFFEE, SHELL and a hotel hold pending at Everyday and a refund pending at Card, each kept for its own account

    By the next sync the coffee posted under a new ID, the hotel hold was dropped and Card has nothing
    pending any more. Only SHELL is still pending, the coffee waits for review as a booked item, and
    neither the hold nor the refund leaves a review item behind
    """
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    card = await _link(connection, "ACT-card", **_synced_through_yesterday())
    shell = _pending_record("P-shell", amount=-60_00, raw_amount="-60.00", description="SHELL")
    hotel = _pending_record("P-hotel", amount=-200_00, raw_amount="-200.00", description="HARBOUR HOTEL")
    refund = _pending_record("P-refund", amount=25_00, raw_amount="25.00", description="REFUND")
    provider.outcomes = [
        _returned_with({"ACT-everyday": [_pending_record("P-coffee", description="COFFEE"), shell, hotel], "ACT-card": [refund]}),
        _returned_with({"ACT-everyday": [shell, _record("TRN-coffee", _TODAY, description="COFFEE")], "ACT-card": []}),
    ]
    columns = (BankPendingTransaction.account_id, BankPendingTransaction.description, BankPendingTransaction.amount)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()
    after_the_first_sync = await _pending_transactions(*columns)

    await _bring_next_syncs_round(connection, frozen_now)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()

    assert after_the_first_sync == [
        (everyday.account_id, "COFFEE", -4_50),
        (everyday.account_id, "HARBOUR HOTEL", -200_00),
        (card.account_id, "REFUND", 25_00),
        (everyday.account_id, "SHELL", -60_00),
    ]
    assert await _pending_transactions(*columns) == [(everyday.account_id, "SHELL", -60_00)]
    assert await _bank_transactions(_BANK_ID, BankTransaction.disposition) == [("TRN-coffee", BankTransactionDisposition.AWAITING_REVIEW)]


async def test_job_keeps_each_pending_record_from_the_import_start_on_once_as_the_bank_sent_it(connection, provider, frozen_now):
    """Everyday, imported from 3 October, keeps pending a fuel stop, a fee as the bank sent it and a coffee sent twice at its later amount

    The fuel stop dates from 3 October itself, while a hold from 2 October, before the import start,
    and a record the provider reports removed are left out
    """
    link = await _link(connection, "ACT-everyday", import_start=date(2026, 10, 3), checkpoint=date(2026, 10, 2))
    pending = [
        _pending_record("P-fuel", date(2026, 10, 3), amount=-72_10, raw_amount="-72.10", description="NORTHERN FUEL STOP"),
        _pending_record("P-fee", amount=None, raw_amount="-12.345", description="FX FEE"),
        _pending_record("P-coffee"),
        _pending_record("P-coffee", amount=-5_40, raw_amount="-5.40"),
        _pending_record("P-before", date(2026, 10, 2)),
        _pending_record("P-gone", removed=True),
    ]
    provider.outcomes = [_returned_with({"ACT-everyday": pending})]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert await _pending_transactions(
        BankPendingTransaction.account_id,
        BankPendingTransaction.transaction_date,
        BankPendingTransaction.amount,
        BankPendingTransaction.raw_amount,
        BankPendingTransaction.description,
        BankPendingTransaction.observed_at,
    ) == [
        (link.account_id, _TODAY, None, "-12.345", "FX FEE", frozen_now),
        (link.account_id, date(2026, 10, 3), -72_10, None, "NORTHERN FUEL STOP", frozen_now),
        (link.account_id, _TODAY, -5_40, None, "P-coffee", frozen_now),
    ]


async def test_job_leaves_the_pending_items_of_bank_accounts_the_response_didnt_bring_back_whole(connection, provider):
    """Savings has an error of its own, Card's bank login needs a sign-in and Travel didn't come back, so each keeps the pending item it had

    Everyday came back whole in the same response, so its item is replaced
    """
    names = ("everyday", "savings", "card", "travel")
    links = {name: await _link(connection, f"ACT-{name}", **_synced_through_yesterday()) for name in names}
    for name, link in links.items():
        await _store_pending(link, f"P-{name}-before")
    provider.outcomes = [
        FetchResult(
            accounts=(
                _bank_account("ACT-everyday", records=[_pending_record("P-everyday-now")]),
                _bank_account("ACT-savings", records=[_pending_record("P-savings-now")]),
                _bank_account("ACT-card", login_key="CON-card", records=[_pending_record("P-card-now")]),
            ),
            account_errors={"ACT-savings": ProviderError(ProviderErrorKind.TEMPORARY, "Fake Bank Online reported a problem")},
            login_errors={"CON-card": ProviderError(ProviderErrorKind.BANK_LOGIN_NEEDED, "Sign in to your bank again")},
        )
    ]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _pending_transactions(BankPendingTransaction.account_id, BankPendingTransaction.description) == [
        (links["card"].account_id, "P-card-before"),
        (links["everyday"].account_id, "P-everyday-now"),
        (links["savings"].account_id, "P-savings-before"),
        (links["travel"].account_id, "P-travel-before"),
    ]


async def test_job_leaves_pending_items_alone_until_its_window_reaches_today(connection, provider):
    """In Phoenix, at 8 pm on 3 October and already 4 October in UTC, a catch-up after the worker stopped on 31 March takes three windows

    Each window is a job of its own. The two before today don't ask for pending records and get none,
    yet leave March's pending item in place, and the window ending today replaces it with what is
    pending now
    """
    await _set_owner_timezone(connection, _PHOENIX)
    link = await _link(
        connection,
        "ACT-1",
        **_synced_through_yesterday(checkpoint=date(2026, 3, 31), last_success_at=datetime(2026, 3, 31, 9, tzinfo=_PHOENIX)),
    )
    await _store_pending(link, "P-march", transaction_date=date(2026, 3, 31), observed_at=datetime(2026, 3, 31, 9, tzinfo=_PHOENIX))
    # The provider holds the same pending record throughout, and sends it only to a fetch that asks for it
    provider.outcomes = [_returned_with({"ACT-1": [_pending_record("P-now", date(2026, 10, 3))]}) for _ in range(3)]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    for _ in range(2):
        assert await run_jobs(1) == 1
        assert await _pending_transactions(BankPendingTransaction.description) == [("P-march",)]
    assert await run_jobs(1) == 1

    assert await _pending_transactions(BankPendingTransaction.description) == [("P-now",)]
    assert len(provider.fetches) == 3


async def test_job_keeps_one_item_with_the_later_values_for_an_id_sent_twice_in_one_response(connection, provider):
    """The coffee comes back twice in one response, at $4.50 and then at $5.40

    It is one transaction, so the sync still succeeds and one item waits for review, at $5.40
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee"), _record("TRN-coffee", amount=-5_40, raw_amount="-5.40")]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(_BANK_ID, BankTransaction.observed_amount) == [("TRN-coffee", -5_40)]
    assert [status for _, status, *_ in await _jobs()] == ["succeeded"]
    assert await _checkpoints(link) == [_TODAY]


async def test_job_storing_while_the_user_dismisses_an_item_leaves_it_dismissed(connection, monkeypatch):
    """The user dismisses an item as the job comes to store the bank's new description for it

    The job waits for the dismissal, then leaves the item dismissed rather than writing back the bank
    values the dismissal cleared, and still syncs the account
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    item_id = await _store_bank_transaction(link, "TRN-coffee")
    provider = _HeldProvider()
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee", description="BLUE BOTTLE COFFEE")]})]
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await provider.sending[1].wait()
        async with TestSession() as reviewing:
            blocker_pid = await reviewing.scalar(text("SELECT pg_backend_pid()"))
            await reviewing.execute(select(BankTransaction.id).where(BankTransaction.id == item_id).with_for_update())
            provider.release[1].set()
            await _wait_until_waiting_on(blocker_pid, running)

            # A Core update moves the version itself, as the model asks
            await reviewing.execute(
                update(BankTransaction).where(BankTransaction.id == item_id).values(version=BankTransaction.version + 1, **_DISMISSED)
            )
            await reviewing.commit()
        assert await running == 1

    assert await _bank_transactions(BankTransaction.id, BankTransaction.disposition, BankTransaction.description) == [
        (item_id, BankTransactionDisposition.DISMISSED, None)
    ]
    assert await _checkpoints(link) == [_TODAY]


async def test_job_tells_the_owners_pages_as_a_part_stores_records_without_moving_a_checkpoint(connection, monkeypatch):
    """The daily re-read comes back cut short, and its earlier half, 19 to 26 September, brings a coffee that posted late

    The checkpoint stays at 3 October, but the new item is kept, so the owner's open pages hear of it
    while the later half is still out
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    provider = _HeldProvider(held=(1, 3))
    provider.outcomes = [_cut_off("ACT-1"), _returned_with({"ACT-1": [_record("TRN-late", date(2026, 9, 22))]}), _returned("ACT-1")]
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await provider.sending[1].wait()
        told_as_it_started = await _told_at(connection)
        provider.release[1].set()
        await provider.sending[3].wait()
        told_after_the_earlier_half = await _told_at(connection)
        checkpoint_after_the_earlier_half = await _checkpoints(link)
        provider.release[3].set()
        await running

    assert await _bank_transactions(_BANK_ID) == [("TRN-late",)]
    assert checkpoint_after_the_earlier_half == [date(2026, 10, 3)]
    assert told_as_it_started is not None
    assert told_after_the_earlier_half > told_as_it_started


def _new_records(count: int, prefix: str = "TRN-new", day: date = date(2026, 10, 2)) -> list[ProviderRecord]:
    """Return this many booked records new to the app, each a $4.50 coffee on the day given, 2 October unless told otherwise"""
    return [_record(f"{prefix}-{number}", day) for number in range(count)]


async def _pauses(*links: BankAccountLink) -> list[tuple[bool, bool]]:
    """Return whether each link is paused for review, and whether an import is running on it, as committed"""
    async with TestSession() as session:
        rows = [
            (await session.execute(select(BankAccountLink.paused, BankAccountLink.importing).where(BankAccountLink.id == link.id))).one()
            for link in links
        ]
    return [tuple(row) for row in rows]


async def _waiting(link: BankAccountLink) -> int:
    """Return how many new items wait for their first review in the link's account"""
    async with TestSession() as session:
        return await session.scalar(
            select(func.count())
            .select_from(BankTransaction)
            .where(BankTransaction.account_id == link.account_id, BankTransaction.disposition == BankTransactionDisposition.AWAITING_REVIEW)
        )


async def test_job_that_leaves_100_new_items_waiting_pauses_that_account_alone(connection, provider, frozen_now):
    """Everyday has 96 new items waiting, and the daily sync brings 12 more: all 12 are kept and Everyday pauses at 108

    The next day's sync leaves Everyday out, while Savings, on the same connection, keeps syncing
    """
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    savings = await _link(connection, "ACT-savings", **_synced_through_yesterday())
    await _commit_waiting_items(everyday, 96)
    provider.outcomes = [_returned_with({"ACT-everyday": _new_records(12), "ACT-savings": []}), _returned("ACT-savings")]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()

    await _bring_next_syncs_round(connection, frozen_now)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [
        _window(date(2026, 9, 19), _TODAY, ["ACT-everyday", "ACT-savings"], pending=True),
        _window(date(2026, 9, 20), _TODAY, ["ACT-savings"], pending=True),
    ]
    assert await _waiting(everyday) == 108
    assert await _pauses(everyday, savings) == [(True, False), (False, False)]


@pytest.mark.parametrize(("waiting", "paused"), [(87, False), (88, True)], ids=["leaves_99", "leaves_100"])
async def test_job_pauses_an_account_once_100_new_items_wait(connection, provider, waiting, paused):
    """12 new items on top of 87 waiting leave 99, and Everyday keeps syncing. On top of 88 they leave 100, and it pauses"""
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    await _commit_waiting_items(link, waiting)
    provider.outcomes = [_returned_with({"ACT-1": _new_records(12)})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _pauses(link) == [(paused, False)]


async def test_job_counts_only_new_items_waiting_toward_the_pause(connection, provider):
    """Everyday has 90 new items waiting, 15 corrections and 5 removals open, and 20 accepted items with nothing open

    A sync bringing nothing new leaves Everyday syncing, since the corrections and removals are opened
    on accepted transactions and only the 90 count
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    await _commit_waiting_items(link, 90)
    await _commit_accepted_items(link, plain=20, corrections=15, removals=5)
    provider.outcomes = [_returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _pauses(link) == [(False, False)]


async def test_job_runs_a_first_import_to_today_past_100_new_items_and_pauses_once_it_ends(connection, provider):
    """Everyday's import from 1 January brings 85 new items in each of its four windows

    It passes 100 waiting in its second window and carries on, since stopping would leave the rest of
    the year missing. Once it reaches today, the 340 waiting pause Everyday
    """
    link = await _link(connection, "ACT-1", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    first_days = [date(2026, 1, 1), date(2026, 4, 1), date(2026, 6, 30), date(2026, 9, 28)]
    provider.outcomes = [_returned_with({"ACT-1": _new_records(85, f"TRN-{day}", day)}) for day in first_days]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [
        _window(date(2026, 1, 1), date(2026, 3, 31)),
        _window(date(2026, 4, 1), date(2026, 6, 29)),
        _window(date(2026, 6, 30), date(2026, 9, 27)),
        _window(date(2026, 9, 28), _TODAY, pending=True),
    ]
    assert await _waiting(link) == 340
    assert await _pauses(link) == [(True, False)]


# A link whose bank account was chosen again, importing from 1 September
_CHOSEN_AGAIN = {"import_kind": BankImportKind.CHOOSE_AGAIN, "import_start": date(2026, 9, 1), "checkpoint": date(2026, 8, 31)}

# A link reconnected after its credential was rejected, complete through 24 September, the day of its last sync
_RECONNECTED = {
    "import_kind": BankImportKind.RECONNECT,
    "checkpoint": date(2026, 9, 24),
    "last_success_at": datetime(2026, 9, 24, 9, tzinfo=_PHOENIX),
}


@pytest.mark.parametrize(
    ("values", "waiting", "sent_by", "window", "paused"),
    [
        (_CHOSEN_AGAIN, 105, "ACT-before", _window(date(2026, 9, 1), date(2026, 10, 3), pending=True, timezone=_PHOENIX), True),
        (_RECONNECTED, 51, "ACT-1", _window(date(2026, 9, 10), date(2026, 10, 3), pending=True, timezone=_PHOENIX), True),
        (_RECONNECTED, 50, "ACT-1", _window(date(2026, 9, 10), date(2026, 10, 3), pending=True, timezone=_PHOENIX), False),
    ],
    ids=["choose_again_with_105_from_the_old_bank_account", "reconnect_with_51", "reconnect_with_50"],
)
async def test_job_runs_an_import_on_a_paused_link_to_today_and_keeps_the_pause_until_50_or_fewer_wait(
    connection, provider, values, waiting, sent_by, window, paused
):
    """Everyday, in Phoenix, was paused for review when its bank account had to be chosen again, or its connection reconnected

    The import that follows runs to today whatever the pause, and ends on 3 October, Phoenix's today,
    though it's already 4 October in UTC. Once it ends, the pause stays while more than 50 new items
    wait, counting those the account's old bank account sent, and lifts at 50
    """
    await _set_owner_timezone(connection, _PHOENIX)
    link = await _link(connection, "ACT-1", **{"import_start": date(2026, 1, 1), "paused": True, "importing": True} | values)
    await _commit_waiting_items(link, waiting, external_account_id=sent_by)
    provider.outcomes = [_returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [window]
    assert await _pauses(link) == [(paused, False)]


async def test_job_retries_an_import_that_failed_on_a_paused_link_30_minutes_on(connection, provider, frozen_now):
    """Everyday was paused for review with 70 new items waiting when its connection was reconnected, and the catch-up has an error of its own

    The import runs whatever the pause, so its failed attempt is retried at 1:30 pm like any other
    rather than waiting for a review that may never come
    """
    link = await _link(
        connection,
        "ACT-1",
        import_kind=BankImportKind.RECONNECT,
        import_start=date(2026, 1, 1),
        checkpoint=date(2026, 9, 24),
        last_success_at=datetime(2026, 9, 24, 9, tzinfo=_BRISBANE),
        paused=True,
        importing=True,
    )
    await _commit_waiting_items(link, 70)
    provider.outcomes = [FetchResult(accounts=(_bank_account("ACT-1"),), account_errors={"ACT-1": _reported_a_problem()})]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert await _pauses(link) == [(True, True)]
    assert await _queued_jobs() == [("retry", timedelta(minutes=30), False)]


async def test_job_queues_no_retry_for_a_link_the_review_pause_holds_back(connection, provider, frozen_now):
    """Everyday is paused for review while waiting to retry at 1:30 pm, and Savings syncs at 1 pm

    Everyday syncs again only once a review lifts its pause, so the job that ends queues no retry for it
    """
    await _link(
        connection, "ACT-everyday", **_synced_through_yesterday(paused=True, retry_count=1, next_attempt_at=frozen_now + timedelta(minutes=30))
    )
    await _link(connection, "ACT-savings", **_synced_through_yesterday())
    provider.outcomes = [_returned("ACT-savings")]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 9, 19), _TODAY, ("ACT-savings",), pending=True)]
    assert await _queued_jobs() == []


async def test_job_tries_a_paused_links_import_daily_while_its_bank_needs_a_sign_in_and_pauses_it_once_the_import_ends(
    connection, provider, frozen_now, sent_action_emails
):
    """Everyday was paused for review with 70 new items waiting when its connection was reconnected, and the catch-up meets a bank sign-in

    Everyday is marked and its owner emailed once, with no retry queued. The import keeps running, so
    the pause still doesn't hold it back: the next daily sync tries it, and once the user has signed
    in, the import reaches today, the mark clears and the pause applies
    """
    await _list_under(connection, "CON-harbour", "Harbour Bank", "ACT-1")
    link = await _link(
        connection,
        "ACT-1",
        import_kind=BankImportKind.RECONNECT,
        import_start=date(2026, 1, 1),
        checkpoint=date(2026, 9, 24),
        last_success_at=datetime(2026, 9, 24, 9, tzinfo=_BRISBANE),
        paused=True,
        importing=True,
    )
    await _commit_waiting_items(link, 70)
    provider.outcomes = [FetchResult(login_errors={"CON-harbour": _signin_needed()}), _returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.INITIAL)
    await _run_jobs_until_none_is_due()

    assert await _pauses(link) == [(True, True)]
    assert await _signin_marks(link) == [frozen_now]
    assert await _queued_jobs() == []

    await _bring_next_syncs_round(connection, frozen_now)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()

    assert len(provider.fetches) == 2
    assert await _pauses(link) == [(True, False)]
    assert await _signin_marks(link) == [None]
    assert _emailed(sent_action_emails, "ACT-1") == [_email(_SIGNIN_SUBJECT, "ACT-1")]


async def test_job_marks_a_bank_sign_in_only_on_the_accounts_it_tried_leaving_one_paused_for_review_until_its_pause_lifts(
    connection, provider, frozen_now, sent_action_emails
):
    """Everyday is paused for review and Savings syncs, both under the Harbour Bank login, when the bank asks for a sign-in

    Only Savings is tried, so only Savings is marked and the email names it alone, since the pause,
    not the sign-in, is what stops Everyday. Once a review lifts the pause, Everyday meets the same
    sign-in and is marked too, with no second email for a state already under way
    """
    await _list_under(connection, "CON-harbour", "Harbour Bank", "ACT-everyday", "ACT-savings")
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday(paused=True))
    savings = await _link(connection, "ACT-savings", **_synced_through_yesterday())
    provider.outcomes = [FetchResult(login_errors={"CON-harbour": _signin_needed()})] * 2
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 9, 19), _TODAY, ("ACT-savings",), pending=True)]
    assert await _signin_marks(everyday, savings) == [None, frozen_now]
    assert _emailed(sent_action_emails, "ACT-everyday", "ACT-savings") == [_email(_SIGNIN_SUBJECT, "ACT-savings")]

    async with TestSession() as session:
        await session.execute(update(BankAccountLink).where(BankAccountLink.id == everyday.id).values(paused=False))
        await session.commit()
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()

    assert await _signin_marks(everyday, savings) == [frozen_now, frozen_now]
    assert len(sent_action_emails) == 1


async def test_job_pauses_a_first_import_by_the_count_left_when_it_ends_not_by_its_peak(connection, provider):
    """Everyday's import from 1 January brings 85 new items in each of its first two windows, and the user dismisses 110 before the third

    The import ends with 60 waiting, so Everyday keeps syncing: the 170 it passed on the way paused nothing
    """
    link = await _link(connection, "ACT-1", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    provider.outcomes = [
        _returned_with({"ACT-1": _new_records(85, "TRN-january", date(2026, 1, 1))}),
        _returned_with({"ACT-1": _new_records(85, "TRN-april", date(2026, 4, 1))}),
        _returned("ACT-1"),
        _returned("ACT-1"),
    ]
    await _seed_job(connection, BankSyncJobKind.INITIAL)
    assert [await run_jobs(1), await run_jobs(1)] == [1, 1]
    waiting_at_the_peak = await _waiting(link)
    async with TestSession() as session:
        await _dismiss_items(session, (await session.scalars(select(BankTransaction.id).limit(110))).all())
        await session.commit()

    await _run_jobs_until_none_is_due()

    assert waiting_at_the_peak == 170
    assert len(provider.fetches) == 4
    assert await _waiting(link) == 60
    assert await _pauses(link) == [(False, False)]


@pytest.mark.parametrize(("waiting", "paused"), [(100, True), (99, False)], ids=["100_waiting", "99_waiting"])
async def test_job_tells_the_owners_pages_as_a_part_that_stores_nothing_pauses_the_account(
    connection, monkeypatch, frozen_now, waiting, paused
):
    """Sync now re-reads Everyday, synced through today an hour ago, and comes back cut short. Its earlier half brings nothing new

    With 100 new items waiting, that half pauses Everyday, and the owner's open pages hear of it while
    the later half is still out. With 99 the half changes nothing, so they hear nothing
    """
    link = await _link(
        connection, "ACT-1", import_start=date(2026, 1, 1), checkpoint=_TODAY, last_success_at=frozen_now - timedelta(hours=1), importing=False
    )
    await _commit_waiting_items(link, waiting)
    provider = _HeldProvider(held=(1, 3))
    provider.outcomes = [_cut_off("ACT-1"), _returned("ACT-1"), _returned("ACT-1")]
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await provider.sending[1].wait()
        told_as_it_started = await _told_at(connection)
        provider.release[1].set()
        await provider.sending[3].wait()
        told_after_the_earlier_half = await _told_at(connection)
        pauses_after_the_earlier_half = await _pauses(link)
        provider.release[3].set()
        await running

    assert pauses_after_the_earlier_half == [(paused, False)]
    assert (told_after_the_earlier_half > told_as_it_started) is paused


async def test_job_a_review_queues_by_lifting_the_pause_catches_the_account_up_from_where_it_stopped(connection, provider, frozen_now):
    """Everyday was paused three weeks ago, complete through 13 September, with 80 new items waiting and its next sync set for tomorrow

    Dismissing 30 leaves 50. That lifts the pause and makes Everyday due at once: the sync this
    queues re-reads from 30 August, 14 days before the checkpoint, through today
    """
    link = await _link(
        connection,
        "ACT-1",
        import_start=date(2026, 1, 1),
        checkpoint=date(2026, 9, 13),
        last_success_at=datetime(2026, 9, 13, 9, tzinfo=_BRISBANE),
        importing=False,
        paused=True,
        next_attempt_at=frozen_now + timedelta(days=1),
    )
    item_ids = await _commit_waiting_items(link, 80)
    provider.outcomes = [_returned("ACT-1")]
    async with _owner_session(connection.owner_id) as session:
        links = await lock_account_links(session, [link.account_id])
        await _dismiss_items(session, item_ids[:30])
        await lift_review_pauses(session, connection.owner_id, links)
        await session.commit()

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 8, 30), _TODAY, pending=True)]
    assert await _checkpoints(link) == [_TODAY]
    assert await _pauses(link) == [(False, False)]


async def _offer_states(*links: BankAccountLink) -> list[str]:
    """Return where each link's opening adjustment stands, as committed"""
    async with TestSession() as session:
        return [await session.scalar(select(BankAccountLink.opening_adjustment_state).where(BankAccountLink.id == link.id)) for link in links]


async def test_job_offers_the_opening_adjustment_as_an_import_bringing_nothing_to_review_ends(connection, provider):
    """Everyday's import from today brings nothing new, and Fake Bank's balance is 100.00 as of 10 am today in Brisbane

    The ledger holds nothing, so 100.00 is offered as the import ends
    """
    await _list_under(connection, "CON-harbour", "Harbour Bank", "ACT-1")
    link = await _link(connection, "ACT-1", import_start=_TODAY, checkpoint=date(2026, 10, 3))
    provider.outcomes = [_returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert await _pauses(link) == [(False, False)]
    assert await _offer_states(link) == ["offered"]


async def test_job_holds_the_offer_while_the_imports_items_wait(connection, provider):
    """Everyday's import from 1 October ends today with 3 coffees from 2 October waiting, stored as it ended, so nothing is offered"""
    await _list_under(connection, "CON-harbour", "Harbour Bank", "ACT-1")
    link = await _link(connection, "ACT-1", import_start=date(2026, 10, 1), checkpoint=date(2026, 9, 30))
    provider.outcomes = [_returned_with({"ACT-1": _new_records(3)})]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert await _waiting(link) == 3
    assert await _offer_states(link) == ["not_ready"]


async def test_job_offers_the_adjustment_as_a_reconnects_catch_up_ends_with_its_own_items_waiting(connection, provider):
    """Everyday's import ended with nothing left to review before its credential was replaced, and the catch-up brings 3 coffees

    Only the import's items hold the offer back, so 113.50 is offered as the catch-up ends, leaving
    out the 13.50 adding the coffees will take off the ledger
    """
    await _list_under(connection, "CON-harbour", "Harbour Bank", "ACT-1")
    link = await _link(
        connection,
        "ACT-1",
        import_kind=BankImportKind.RECONNECT,
        import_start=date(2026, 10, 1),
        checkpoint=date(2026, 9, 30),
        import_ended_at=func.now(),
    )
    provider.outcomes = [_returned_with({"ACT-1": _new_records(3)})]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert await _waiting(link) == 3
    assert await _offer_states(link) == ["offered"]


async def test_job_offers_the_adjustment_once_a_later_sync_reads_a_balance_it_can_compare(connection, provider, frozen_now):
    """Everyday's import from today ends with Fake Bank's balance sent with more decimals than CAD holds, so nothing can be offered

    The next sync reads 100.00, and offers it
    """
    await _list_under(connection, "CON-harbour", "Harbour Bank", "ACT-1")
    link = await _link(connection, "ACT-1", import_start=_TODAY, checkpoint=date(2026, 10, 3))
    provider.outcomes = [FetchResult(accounts=(replace(_bank_account("ACT-1"), balance=None),)), _returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.INITIAL)
    await _run_jobs_until_none_is_due()
    held = await _offer_states(link)

    await _bring_next_syncs_round(connection, frozen_now)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()

    assert held == ["not_ready"]
    assert await _offer_states(link) == ["offered"]


# A link with no reminder about the history its imports and catch-ups returned
_NO_REMINDER = (None, None, False)


async def _noted_history(link: BankAccountLink) -> tuple[date | None, date | None]:
    """Return what the link's running import or catch-up has noted, as committed: the first day it asked from and the earliest booked date"""
    columns = (BankAccountLink.catchup_requested_start, BankAccountLink.earliest_booked_date)
    async with TestSession() as session:
        return tuple((await session.execute(select(*columns).where(BankAccountLink.id == link.id))).one())


async def _history_reminders(*links: BankAccountLink) -> list[tuple[date | None, date | None, bool]]:
    """Return each link's history reminder as committed: the first day asked from, the earliest booked date and whether it was dismissed"""
    columns = (BankAccountLink.history_reminder_start, BankAccountLink.history_reminder_earliest, BankAccountLink.history_reminder_dismissed)
    async with TestSession() as session:
        return [tuple((await session.execute(select(*columns).where(BankAccountLink.id == link.id))).one()) for link in links]


async def _cut_off_days(*links: BankAccountLink) -> list[tuple[date | None, bool]]:
    """Return the latest day each link kept though it may have been cut short, and whether its reminder was dismissed, as committed"""
    columns = (BankAccountLink.cut_off_day, BankAccountLink.cut_off_day_dismissed)
    async with TestSession() as session:
        return [tuple((await session.execute(select(*columns).where(BankAccountLink.id == link.id))).one()) for link in links]


@pytest.mark.parametrize("import_kind", [BankImportKind.INITIAL, BankImportKind.RELINK, BankImportKind.CHOOSE_AGAIN])
@pytest.mark.parametrize(
    ("earliest", "reminder"),
    [(date(2026, 6, 8), _NO_REMINDER), (date(2026, 6, 9), (date(2026, 6, 1), date(2026, 6, 9), False))],
    ids=["7_days_after_the_start", "8_days_after_the_start"],
)
async def test_job_reminds_once_an_import_ends_if_its_earliest_transaction_is_over_7_days_after_its_start(
    connection, provider, import_kind, earliest, reminder
):
    """Everyday, in Phoenix, is linked, relinked or chosen again from 1 June, and the earliest transaction its import gets is 8 or 9 June

    The first window sends a July transaction ahead of the earliest one. Only 9 June, more than 7 days
    after the start, raises the reminder, as the import ends on 3 October, Phoenix's today though
    it's already 4 October in UTC
    """
    await _set_owner_timezone(connection, _PHOENIX)
    link = await _link(connection, "ACT-1", import_kind=import_kind, import_start=date(2026, 6, 1), checkpoint=date(2026, 5, 31))
    provider.outcomes = [
        _returned_with({"ACT-1": [_record("TRN-july", date(2026, 7, 1)), _record("TRN-earliest", earliest)]}),
        _returned_with({"ACT-1": [_record("TRN-september", date(2026, 9, 15))]}),
    ]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [
        _window(date(2026, 6, 1), date(2026, 8, 29), timezone=_PHOENIX),
        _window(date(2026, 8, 30), date(2026, 10, 3), pending=True, timezone=_PHOENIX),
    ]
    assert await _history_reminders(link) == [reminder]


async def test_job_reminds_once_an_import_ends_having_got_no_booked_transaction(connection, provider):
    """Everyday's import from 1 June gets only a transaction the bank says it removed and a hold still pending, so no history came back"""
    link = await _link(connection, "ACT-1", import_start=date(2026, 6, 1), checkpoint=date(2026, 5, 31))
    provider.outcomes = [
        _returned_with({"ACT-1": [_record("TRN-removed", date(2026, 6, 2), removed=True)]}),
        _returned_with({"ACT-1": [_pending_record("TRN-hold")]}),
    ]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert len(provider.fetches) == 2
    assert await _history_reminders(link) == [(date(2026, 6, 1), None, False)]


async def test_job_reminds_as_an_import_from_today_ends_having_got_nothing(connection, provider):
    """Everyday, in Phoenix, is linked from today, 3 October there though already 4 October in UTC, and its import gets nothing

    However short the history it asked for, an import that gets nothing raises the reminder as it ends
    """
    await _set_owner_timezone(connection, _PHOENIX)
    link = await _link(connection, "ACT-1", import_start=date(2026, 10, 3), checkpoint=date(2026, 10, 2))
    provider.outcomes = [_returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 10, 3), date(2026, 10, 3), pending=True, timezone=_PHOENIX)]
    assert await _history_reminders(link) == [(date(2026, 10, 3), None, False)]


@pytest.mark.parametrize(
    ("first", "reminder"),
    [(date(2026, 7, 31), (date(2026, 8, 1), date(2026, 8, 20), False)), (date(2026, 8, 1), _NO_REMINDER)],
    ids=["reread_31_july", "on_1_august"],
)
async def test_job_reminds_once_the_catch_up_after_a_reconnect_gets_history_from_over_7_days_after_the_day_it_asked_from(
    connection, provider, first, reminder
):
    """Everyday's connection was rejected through August, complete through 31 July, and is now reconnected

    The catch-up asks from 1 August, re-reading the 14 days before, and gets a transaction from 31
    July or 1 August besides 20 August's. A re-read day's history says nothing of the gap after it,
    so 31 July's leaves 20 August the earliest and raises the reminder. 1 August's reaches the day
    asked from
    """
    link = await _link(
        connection,
        "ACT-1",
        import_kind=BankImportKind.RECONNECT,
        import_start=date(2026, 1, 1),
        checkpoint=date(2026, 7, 31),
        last_success_at=datetime(2026, 7, 31, 9, tzinfo=_BRISBANE),
    )
    records = [_record("TRN-first", first), _record("TRN-september", date(2026, 9, 2)), _record("TRN-august", date(2026, 8, 20))]
    provider.outcomes = [_returned_with({"ACT-1": records})]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 7, 17), _TODAY, pending=True)]
    assert await _history_reminders(link) == [reminder]


async def test_job_reminds_once_the_catch_up_a_lifted_review_pause_queues_gets_history_from_over_7_days_after_the_day_it_asked_from(
    connection, provider
):
    """Everyday was paused for review on 31 May, complete through that day, and a review now lifts the pause

    The catch-up asks from 1 June and takes two windows. The first gets nothing and the second's
    earliest transaction is 20 August, so the reminder names 1 June, the day the catch-up asked from,
    not the second window's first day
    """
    link = await _link(
        connection,
        "ACT-1",
        import_start=date(2026, 1, 1),
        checkpoint=date(2026, 5, 31),
        last_success_at=datetime(2026, 5, 31, 9, tzinfo=_BRISBANE),
        importing=False,
        paused=True,
    )
    item_ids = await _commit_waiting_items(link, 51)
    provider.outcomes = [_returned("ACT-1"), _returned_with({"ACT-1": [_record("TRN-august", date(2026, 8, 20))]})]
    async with _owner_session(connection.owner_id) as session:
        links = await lock_account_links(session, [link.account_id])
        await _dismiss_items(session, item_ids[:1])
        await lift_review_pauses(session, connection.owner_id, links)
        await session.commit()

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 5, 17), date(2026, 8, 14)), _window(date(2026, 8, 15), _TODAY, pending=True)]
    assert await _history_reminders(link) == [(date(2026, 6, 1), date(2026, 8, 20), False)]


@pytest.mark.parametrize(
    ("checkpoint", "reminder"),
    [(date(2026, 9, 25), _NO_REMINDER), (date(2026, 9, 24), (date(2026, 9, 25), None, False))],
    ids=["7_days_to_catch_up", "8_days_to_catch_up"],
)
async def test_job_reminds_only_when_the_catch_up_after_failed_syncs_asks_from_over_7_days_ago(connection, provider, checkpoint, reminder):
    """Everyday, in Phoenix, synced through its checkpoint and every sync since failed. Today is 3 October there, already 4 October in UTC

    Neither catch-up gets a transaction. One asking from 26 September covers 7 days to today, within
    the week's grace, so it raises nothing however quiet the account. One asking from 25 September
    covers 8, and raises the reminder
    """
    await _set_owner_timezone(connection, _PHOENIX)
    link = await _link(
        connection,
        "ACT-1",
        **_synced_through_yesterday(
            checkpoint=checkpoint,
            last_success_at=datetime(checkpoint.year, checkpoint.month, checkpoint.day, 9, tzinfo=_PHOENIX),
            last_failure_reason="Fake Bank Online reported a problem",
        ),
    )
    provider.outcomes = [_returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _checkpoints(link) == [date(2026, 10, 3)]
    assert await _history_reminders(link) == [reminder]


async def test_job_reminds_once_the_catch_up_after_a_bank_sign_in_gets_history_from_over_7_days_after_the_day_it_asked_from(
    connection, provider
):
    """Everyday's bank asked for a sign-in after its sync on 10 September, and the user has signed in since

    The catch-up asks from 11 September, and the earliest transaction it gets is 25 September
    """
    await _list_under(connection, "CON-harbour", "Harbour Bank", "ACT-1")
    link = await _link(
        connection,
        "ACT-1",
        **_synced_through_yesterday(
            checkpoint=date(2026, 9, 10),
            last_success_at=datetime(2026, 9, 10, 9, tzinfo=_BRISBANE),
            signin_needed_since=datetime(2026, 9, 11, 9, tzinfo=_BRISBANE),
        ),
    )
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-late", date(2026, 9, 25))]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _signin_marks(link) == [None]
    assert await _history_reminders(link) == [(date(2026, 9, 11), date(2026, 9, 25), False)]


async def test_job_reminds_once_the_catch_up_after_the_worker_stopped_gets_no_transaction(connection, provider, frozen_now, day_later):
    """The worker stopped after Everyday's sync at 1 pm on 24 September, and restarts ten days later

    The catch-up the first scan queues asks from 25 September and gets nothing
    """
    stopped_at = frozen_now - timedelta(days=10)
    link = await _link(
        connection,
        "ACT-1",
        **_synced_through_yesterday(checkpoint=date(2026, 9, 24), last_success_at=stopped_at, next_attempt_at=stopped_at + day_later),
    )
    await _set_next_sync(connection, stopped_at + day_later)
    provider.outcomes = [_returned("ACT-1")]

    await enqueue_due_work()
    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 9, 10), _TODAY, pending=True)]
    assert await _history_reminders(link) == [(date(2026, 9, 25), None, False)]


async def test_job_leaves_a_raised_reminder_the_user_dismissed_as_the_next_sync_gets_nothing_either(connection, provider, frozen_now):
    """Everyday's catch-up after failed syncs asks from 21 September and gets nothing, raising the reminder, and the user dismisses it

    The catch-up stops noting what it returned once it raises the reminder, so the next scheduled
    sync, getting nothing either, isn't a catch-up falling short and leaves the reminder dismissed
    """
    link = await _link(
        connection,
        "ACT-1",
        **_synced_through_yesterday(checkpoint=date(2026, 9, 20), last_success_at=datetime(2026, 9, 20, 9, tzinfo=_BRISBANE)),
    )
    provider.outcomes = [_returned("ACT-1"), _returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()
    raised = await _history_reminders(link)
    async with TestSession() as session:
        await session.execute(update(BankAccountLink).where(BankAccountLink.id == link.id).values(history_reminder_dismissed=True))
        await session.commit()

    await _bring_next_syncs_round(connection, frozen_now)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()

    assert len(provider.fetches) == 2
    assert raised == [(date(2026, 9, 21), None, False)]
    assert await _history_reminders(link) == [(date(2026, 9, 21), None, True)]


@pytest.mark.parametrize(
    ("returned", "reminder"),
    [
        ([], (date(2026, 9, 21), None, False)),
        ([_record("TRN-on-time", date(2026, 9, 22))], (date(2026, 6, 1), date(2026, 6, 9), True)),
    ],
    ids=["falls_short", "reaches_back"],
)
async def test_job_raises_a_later_catch_ups_own_reminder_over_one_the_user_dismissed(connection, provider, returned, reminder):
    """Everyday's import from 1 June got history from 9 June, and the user dismissed its reminder

    Its catch-up after failed syncs asks from 21 September. One getting nothing raises its own
    reminder, and it shows. One whose earliest transaction is 22 September reached back far enough,
    so the dismissed reminder stays as it was. Either way the catch-up stops noting what it returned
    """
    link = await _link(
        connection,
        "ACT-1",
        **_synced_through_yesterday(
            import_start=date(2026, 6, 1),
            checkpoint=date(2026, 9, 20),
            last_success_at=datetime(2026, 9, 20, 9, tzinfo=_BRISBANE),
            history_reminder_start=date(2026, 6, 1),
            history_reminder_earliest=date(2026, 6, 9),
            history_reminder_dismissed=True,
        ),
    )
    provider.outcomes = [_returned_with({"ACT-1": returned})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _history_reminders(link) == [reminder]
    assert await _noted_history(link) == (None, None)


@pytest.mark.parametrize(
    ("returned", "reminder"),
    [
        ([_record("TRN-coffee", date(2026, 9, 25))], _NO_REMINDER),
        ([_pending_record("TRN-hold"), _record("TRN-removed", date(2026, 10, 2), removed=True)], (date(2026, 9, 25), None, False)),
        ([_record("TRN-reread", date(2026, 9, 24))], (date(2026, 9, 25), None, False)),
    ],
    ids=["booked_from_the_day_asked_from", "only_pending_or_removed", "only_before_the_day_asked_from"],
)
async def test_job_hides_the_reminder_that_nothing_came_back_once_a_sync_gets_booked_history_from_the_day_it_asked_from(
    connection, provider, returned, reminder
):
    """Everyday's catch-up asked from 25 September and got nothing, so it shows No history returned yet

    Today's sync re-reads from 19 September. A booked transaction from 25 September, the day the
    catch-up asked from, hides the reminder. A hold still pending, a transaction the bank removed, or
    a booked one from 24 September, the day before, says nothing of the days it lacked, so the
    reminder stays
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday(history_reminder_start=date(2026, 9, 25)))
    provider.outcomes = [_returned_with({"ACT-1": returned})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 9, 19), _TODAY, pending=True)]
    assert await _history_reminders(link) == [reminder]


async def test_job_reminds_each_link_a_day_kept_though_cut_short_was_fetched_for(connection, provider):
    """Everyday and Savings, in Phoenix, import from 2 October, and each day alone still comes back with 1,000 transactions

    Fake Bank's limit counts both bank accounts, so either may be missing some, and both name 3
    October, the latest day kept, and Phoenix's today though it's already 4 October in UTC
    """
    await _set_owner_timezone(connection, _PHOENIX)
    both = ("ACT-everyday", "ACT-savings")
    everyday = await _link(connection, "ACT-everyday", import_start=date(2026, 10, 2), checkpoint=date(2026, 10, 1))
    savings = await _link(connection, "ACT-savings", import_start=date(2026, 10, 2), checkpoint=date(2026, 10, 1))
    provider.outcomes = [_cut_off(*both) for _ in range(3)]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [
        _window(date(2026, 10, 2), date(2026, 10, 3), both, pending=True, timezone=_PHOENIX),
        _window(date(2026, 10, 2), date(2026, 10, 2), both, timezone=_PHOENIX),
        _window(date(2026, 10, 3), date(2026, 10, 3), both, pending=True, timezone=_PHOENIX),
    ]
    assert await _cut_off_days(everyday, savings) == [(date(2026, 10, 3), False), (date(2026, 10, 3), False)]


async def test_job_reminds_only_the_links_a_day_kept_though_cut_short_brought_back_whole(connection, provider):
    """Everyday and Savings import from today. Today alone comes back with 1,000 transactions, and Savings fails in it

    Only Everyday was brought back whole, so only Everyday names today. Savings' import waits for
    its retry. That reads the day again
    """
    everyday = await _link(connection, "ACT-everyday", import_start=_TODAY, checkpoint=date(2026, 10, 3))
    savings = await _link(connection, "ACT-savings", import_start=_TODAY, checkpoint=date(2026, 10, 3))
    provider.outcomes = [
        FetchResult(accounts=(_bank_account("ACT-everyday"),), account_errors={"ACT-savings": _reported_a_problem()}, possibly_cut_off=True)
    ]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(_TODAY, _TODAY, ("ACT-everyday", "ACT-savings"), pending=True)]
    assert await _cut_off_days(everyday, savings) == [(_TODAY, False), (None, False)]


@pytest.mark.parametrize(
    ("dismissed_day", "after"),
    [(date(2026, 10, 2), (date(2026, 10, 3), False)), (date(2026, 10, 3), (date(2026, 10, 3), True)), (_TODAY, (_TODAY, True))],
    ids=["an_earlier_day_dismissed", "that_day_dismissed", "a_later_day_dismissed"],
)
async def test_job_rereading_a_day_kept_though_cut_short_reminds_again_only_past_the_day_dismissed(
    connection, provider, frozen_now, dismissed_day, after
):
    """Sync now re-reads Everyday, imported from 3 October and synced through today an hour ago, and 3 October alone still comes back cut short

    The user dismissed the reminder for an earlier day, that day or a later one, and only the
    earlier day's gives way to a reminder for 3 October
    """
    link = await _link(
        connection,
        "ACT-1",
        import_start=date(2026, 10, 3),
        checkpoint=_TODAY,
        last_success_at=frozen_now - timedelta(hours=1),
        importing=False,
        cut_off_day=dismissed_day,
        cut_off_day_dismissed=True,
    )
    provider.outcomes = [_cut_off("ACT-1"), _cut_off("ACT-1"), _returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [
        _window(date(2026, 10, 3), _TODAY, pending=True),
        _window(date(2026, 10, 3), date(2026, 10, 3)),
        _window(_TODAY, _TODAY, pending=True),
    ]
    assert await _cut_off_days(link) == [after]


@pytest.mark.parametrize(
    ("dismissed_day", "told"), [(date(2026, 10, 2), True), (date(2026, 10, 3), False)], ids=["raises_it", "changes_nothing"]
)
async def test_job_tells_the_owners_pages_as_a_part_storing_nothing_new_reminds_of_a_day_cut_short(
    connection, monkeypatch, frozen_now, dismissed_day, told
):
    """Sync now re-reads Everyday as above, and 3 October alone comes back cut short with nothing new

    That half raising the reminder is all it changes, and the owner's open pages hear of it while
    the later half is still out. Once the user has dismissed 3 October's, the half changes nothing,
    so they hear nothing
    """
    await _link(
        connection,
        "ACT-1",
        import_start=date(2026, 10, 3),
        checkpoint=_TODAY,
        last_success_at=frozen_now - timedelta(hours=1),
        importing=False,
        cut_off_day=dismissed_day,
        cut_off_day_dismissed=True,
    )
    provider = _HeldProvider(held=(1, 3))
    provider.outcomes = [_cut_off("ACT-1"), _cut_off("ACT-1"), _returned("ACT-1")]
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await provider.sending[1].wait()
        told_as_it_started = await _told_at(connection)
        provider.release[1].set()
        await provider.sending[3].wait()
        told_after_the_earlier_half = await _told_at(connection)
        provider.release[3].set()
        await running

    assert (told_after_the_earlier_half > told_as_it_started) is told


async def test_job_offers_the_opening_adjustment_beside_the_reminder_of_an_import_that_got_nothing(connection, provider):
    """Everyday's import from 1 September gets no transaction, so it raises the reminder, and the opening adjustment doesn't wait on it"""
    await _list_under(connection, "CON-harbour", "Harbour Bank", "ACT-1")
    link = await _link(connection, "ACT-1", import_start=date(2026, 9, 1), checkpoint=date(2026, 8, 31))
    provider.outcomes = [_returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert await _history_reminders(link) == [(date(2026, 9, 1), None, False)]
    assert await _offer_states(link) == ["offered"]


# The day the bank first dated the coffee _record sends. The user added that coffee to the ledger
_COFFEE_DAY = date(2026, 10, 2)

# The bank values Keep current value declined when the bank changed the coffee to $4.75
_DECLINED_AT_4_75 = {"date": "2026-10-02", "amount": -4_75, "description": "POS 4411 COFFEE"}

# The coffee's bank transaction once the user kept POS 4411 COFFEE over the bank's BLUE BOTTLE COFFEE
_KEPT_POS_4411 = {
    "description": "BLUE BOTTLE COFFEE",
    "kept_description": "POS 4411 COFFEE",
    "declined_observation": {"date": "2026-10-02", "amount": -4_50, "description": "BLUE BOTTLE COFFEE"},
}

# How a correction stands: whether one is open, and the bank values from before it
_CORRECTION = (BankTransaction.open_kind, BankTransaction.previous_values)


async def _accept_coffee(
    link: BankAccountLink, external_id: str = "TRN-coffee", *, ledger: tuple[date, int] = (_COFFEE_DAY, -4_50), **values
) -> uuid.UUID:
    """Commit the $4.50 coffee on 2 October that _record sends as the user added it to the link's account, with its balances

    The bank sent it under the transaction ID given. The ledger row holds the date and amount
    given, and its bank transaction holds the bank's values, aligned with them, with any of its
    values replaced

    Returns:
        The bank transaction's id, the same as its review item's
    """
    _KNOWN_BANK_IDS.add(external_id)
    async with TestSession() as session:
        account = await session.get_one(Account, link.account_id)
        category_id = await session.scalar(select(Category.id).where(Category.is_system.is_(True)).limit(1))
        txn = _build_ledger_transaction(account, category_id, amount=ledger[1])
        txn.dt = ledger[0]
        session.add(txn)
        await session.flush()
        record = _build_bank_transaction(account, external_id, external_account_id=link.external_account_id, amount=-4_50, transaction=txn)
        record.observed_date = record.aligned_date = _COFFEE_DAY
        record.description = "POS 4411 COFFEE"
        for field, value in values.items():
            setattr(record, field, value)
        session.add(record)
        await recompute_account_snapshots(session, {account.id: ledger[0]})
        await session.commit()
    return record.id


async def _trust(link: BankAccountLink, *changes: str) -> None:
    """Commit the link's account's choice to apply these bank changes, corrections or removals, without review"""
    async with TestSession() as session:
        session.add(AccountReviewPreference(account_id=link.account_id, owner_id=link.owner_id, **dict.fromkeys(changes, ReviewDecision.TRUST)))
        await session.commit()


async def test_job_proposes_a_bank_change_to_a_transaction_in_the_ledger_and_keeps_the_approved_value(connection, provider, frozen_now):
    """The bank re-sends the $4.50 coffee the user added as $4.75

    With corrections set to review, the ledger keeps $4.50 and one correction opens, for the amount
    alone. The next re-read sends $4.75 again and leaves that correction exactly as it was
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    item_id = await _accept_coffee(link)
    corrected = _record("TRN-coffee", amount=-4_75, raw_amount="-4.75")
    provider.outcomes = [_returned_with({"ACT-1": [corrected]}), _returned_with({"ACT-1": [corrected]})]
    columns = (BankTransaction.id, *_CORRECTION, BankTransaction.observed_amount, BankTransaction.version)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()
    after_the_change = await _bank_transactions(*columns)

    await _bring_next_syncs_round(connection, frozen_now)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()

    assert len(provider.fetches) == 2
    assert after_the_change == [(item_id, OpenReviewKind.CORRECTION, {"amount": -4_50}, -4_75, 2)]
    assert await _bank_transactions(*columns) == after_the_change
    assert await _ledger_rows(link.account_id) == [(_COFFEE_DAY, -4_50)]


@pytest.mark.parametrize(
    ("ledger", "stored", "sent", "applied", "aligned"),
    [
        # The user moved the coffee to 1 October, and the bank now says 3 October and $4.75
        (
            (date(2026, 10, 1), -4_50),
            {},
            {"day": date(2026, 10, 3), "amount": -4_75, "raw_amount": "-4.75"},
            (date(2026, 10, 1), -4_75),
            (_COFFEE_DAY, -4_75),
        ),
        # The user kept $4.50 over the bank's $4.75 before trusting corrections, and the bank now
        # says 3 October and $5.00
        (
            (_COFFEE_DAY, -4_50),
            {"observed_amount": -4_75, "aligned_amount": -4_75, "declined_observation": _DECLINED_AT_4_75},
            {"day": date(2026, 10, 3), "amount": -5_00, "raw_amount": "-5.00"},
            (date(2026, 10, 3), -4_50),
            (date(2026, 10, 3), -4_75),
        ),
    ],
    ids=["date the user moved", "amount the user kept"],
)
async def test_job_applies_a_trusted_bank_change_only_to_the_fields_the_user_hasnt_edited(
    connection, provider, ledger, stored, sent, applied, aligned
):
    """With corrections trusted, the bank changes the coffee's date, amount and description, one of the first two edited by the user

    The other takes the bank's value and the balances follow it, the edited one keeps the user's
    value, and the description is only stored, with no correction to review
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    await _trust(link, "corrections")
    await _accept_coffee(link, ledger=ledger, **stored)
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee", description="BLUE BOTTLE COFFEE", **sent)]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _ledger_rows(link.account_id) == [applied]
    assert await _balances(link.account_id) == [applied]
    assert await _bank_transactions(
        *_CORRECTION, BankTransaction.aligned_date, BankTransaction.aligned_amount, BankTransaction.description
    ) == [(None, None, *aligned, "BLUE BOTTLE COFFEE")]


async def test_job_proposes_a_new_bank_description_on_its_own(connection, provider):
    """With corrections set to review, the bank re-sends the coffee as BLUE BOTTLE COFFEE and changes nothing else

    One correction opens for the description alone, and the ledger is unchanged
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    item_id = await _accept_coffee(link)
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee", description="BLUE BOTTLE COFFEE")]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(BankTransaction.id, *_CORRECTION, BankTransaction.description) == [
        (item_id, OpenReviewKind.CORRECTION, {"description": "POS 4411 COFFEE"}, "BLUE BOTTLE COFFEE")
    ]
    assert await _ledger_rows(link.account_id) == [(_COFFEE_DAY, -4_50)]


async def test_job_widens_an_open_correction_and_keeps_comparing_with_the_values_added(connection, provider, frozen_now):
    """A correction to $4.75 waits, then the bank moves the coffee to 3 October, then changes it to $5.00

    Each change joins the same correction. It still compares with the $4.50 on 2 October the user
    added, and the ledger keeps those values throughout
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    item_id = await _accept_coffee(link, observed_amount=-4_75, open_kind=OpenReviewKind.CORRECTION, previous_values={"amount": -4_50})
    provider.outcomes = [
        _returned_with({"ACT-1": [_record("TRN-coffee", date(2026, 10, 3), amount=-4_75, raw_amount="-4.75")]}),
        _returned_with({"ACT-1": [_record("TRN-coffee", date(2026, 10, 3), amount=-5_00, raw_amount="-5.00")]}),
    ]
    columns = (BankTransaction.id, *_CORRECTION, BankTransaction.observed_date, BankTransaction.observed_amount)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()
    widened = await _bank_transactions(*columns)

    await _bring_next_syncs_round(connection, frozen_now)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()

    added = {"date": "2026-10-02", "amount": -4_50}
    assert widened == [(item_id, OpenReviewKind.CORRECTION, added, date(2026, 10, 3), -4_75)]
    assert await _bank_transactions(*columns) == [(item_id, OpenReviewKind.CORRECTION, added, date(2026, 10, 3), -5_00)]
    assert await _ledger_rows(link.account_id) == [(_COFFEE_DAY, -4_50)]


async def test_job_closes_an_open_correction_once_the_bank_is_back_to_the_value_added(connection, provider):
    """The user added the coffee as $4.00, a correction to $4.75 waits, and the bank goes back to $4.50

    Nothing is left to decide, so the correction closes, and the user's $4.00 still counts as edited
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    await _accept_coffee(
        link, ledger=(_COFFEE_DAY, -4_00), observed_amount=-4_75, open_kind=OpenReviewKind.CORRECTION, previous_values={"amount": -4_50}
    )
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee")]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(*_CORRECTION, BankTransaction.observed_amount, BankTransaction.aligned_amount) == [
        (None, None, -4_50, -4_50)
    ]
    assert await _ledger_rows(link.account_id) == [(_COFFEE_DAY, -4_00)]


@pytest.mark.parametrize("trusted", [False, True], ids=["review", "trusted"])
async def test_job_aligns_a_date_the_bank_changes_to_the_one_the_user_chose_without_a_correction(connection, provider, trusted):
    """The user moved the coffee to 1 October, and the bank now dates it 1 October too

    The ledger already holds the bank's date, so whether corrections are reviewed or trusted, no
    correction opens, the ledger and its balances are left as they are, and the date no longer
    counts as edited
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    if trusted:
        await _trust(link, "corrections")
    await _accept_coffee(link, ledger=(date(2026, 10, 1), -4_50))
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee", date(2026, 10, 1))]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(*_CORRECTION, BankTransaction.observed_date, BankTransaction.aligned_date) == [
        (None, None, date(2026, 10, 1), date(2026, 10, 1))
    ]
    assert await _ledger_rows(link.account_id) == [(date(2026, 10, 1), -4_50)]
    assert await _balances(link.account_id) == [(date(2026, 10, 1), -4_50)]


async def test_job_opens_a_correction_for_an_amount_it_cant_store_exactly_though_corrections_are_trusted(connection, provider):
    """With corrections trusted, the bank re-sends the coffee as -4.755, more decimals than the account's currency holds

    It can't reach the ledger without rounding, so the ledger keeps $4.50 and a correction waits for the user
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    await _trust(link, "corrections")
    await _accept_coffee(link)
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee", amount=None, raw_amount="-4.755")]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _ledger_rows(link.account_id) == [(_COFFEE_DAY, -4_50)]
    assert await _bank_transactions(*_CORRECTION, BankTransaction.observed_amount, BankTransaction.raw_amount) == [
        (OpenReviewKind.CORRECTION, {"amount": -4_50}, None, "-4.755")
    ]


@pytest.mark.parametrize("end", ["original", "refund"])
async def test_job_opens_a_correction_for_the_amount_of_a_refund_linked_row_though_corrections_are_trusted(connection, provider, end):
    """With corrections trusted, the coffee is one end of a refund link and the bank re-sends it at another amount

    As the expense, a $4.50 coffee refunded by $1.00 comes again as $0.50. As the refund, a $2.00 return of a
    $10.00 expense comes again as $1.50. Either way a new amount is one an edit of the row could be refused
    for, so the ledger keeps the amount it has and a correction waits for the user, while the date still
    follows the bank. A tea with no link that the bank re-sends as $0.75 in the same run is still written
    """
    # The coffee's amount in the ledger and at the bank, the amount the bank re-sends, and the row linked to it
    kept, resent, resent_raw, other_amount = (-4_50, -50, "-0.50", 1_00) if end == "original" else (2_00, 1_50, "1.50", -10_00)
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    await _trust(link, "corrections")
    await _accept_coffee(link, ledger=(_COFFEE_DAY, kept), observed_amount=kept, aligned_amount=kept)
    await _accept_coffee(link, "TRN-tea")
    async with TestSession() as session:
        account = await session.get_one(Account, link.account_id)
        coffee = (
            await session.scalars(select(Transaction).where(Transaction.account_id == link.account_id).order_by(Transaction.created_at))
        ).first()
        other = _build_ledger_transaction(account, coffee.category_id, amount=other_amount)
        other.dt = _COFFEE_DAY
        session.add(other)
        await session.flush()
        linked = (other.id, coffee.id) if end == "original" else (coffee.id, other.id)
        session.add(TransactionLink(refund_transaction_id=linked[0], original_transaction_id=linked[1]))
        await session.commit()
    provider.outcomes = [
        _returned_with(
            {
                "ACT-1": [
                    _record("TRN-coffee", date(2026, 10, 3), amount=resent, raw_amount=resent_raw),
                    _record("TRN-tea", amount=-75, raw_amount="-0.75"),
                ]
            }
        )
    ]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert sorted(await _bank_transactions(*_CORRECTION, BankTransaction.observed_amount, BankTransaction.observed_date), key=str) == sorted(
        [(OpenReviewKind.CORRECTION, {"amount": kept}, resent, date(2026, 10, 3)), (None, None, -75, _COFFEE_DAY)], key=str
    )
    assert sorted(await _ledger_rows(link.account_id)) == sorted([(_COFFEE_DAY, -75), (date(2026, 10, 3), kept), (_COFFEE_DAY, other_amount)])


async def test_job_adds_a_bank_change_to_an_open_correction_though_corrections_are_now_trusted(connection, provider):
    """A correction to $4.75 waits from before the user trusted corrections, and the bank now moves the coffee to 3 October

    The waiting correction keeps waiting, so the new date joins it rather than reaching the ledger
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    await _trust(link, "corrections")
    await _accept_coffee(link, observed_amount=-4_75, open_kind=OpenReviewKind.CORRECTION, previous_values={"amount": -4_50})
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee", date(2026, 10, 3), amount=-4_75, raw_amount="-4.75")]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _ledger_rows(link.account_id) == [(_COFFEE_DAY, -4_50)]
    assert await _bank_transactions(*_CORRECTION) == [(OpenReviewKind.CORRECTION, {"date": "2026-10-02", "amount": -4_50})]


async def test_job_rebuilds_balances_from_the_earliest_day_trusted_corrections_touch(connection, provider):
    """With corrections trusted, the bank moves Everyday's two coffees to 29 September and 3 October, and Card's to 3 October

    Everyday's balances are rebuilt from 29 September, the earliest day either of its changes
    touches, and Card's from 2 October, the day its coffee left, so no balance still holds a coffee
    on 2 October
    """
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    card = await _link(connection, "ACT-card", **_synced_through_yesterday())
    for link in (everyday, card):
        await _trust(link, "corrections")
        await _accept_coffee(link)
    await _accept_coffee(everyday, "TRN-coffee-2")
    provider.outcomes = [
        _returned_with(
            {
                "ACT-everyday": [_record("TRN-coffee", date(2026, 9, 29)), _record("TRN-coffee-2", date(2026, 10, 3))],
                "ACT-card": [_record("TRN-coffee", date(2026, 10, 3))],
            }
        )
    ]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _balances(everyday.account_id) == [(date(2026, 9, 29), -4_50), (date(2026, 10, 3), -9_00)]
    assert await _balances(card.account_id) == [(date(2026, 10, 3), -4_50)]


async def _save_import(account_id: uuid.UUID) -> uuid.UUID:
    """Commit an import of one $12.50 row on 15 September into the account, stamped with the change marker its save set, as saving one is

    Returns:
        The import's id
    """
    async with TestSession() as session:
        account = await session.get_one(Account, account_id)
        category_id = await session.scalar(select(Category.id).where(Category.is_system.is_(True)).limit(1))
        run = ImportRun(owner_id=account.owner_id, expected_transaction_count=1, file_name="everyday.csv")
        session.add(run)
        await session.flush()
        txn = _build_ledger_transaction(account, category_id)
        txn.dt = date(2026, 9, 15)
        txn.import_run_id = run.id
        session.add(txn)
        await session.flush()
        await recompute_account_snapshots(session, {account.id: txn.dt})
        await mark_user_cache_changed(session, account.owner_id)
        run.committed_at = await session.scalar(select(UserCacheState.changed_at).where(UserCacheState.user_id == account.owner_id))
        await session.commit()
    return run.id


async def _undoable_import(connection: BankConnection) -> uuid.UUID | None:
    """Return the import the owner's Imports page offers to undo, or None when it offers none"""
    async with TestSession() as session:
        last = await get_last_import(session, await session.get_one(User, connection.owner_id))
    return last.id if last else None


@pytest.mark.parametrize("lists_first", [False, True], ids=["fetching", "listing-first"])
async def test_job_bringing_a_new_item_for_review_leaves_the_last_import_undoable(connection, provider, lists_first):
    """The owner saved an import into Everyday, then the daily sync, listing the bank accounts first or not, brings back a new coffee

    The coffee waits for review outside the ledger, so nothing the import wrote, or any balance, has
    changed and the import can still be undone. The owner's open pages still hear of the sync
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    run_id = await _save_import(link.account_id)
    told_before = await _told_at(connection)
    fetched = _returned_with({"ACT-1": [_record("TRN-coffee")]})
    provider.outcomes = [_returned("ACT-1"), fetched] if lists_first else [fetched]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED, discover=lists_first)

    await _run_jobs_until_none_is_due()

    assert len(provider.discoveries) == int(lists_first)
    assert await _checkpoints(link) == [_TODAY]
    assert await _bank_transactions(BankTransaction.disposition) == [(BankTransactionDisposition.AWAITING_REVIEW,)]
    assert await _undoable_import(connection) == run_id
    assert await _told_at(connection) > told_before


async def test_scan_listing_a_connection_never_listed_leaves_the_last_import_undoable(connection, provider, frozen_now):
    """The owner saved an import into Everyday, a manual account, while a claim two hours ago stopped before listing the bank accounts

    The scan queues the listing and the job lists them. That changes none of the owner's data, so
    the import can still be undone
    """
    await _set_discovered_at(connection, None)
    everyday = _build_account(connection.owner_id, name="Everyday")
    async with TestSession() as session:
        (await session.get(BankConnection, connection.id)).created_at = frozen_now - timedelta(hours=2)
        session.add(everyday)
        await session.commit()
    run_id = await _save_import(everyday.id)
    provider.outcomes = [_returned("ACT-everyday")]

    await enqueue_due_work()
    await _run_jobs_until_none_is_due()

    assert len(provider.discoveries) == 1
    assert await _undoable_import(connection) == run_id


async def test_job_applying_a_trusted_correction_makes_the_last_import_permanent(connection, provider):
    """The owner saved an import into Everyday, then the daily sync moves a coffee already in its ledger to 3 October

    Everyday trusts the bank's corrections, so the ledger and its balances change after the import,
    and undoing the import is no longer offered
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    await _trust(link, "corrections")
    await _accept_coffee(link)
    await _save_import(link.account_id)
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee", date(2026, 10, 3))]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert sorted(await _ledger_rows(link.account_id)) == [(date(2026, 9, 15), -12_50), (date(2026, 10, 3), -4_50)]
    assert await _undoable_import(connection) is None


async def test_job_stores_a_bank_change_dating_a_stored_transaction_before_the_import_start(connection, provider):
    """The link imports from 1 October, and the bank moves the coffee in the ledger and an item still waiting to 30 September

    The import start decides only which new records come in, so the coffee's correction opens and
    the waiting item takes the new date and keeps waiting, while a new record sent for that day
    stays out
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday(import_start=date(2026, 10, 1)))
    await _accept_coffee(link)
    await _store_bank_transaction(link, "TRN-waiting")
    redated = date(2026, 9, 30)
    provider.outcomes = [
        _returned_with({"ACT-1": [_record("TRN-coffee", redated), _record("TRN-new", redated), _record("TRN-waiting", redated)]})
    ]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    columns = (_BANK_ID, BankTransaction.disposition, BankTransaction.observed_date, *_CORRECTION)
    assert await _bank_transactions(*columns) == [
        ("TRN-coffee", BankTransactionDisposition.ACCEPTED, redated, OpenReviewKind.CORRECTION, {"date": "2026-10-02"}),
        ("TRN-waiting", BankTransactionDisposition.AWAITING_REVIEW, redated, None, None),
    ]
    assert await _ledger_rows(link.account_id) == [(_COFFEE_DAY, -4_50)]


async def test_job_opens_nothing_when_the_bank_goes_back_to_values_the_user_declined(connection, provider):
    """The user kept $4.50 over the bank's $4.75, and while corrections were trusted the bank moved on to $5.00, and that left $4.50 alone

    With corrections back to review, the bank sends $4.75 again, a value the user already declined, so no correction opens
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    await _accept_coffee(link, observed_amount=-5_00, aligned_amount=-4_75, declined_observation=_DECLINED_AT_4_75)
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee", amount=-4_75, raw_amount="-4.75")]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(*_CORRECTION, BankTransaction.observed_amount) == [(None, None, -4_75)]
    assert await _ledger_rows(link.account_id) == [(_COFFEE_DAY, -4_50)]


async def test_job_storing_while_the_user_keeps_the_current_value_compares_with_the_value_kept(connection, monkeypatch):
    """A correction to $4.75 waits, and the user keeps $4.50 as the job comes to store $5.00 for the coffee

    The job waits for the decision, then opens a new correction comparing $5.00 with the declined
    $4.75, rather than widening the correction the user closed with the values from before it
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    item_id = await _accept_coffee(link, observed_amount=-4_75, open_kind=OpenReviewKind.CORRECTION, previous_values={"amount": -4_50})
    provider = _HeldProvider()
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee", amount=-5_00, raw_amount="-5.00")]})]
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await provider.sending[1].wait()
        async with TestSession() as reviewing:
            blocker_pid = await reviewing.scalar(text("SELECT pg_backend_pid()"))
            await reviewing.execute(select(BankTransaction.id).where(BankTransaction.id == item_id).with_for_update())
            provider.release[1].set()
            await _wait_until_waiting_on(blocker_pid, running)

            # Keep current value as the decision writes it. A Core update moves the version itself
            await reviewing.execute(
                update(BankTransaction)
                .where(BankTransaction.id == item_id)
                .values(
                    version=BankTransaction.version + 1,
                    open_kind=None,
                    previous_values=None,
                    aligned_amount=-4_75,
                    declined_observation=_DECLINED_AT_4_75,
                )
            )
            await reviewing.commit()
        assert await running == 1

    assert await _bank_transactions(BankTransaction.id, *_CORRECTION, BankTransaction.observed_amount) == [
        (item_id, OpenReviewKind.CORRECTION, {"amount": -4_75}, -5_00)
    ]
    assert await _ledger_rows(link.account_id) == [(_COFFEE_DAY, -4_50)]


async def test_job_asks_about_a_declined_value_again_once_the_bank_has_since_matched_the_ledger(connection, provider, frozen_now):
    """The user kept $4.50 over the bank's $4.75, the bank then agreed on $4.50, and now says $4.75 again

    The bank agreeing with the ledger ended what the user declined, so $4.75 is a new change and a correction opens for it
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    item_id = await _accept_coffee(link, observed_amount=-4_75, aligned_amount=-4_75, declined_observation=_DECLINED_AT_4_75)
    provider.outcomes = [
        _returned_with({"ACT-1": [_record("TRN-coffee")]}),
        _returned_with({"ACT-1": [_record("TRN-coffee", amount=-4_75, raw_amount="-4.75")]}),
    ]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()

    await _bring_next_syncs_round(connection, frozen_now)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()

    assert len(provider.fetches) == 2
    assert await _bank_transactions(BankTransaction.id, *_CORRECTION, BankTransaction.declined_observation) == [
        (item_id, OpenReviewKind.CORRECTION, {"amount": -4_50}, None)
    ]
    assert await _ledger_rows(link.account_id) == [(_COFFEE_DAY, -4_50)]


async def test_job_asks_again_when_the_bank_revises_an_amount_it_cant_store_exactly(connection, provider):
    """The user kept $4.50 over the bank's -4.755, a value CAD can't hold, and the bank now says -4.756

    Both amounts are kept only as the bank sent them, and they differ, so a correction opens
    against the -4.755 declined
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    declined = {"date": "2026-10-02", "amount": "-4.755", "description": "POS 4411 COFFEE"}
    await _accept_coffee(link, observed_amount=None, raw_amount="-4.755", aligned_amount=None, declined_observation=declined)
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee", amount=None, raw_amount="-4.756")]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(*_CORRECTION, BankTransaction.raw_amount) == [(OpenReviewKind.CORRECTION, {"amount": "-4.755"}, "-4.756")]
    assert await _ledger_rows(link.account_id) == [(_COFFEE_DAY, -4_50)]


@pytest.mark.parametrize("trusted", [False, True], ids=["review", "trusted"])
async def test_job_opens_nothing_when_the_bank_goes_back_to_the_description_the_user_kept(connection, provider, trusted):
    """The user kept POS 4411 COFFEE when the bank renamed the coffee BLUE BOTTLE COFFEE, and the bank now sends POS 4411 COFFEE again

    Whether corrections are reviewed or trusted, the description is stored with no correction. The
    ledger follows the bank's description again, and what the user declined no longer stands, so the
    bank sending BLUE BOTTLE COFFEE later would ask again
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    if trusted:
        await _trust(link, "corrections")
    await _accept_coffee(link, **_KEPT_POS_4411)
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee")]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    columns = (*_CORRECTION, BankTransaction.description, BankTransaction.kept_description, BankTransaction.declined_observation)
    assert await _bank_transactions(*columns) == [(None, None, "POS 4411 COFFEE", None, None)]


@pytest.mark.parametrize(
    ("trusted", "correction"),
    [(False, (OpenReviewKind.CORRECTION, {"description": "BLUE BOTTLE COFFEE"})), (True, (None, None))],
    ids=["review", "trusted"],
)
async def test_job_compares_a_new_bank_description_with_the_one_the_user_kept(connection, provider, trusted, correction):
    """The user kept POS 4411 COFFEE when the bank renamed the coffee BLUE BOTTLE COFFEE, and the bank now sends BLUE BOTTLE CAFE

    Set to review, a correction opens proposing BLUE BOTTLE CAFE, and trusted, the description is
    only stored. Either way the ledger keeps POS 4411 COFFEE, as it keeps a date or amount the user kept
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    if trusted:
        await _trust(link, "corrections")
    await _accept_coffee(link, **_KEPT_POS_4411)
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee", description="BLUE BOTTLE CAFE")]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(*_CORRECTION, BankTransaction.description, BankTransaction.kept_description) == [
        (*correction, "BLUE BOTTLE CAFE", "POS 4411 COFFEE")
    ]


async def test_job_applying_a_trusted_amount_keeps_the_description_the_user_kept(connection, provider):
    """With corrections trusted, the bank changes the coffee to $4.75 after the user kept POS 4411 COFFEE over its BLUE BOTTLE COFFEE

    The ledger takes $4.75, and the description kept stays the ledger's, since the bank didn't change it
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    await _trust(link, "corrections")
    await _accept_coffee(link, **_KEPT_POS_4411)
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee", amount=-4_75, raw_amount="-4.75", description="BLUE BOTTLE COFFEE")]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _ledger_rows(link.account_id) == [(_COFFEE_DAY, -4_75)]
    assert await _bank_transactions(*_CORRECTION, BankTransaction.kept_description) == [(None, None, "POS 4411 COFFEE")]


async def test_job_follows_each_accounts_own_choice_for_corrections(connection, provider):
    """Everyday trusts corrections and Card reviews them, and one response changes the coffee in each to $4.75

    Everyday's ledger takes $4.75 with nothing to review, while Card's keeps $4.50 with a correction waiting
    """
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    card = await _link(connection, "ACT-card", **_synced_through_yesterday())
    await _trust(everyday, "corrections")
    for link in (everyday, card):
        await _accept_coffee(link)
    corrected = _record("TRN-coffee", amount=-4_75, raw_amount="-4.75")
    provider.outcomes = [_returned_with({"ACT-everyday": [corrected], "ACT-card": [corrected]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _ledger_rows(everyday.account_id) == [(_COFFEE_DAY, -4_75)]
    assert await _ledger_rows(card.account_id) == [(_COFFEE_DAY, -4_50)]
    assert await _bank_transactions(BankTransaction.external_account_id, *_CORRECTION) == [
        ("ACT-card", OpenReviewKind.CORRECTION, {"amount": -4_50}),
        ("ACT-everyday", None, None),
    ]


async def test_job_applying_a_trusted_change_waits_for_an_edit_to_the_ledger_row_and_keeps_it(connection, provider):
    """With corrections trusted, the bank changes the coffee to $4.75 while the user is saving $4.00 for it

    The job waits for the user's save, then finds the amount edited and leaves the user's $4.00
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    await _trust(link, "corrections")
    await _accept_coffee(link)
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee", amount=-4_75, raw_amount="-4.75")]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    async with asyncio.timeout(_WAIT_SECONDS), TestSession() as editing:
        ledger_row = select(Transaction.id).where(Transaction.account_id == link.account_id)
        await editing.execute(ledger_row.with_for_update())
        blocker_pid = await editing.scalar(text("SELECT pg_backend_pid()"))
        running = asyncio.create_task(run_jobs(1))
        await _wait_until_waiting_on(blocker_pid, running)
        await editing.execute(update(Transaction).where(Transaction.account_id == link.account_id).values(amount=-4_00))
        await editing.commit()
        assert await running == 1

    assert await _ledger_rows(link.account_id) == [(_COFFEE_DAY, -4_00)]
    assert await _bank_transactions(*_CORRECTION, BankTransaction.observed_amount, BankTransaction.aligned_amount) == [
        (None, None, -4_75, -4_50)
    ]


@pytest.mark.parametrize(
    ("sent", "opened"),
    [
        ({"amount": -4_75, "raw_amount": "-4.75"}, (OpenReviewKind.CORRECTION, {"amount": -4_50})),
        ({"removed": True}, (OpenReviewKind.REMOVAL, None)),
    ],
    ids=["correction", "removal"],
)
async def test_job_tells_the_owners_pages_as_a_part_before_today_opens_a_correction_or_removal(connection, monkeypatch, sent, opened):
    """The daily re-read comes back cut short, and its earlier half, 19 to 26 September, changes or removes a coffee from 22 September

    The correction or removal is stored with the earlier half, so the owner's open pages hear of it
    while the later half is still out
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    coffee_day = date(2026, 9, 22)
    await _accept_coffee(link, ledger=(coffee_day, -4_50), observed_date=coffee_day, aligned_date=coffee_day)
    provider = _HeldProvider(held=(1, 3))
    provider.outcomes = [
        _cut_off("ACT-1"),
        _returned_with({"ACT-1": [_record("TRN-coffee", coffee_day, **sent)]}),
        _returned("ACT-1"),
    ]
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await provider.sending[1].wait()
        told_as_it_started = await _told_at(connection)
        provider.release[1].set()
        await provider.sending[3].wait()
        told_after_the_earlier_half = await _told_at(connection)
        open_after_the_earlier_half = await _bank_transactions(*_CORRECTION)
        provider.release[3].set()
        await running

    assert open_after_the_earlier_half == [opened]
    assert told_as_it_started is not None
    assert told_after_the_earlier_half > told_as_it_started


# How a removal stands: the item open and the bank values from before a correction, as for a
# correction, and when the provider reported the removal
_REMOVAL = (*_CORRECTION, BankTransaction.removed_at)


def _groceries(**values) -> ProviderRecord:
    """Return the -40.00 groceries on 2 October as the provider sends them, or reports them removed"""
    return _record("TRN-groceries", **{"amount": -40_00, "raw_amount": "-40.00", "description": "FRESHCO GROCERIES"} | values)


async def _accept_groceries(link: BankAccountLink, **values) -> uuid.UUID:
    """Commit the -40.00 groceries _groceries sends as the user added them to the link's account, edited to -42.00, with their balances

    Their bank transaction holds the bank's values, aligned with them, with any of its values replaced

    Returns:
        The bank transaction's id, the same as its review item's
    """
    bank_values = {"observed_amount": -40_00, "aligned_amount": -40_00, "description": "FRESHCO GROCERIES"}
    return await _accept_coffee(link, "TRN-groceries", ledger=(_COFFEE_DAY, -42_00), **bank_values | values)


async def _accept_on(link: BankAccountLink, external_id: str, day: date, amount: int) -> None:
    """Commit a transaction the bank sent under the ID given as the user added it to the link's account, on the day and at the amount given"""
    await _accept_coffee(
        link, external_id, ledger=(day, amount), observed_date=day, aligned_date=day, observed_amount=amount, aligned_amount=amount
    )


async def _ledger_transaction_id(record_id: uuid.UUID) -> uuid.UUID:
    """Return the ledger transaction a bank transaction was added as"""
    async with TestSession() as session:
        return await session.scalar(select(BankTransaction.transaction_id).where(BankTransaction.id == record_id))


async def _move_out_while_unlinked(connection: BankConnection, link: BankAccountLink, transaction_id: uuid.UUID) -> uuid.UUID:
    """Unlink the link's account, move the ledger transaction to a new Savings account through the edit service, then link the account again

    The edit files the transaction under Groceries and Myself, as an edit needs them, and the new link
    follows the same bank account, synced through yesterday

    Returns:
        Savings' id
    """
    async with TestSession() as session:
        await session.execute(
            update(BankAccountLink).where(BankAccountLink.id == link.id).values(state=BankLinkState.UNLINKED, unlinked_at=_YESTERDAYS_SYNC)
        )
        savings = _build_account(link.owner_id, name="Savings")
        session.add(savings)
        groceries = await session.scalar(select(Category.id).where(Category.is_system.is_(True), Category.name == "Groceries"))
        myself = await session.scalar(select(Merchant.id).where(Merchant.is_system.is_(True), Merchant.name == SELF_MERCHANT_NAME))
        await session.commit()
    async with _owner_session(link.owner_id) as session:
        user = await session.get_one(User, link.owner_id)
        txn = await session.get_one(Transaction, transaction_id)
        await apply_transaction_update(
            session, user, txn, UpdateTransactionRequest(account_id=savings.id, category_id=groceries, merchant_id=myself)
        )
        await session.commit()
    async with TestSession() as session:
        relinked = _build_bank_link(await session.get_one(Account, link.account_id), connection, link.external_account_id)
        for field, value in _synced_through_yesterday().items():
            setattr(relinked, field, value)
        session.add(relinked)
        await session.commit()
    return savings.id


async def test_job_opens_a_removal_for_a_transaction_in_the_ledger_and_leaves_the_ledger_as_it_is(connection, provider, frozen_now):
    """With removals set to review, the provider removes the -40.00 groceries the user added as -42.00

    The -42.00 stays in the ledger and its balance, and a removal opens on the groceries, so the
    transaction shows Needs review until the user decides
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    item_id = await _accept_groceries(link)
    provider.outcomes = [_returned_with({"ACT-1": [_groceries(removed=True)]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(BankTransaction.id, *_REMOVAL) == [(item_id, OpenReviewKind.REMOVAL, None, frozen_now)]
    assert await _ledger_rows(link.account_id) == [(_COFFEE_DAY, -42_00)]
    assert await _balances(link.account_id) == [(_COFFEE_DAY, -42_00)]


async def test_job_deletes_a_trusted_removal_from_the_ledger_and_follows_each_accounts_own_choice(connection, provider):
    """Everyday trusts removals and Card reviews them, and one response removes the groceries the user added as -42.00 to each

    Everyday's groceries leave the ledger with their bank transaction and nothing to review, so its
    balance on 2 October rises by 42.00 to the -4.50 of a coffee that day. Card's stay, with a
    removal waiting
    """
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    card = await _link(connection, "ACT-card", **_synced_through_yesterday())
    await _trust(everyday, "removals")
    for link in (everyday, card):
        await _accept_groceries(link)
    await _accept_coffee(everyday)
    balance_before = await _balances(everyday.account_id)
    removed = _groceries(removed=True)
    provider.outcomes = [_returned_with({"ACT-everyday": [removed], "ACT-card": [removed]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert balance_before == [(_COFFEE_DAY, -46_50)]
    assert await _ledger_rows(everyday.account_id) == [(_COFFEE_DAY, -4_50)]
    assert await _balances(everyday.account_id) == [(_COFFEE_DAY, -4_50)]
    assert await _ledger_rows(card.account_id) == [(_COFFEE_DAY, -42_00)]
    assert await _bank_transactions(BankTransaction.external_account_id, _BANK_ID, BankTransaction.open_kind) == [
        ("ACT-card", "TRN-groceries", OpenReviewKind.REMOVAL),
        ("ACT-everyday", "TRN-coffee", None),
    ]


async def test_job_deletes_a_trusted_removal_of_a_refund_linked_row_with_its_link_and_keeps_the_other_side(connection, provider):
    """Removals are trusted, a $1.00 refund is linked to the coffee, and the bank reports the coffee removed

    The coffee goes with its link, as deleting it by hand does, and the refund stays
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    await _trust(link, "removals")
    await _accept_coffee(link)
    async with TestSession() as session:
        coffee = await session.scalar(select(Transaction).where(Transaction.account_id == link.account_id))
        refund = _build_ledger_transaction(await session.get_one(Account, link.account_id), coffee.category_id, amount=1_00)
        refund.dt = _COFFEE_DAY
        session.add(refund)
        await session.flush()
        session.add(TransactionLink(refund_transaction_id=refund.id, original_transaction_id=coffee.id))
        await session.commit()
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee", removed=True)]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _ledger_rows(link.account_id) == [(_COFFEE_DAY, 1_00)]
    async with TestSession() as session:
        assert await session.scalar(select(func.count()).select_from(TransactionLink)) == 0


async def test_job_takes_out_an_item_the_provider_withdraws_and_brings_the_same_transaction_back_as_new(connection, provider, frozen_now):
    """The provider removes the groceries while they wait in the inbox, and the next daily sync sends them again as posted

    They leave the inbox with no task and nothing in the ledger, then arrive as a new item awaiting
    review, under a new id
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    withdrawn_id = await _store_bank_transaction(link, "TRN-groceries")
    provider.outcomes = [_returned_with({"ACT-1": [_groceries(removed=True)]}), _returned_with({"ACT-1": [_groceries()]})]
    columns = (BankTransaction.id, BankTransaction.disposition, *_REMOVAL)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()
    after_the_removal = await _bank_transactions(*columns)

    await _bring_next_syncs_round(connection, frozen_now)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()

    assert after_the_removal == []
    [(returned_id, *returned)] = await _bank_transactions(*columns)
    assert returned_id != withdrawn_id
    assert returned == [BankTransactionDisposition.AWAITING_REVIEW, None, None, None]
    assert await _ledger_rows(link.account_id) == []


async def test_job_changes_nothing_for_transactions_missing_from_a_later_fetch(connection, provider):
    """The groceries are in the ledger and a coffee waits in the inbox, and the next fetch brings back neither, only a new lunch

    A provider that reports no removals, as Fake Bank doesn't, says nothing about what it leaves out,
    so while the lunch is stored as a new item, both stay exactly as they were, with nothing opened
    and the ledger and its balance unchanged
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    await _accept_groceries(link)
    await _store_bank_transaction(link, "TRN-coffee")
    columns = (_BANK_ID, BankTransaction.disposition, *_REMOVAL, BankTransaction.version)
    stored = await _bank_transactions(*columns)
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-lunch", amount=-15_00, raw_amount="-15.00", description="LUNCH")]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert len(provider.fetches) == 1
    assert await _bank_transactions(*columns) == [*stored, ("TRN-lunch", BankTransactionDisposition.AWAITING_REVIEW, None, None, None, 1)]
    assert await _ledger_rows(link.account_id) == [(_COFFEE_DAY, -42_00)]
    assert await _balances(link.account_id) == [(_COFFEE_DAY, -42_00)]


@pytest.mark.parametrize(
    ("in_ledger", "stored"),
    [
        (False, _DISMISSED),
        (True, {"open_kind": OpenReviewKind.REMOVAL, "removed_at": _YESTERDAYS_SYNC}),
        (True, {"removed_at": _YESTERDAYS_SYNC}),
    ],
    ids=["dismissed", "removal waiting", "removal kept"],
)
async def test_job_changes_nothing_when_the_provider_removes_a_dismissed_transaction_or_repeats_a_removal(
    connection, provider, in_ledger, stored
):
    """The provider removes the groceries the user dismissed, or reports again a removal of them already waiting or kept

    A dismissal stands whatever the bank says, and a removal already reported opens nothing more,
    so the groceries and the ledger are left exactly as they were
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    if in_ledger:
        await _accept_groceries(link, **stored)
    else:
        await _store_bank_transaction(link, "TRN-groceries", **stored)
    columns = (BankTransaction.disposition, *_REMOVAL, BankTransaction.version)
    before = (await _bank_transactions(*columns), await _ledger_rows(link.account_id))
    provider.outcomes = [_returned_with({"ACT-1": [_groceries(removed=True)]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert len(provider.fetches) == 1
    assert (await _bank_transactions(*columns), await _ledger_rows(link.account_id)) == before


async def test_job_opens_a_removal_in_place_of_an_open_correction_and_keeps_its_values_from_before(connection, provider, frozen_now):
    """A correction of the groceries to -41.00 waits when the provider removes them

    The removal takes the correction's place as the one open item and keeps the -40.00 from before
    it, so keeping the transaction can bring the correction back. The bank's -41.00 and the
    ledger's -42.00 stay as they were
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    item_id = await _accept_groceries(link, observed_amount=-41_00, open_kind=OpenReviewKind.CORRECTION, previous_values={"amount": -40_00})
    provider.outcomes = [_returned_with({"ACT-1": [_groceries(removed=True)]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(BankTransaction.id, *_REMOVAL, BankTransaction.observed_amount) == [
        (item_id, OpenReviewKind.REMOVAL, {"amount": -40_00}, frozen_now, -41_00)
    ]
    assert await _ledger_rows(link.account_id) == [(_COFFEE_DAY, -42_00)]


@pytest.mark.parametrize(
    ("trusted", "stored", "sent", "opened"),
    [
        (False, {}, {}, (None, None)),
        (False, {"open_kind": None}, {}, (None, None)),
        (False, {}, {"amount": -41_00, "raw_amount": "-41.00"}, (OpenReviewKind.CORRECTION, {"amount": -40_00})),
        (
            False,
            {"observed_amount": -41_00, "previous_values": {"amount": -40_00}},
            {"amount": -41_00, "raw_amount": "-41.00"},
            (OpenReviewKind.CORRECTION, {"amount": -40_00}),
        ),
        (
            True,
            {"observed_amount": -41_00, "previous_values": {"amount": -40_00}},
            {"amount": -41_00, "raw_amount": "-41.00"},
            (OpenReviewKind.CORRECTION, {"amount": -40_00}),
        ),
    ],
    ids=["removal waiting", "removal kept", "changed", "correction it took the place of", "correction it took the place of, trusted"],
)
async def test_job_closes_a_removal_once_the_provider_sends_the_transaction_again(connection, provider, trusted, stored, sent, opened):
    """A removal of the groceries waits, or was kept, and the provider sends them again as they were or at -41.00

    The groceries are back, so the removal is over, and what was sent is compared like any other
    change: -41.00 opens a correction against the -40.00 the ledger was decided against, whether new
    or the correction the removal took the place of. That one keeps waiting though corrections are now
    trusted. The ledger keeps the user's -42.00
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    if trusted:
        await _trust(link, "corrections")
    item_id = await _accept_groceries(link, **{"open_kind": OpenReviewKind.REMOVAL, "removed_at": _YESTERDAYS_SYNC} | stored)
    provider.outcomes = [_returned_with({"ACT-1": [_groceries(**sent)]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(BankTransaction.id, *_REMOVAL) == [(item_id, *opened, None)]
    assert await _ledger_rows(link.account_id) == [(_COFFEE_DAY, -42_00)]


async def test_job_applies_a_trusted_change_to_a_transaction_the_provider_sends_again_after_removing_it(connection, provider):
    """With corrections trusted, a removal of the coffee waits, and the provider sends it again moved to 3 October

    The coffee is back, so the removal closes and the move reaches the ledger and its balances like
    any trusted change, with nothing left to review
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    await _trust(link, "corrections")
    await _accept_coffee(link, open_kind=OpenReviewKind.REMOVAL, removed_at=_YESTERDAYS_SYNC)
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee", date(2026, 10, 3))]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(*_REMOVAL) == [(None, None, None)]
    assert await _ledger_rows(link.account_id) == [(date(2026, 10, 3), -4_50)]
    assert await _balances(link.account_id) == [(date(2026, 10, 3), -4_50)]


async def test_job_rebuilds_balances_from_the_earliest_day_trusted_corrections_and_removals_touch(connection, provider):
    """Everyday and Card trust corrections and removals, and one response changes both

    In Everyday the bank moves a coffee from 2 to 29 September and removes the groceries from 3
    October, and in Card it removes a transaction from 3 October and then one from 1 October,
    leaving a coffee on 2 October. Each account's balances are rebuilt from the earliest day any of
    its changes touches, 29 September and 1 October, so no balance still counts what moved or went
    """
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    card = await _link(connection, "ACT-card", **_synced_through_yesterday())
    for link in (everyday, card):
        await _trust(link, "corrections", "removals")
        await _accept_on(link, "TRN-coffee", _COFFEE_DAY, -4_50)
    await _accept_on(everyday, "TRN-groceries", date(2026, 10, 3), -42_00)
    await _accept_on(card, "TRN-late", date(2026, 10, 3), -10_00)
    await _accept_on(card, "TRN-early", date(2026, 10, 1), -20_00)
    balances_before = (await _balances(everyday.account_id), await _balances(card.account_id))
    provider.outcomes = [
        _returned_with(
            {
                "ACT-everyday": [_record("TRN-coffee", date(2026, 9, 29)), _record("TRN-groceries", removed=True)],
                "ACT-card": [_record("TRN-late", removed=True), _record("TRN-early", removed=True)],
            }
        )
    ]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert balances_before == (
        [(_COFFEE_DAY, -4_50), (date(2026, 10, 3), -46_50)],
        [(date(2026, 10, 1), -20_00), (_COFFEE_DAY, -24_50), (date(2026, 10, 3), -34_50)],
    )
    assert await _balances(everyday.account_id) == [(date(2026, 9, 29), -4_50)]
    assert await _balances(card.account_id) == [(_COFFEE_DAY, -4_50)]


@pytest.mark.parametrize(
    ("trusted", "sent", "stored"),
    [
        ("removals", {"removed": True}, []),
        ("corrections", {"day": date(2026, 10, 3)}, [("TRN-groceries", BankTransactionDisposition.AWAITING_REVIEW)]),
    ],
    ids=["trusted removal", "trusted correction"],
)
async def test_job_leaves_alone_a_transaction_the_user_moved_out_of_the_account_while_it_was_unlinked(
    connection, provider, trusted, sent, stored
):
    """The user unlinks Everyday, moves the groceries to Savings, links Everyday again and trusts removals or corrections

    The bank then removes the groceries, or moves them to 3 October. Moving them out took them off
    the bank, so Savings keeps them as they are: the removal finds nothing to remove, and the
    groceries sent again arrive in Everyday as a new item
    """
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    record_id = await _accept_groceries(everyday)
    savings_id = await _move_out_while_unlinked(connection, everyday, await _ledger_transaction_id(record_id))
    await _trust(everyday, trusted)
    provider.outcomes = [_returned_with({"ACT-everyday": [_groceries(**sent)]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _ledger_rows(savings_id) == [(_COFFEE_DAY, -42_00)]
    assert await _balances(savings_id) == [(_COFFEE_DAY, -42_00)]
    assert await _bank_transactions(_BANK_ID, BankTransaction.disposition) == stored


async def test_job_withdrawing_an_item_the_user_is_adding_waits_and_opens_a_removal_instead(connection, monkeypatch, frozen_now):
    """The user adds the waiting groceries to the ledger as -42.00 while the job comes to store the provider's removal of them

    The job waits for the add, then finds the groceries in the ledger, so it opens a removal for the
    user to decide rather than deleting a transaction the user just added
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    item_id = await _store_bank_transaction(link, "TRN-groceries")
    provider = _HeldProvider()
    provider.outcomes = [_returned_with({"ACT-1": [_groceries(removed=True)]})]
    use_adapter(monkeypatch, provider)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await provider.sending[1].wait()
        async with TestSession() as reviewing:
            blocker_pid = await reviewing.scalar(text("SELECT pg_backend_pid()"))
            await reviewing.execute(select(BankTransaction.id).where(BankTransaction.id == item_id).with_for_update())
            provider.release[1].set()
            await _wait_until_waiting_on(blocker_pid, running)

            # Add to ledger as the decision writes it. A Core update moves the version itself
            account = await reviewing.get_one(Account, link.account_id)
            category_id = await reviewing.scalar(select(Category.id).where(Category.is_system.is_(True)).limit(1))
            txn = _build_ledger_transaction(account, category_id, amount=-42_00)
            added = (txn.id, txn.dt)
            reviewing.add(txn)
            await reviewing.flush()
            await reviewing.execute(
                update(BankTransaction)
                .where(BankTransaction.id == item_id)
                .values(
                    version=BankTransaction.version + 1,
                    disposition=BankTransactionDisposition.ACCEPTED,
                    transaction_id=added[0],
                    aligned_date=BankTransaction.observed_date,
                    aligned_amount=BankTransaction.observed_amount,
                )
            )
            await reviewing.commit()
        assert await running == 1

    assert await _bank_transactions(BankTransaction.id, BankTransaction.disposition, *_REMOVAL) == [
        (item_id, BankTransactionDisposition.ACCEPTED, OpenReviewKind.REMOVAL, None, frozen_now)
    ]
    assert await _ledger_rows(link.account_id) == [(added[1], -42_00)]


@pytest.mark.parametrize(("draw", "after"), [("shortest", timedelta(hours=24)), ("longest", timedelta(hours=24, minutes=30))])
def test_next_daily_sync_falls_24_hours_on_plus_a_random_0_to_30_minutes(monkeypatch, draw, after):
    """A sync at 9 am on 3 October next runs between 9 and 9:30 am on 4 October, both ends included"""
    monkeypatch.setattr(schedule, "randbelow", lambda limit: 0 if draw == "shortest" else limit - 1)

    assert next_daily_sync(_YESTERDAYS_SYNC) == _YESTERDAYS_SYNC + after


@pytest.mark.parametrize(
    ("timezone", "started_at", "today", "next_sync"),
    [
        (_BRISBANE, datetime(2026, 10, 4, 13, tzinfo=_BRISBANE), _TODAY, datetime(2026, 10, 5, 13, 30, tzinfo=_BRISBANE)),
        (_PHOENIX, datetime(2026, 10, 3, 20, tzinfo=_PHOENIX), date(2026, 10, 3), datetime(2026, 10, 4, 20, 30, tzinfo=_PHOENIX)),
        (_SYDNEY, datetime(2026, 10, 4, 1, tzinfo=_SYDNEY), _TODAY, datetime(2026, 10, 5, 2, 30, tzinfo=_SYDNEY)),
    ],
    ids=["brisbane", "phoenix_a_day_behind_utc", "sydney_as_clocks_go_forward"],
)
@pytest.mark.usefixtures("day_later")
async def test_job_bringing_a_link_through_today_sets_its_next_sync_a_day_on(connection, provider, timezone, started_at, today, next_sync):
    """A daily sync brings Everyday through today in the owner's timezone, and Everyday and its connection next sync 24 and a half hours on

    In Phoenix it's still 3 October, so today is the 3rd though UTC has reached the 4th. In
    Sydney, a sync at 1 am on the day clocks go forward an hour next runs at 2:30 am, a day of
    elapsed time on, not at 1:30 am by the clock
    """
    await _set_owner_timezone(connection, timezone)
    link = await _link(connection, "ACT-everyday", **_synced_through_yesterday(next_attempt_at=started_at))
    provider.outcomes = [_returned("ACT-everyday")]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    with freeze_time(started_at, real_asyncio=True):
        await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 9, 19), today, ["ACT-everyday"], pending=True, timezone=timezone)]
    assert [next_attempt for *_, next_attempt in await _attempts(link)] == [next_sync]
    assert await _next_sync(connection) == next_sync


async def test_job_brings_links_due_within_12_hours_onto_one_daily_sync(connection, provider, frozen_now, day_later):
    """Everyday is due at 1 pm and Savings at 9:28 pm, so the 1 pm sync takes both in one request and both next sync together

    Travel, due at 1:01 am tomorrow, 12 hours and a minute away, isn't taken in, so the connection's
    next sync is Travel's, the earliest among its links
    """
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday(next_attempt_at=frozen_now))
    savings = await _link(connection, "ACT-savings", **_synced_through_yesterday(next_attempt_at=frozen_now + timedelta(hours=8, minutes=28)))
    travel_due = frozen_now + timedelta(hours=12, minutes=1)
    travel = await _link(connection, "ACT-travel", **_synced_through_yesterday(next_attempt_at=travel_due))
    provider.outcomes = [_returned("ACT-everyday", "ACT-savings")]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 9, 19), _TODAY, ["ACT-everyday", "ACT-savings"], pending=True)]
    assert [next_attempt for *_, next_attempt in await _attempts(everyday, savings, travel)] == [
        frozen_now + day_later,
        frozen_now + day_later,
        travel_due,
    ]
    assert await _next_sync(connection) == travel_due


@pytest.mark.parametrize(
    ("values", "joins"),
    [
        ({}, True),
        ({"paused": True}, False),
        ({"paused": True, "importing": True}, True),
        ({"retry_count": 1}, True),
        ({"state": BankLinkState.CHOOSE_ACCOUNT}, False),
        ({"state": BankLinkState.UNLINKED, "unlinked_at": datetime(2026, 10, 1, tzinfo=UTC)}, False),
    ],
    ids=["active", "paused_for_review", "importing_though_paused", "waiting_to_retry", "waiting_for_its_bank_account", "unlinked"],
)
async def test_connections_next_sync_is_the_earliest_time_one_of_its_links_is_due(connection, frozen_now, values, joins):
    """Savings next syncs 13 hours from now and Everyday 20, so the connection next syncs in 13 hours while Savings can sync

    A link the review pause holds back and one that can't sync leave the schedule to Everyday. An
    import runs whatever the pause, and a link waiting to retry is due at its retry. Travel, due in
    an hour on the owner's other connection, counts toward that connection alone
    """
    other = await _commit_bank_connection(connection.owner_id, created_at=frozen_now - timedelta(days=1))
    await _link(other, "ACT-travel", **_synced_through_yesterday(next_attempt_at=frozen_now + timedelta(hours=1)))
    await _link(connection, "ACT-everyday", **_synced_through_yesterday(next_attempt_at=frozen_now + timedelta(hours=20)))
    await _link(connection, "ACT-savings", **_synced_through_yesterday(next_attempt_at=frozen_now + timedelta(hours=13)) | values)

    await _schedule_next_sync(connection, frozen_now)

    assert await _next_sync(connection) == frozen_now + timedelta(hours=13 if joins else 20)


@pytest.mark.parametrize(
    ("savings", "next_sync"),
    [({"next_attempt_at": None}, timedelta(0)), ({"paused": True}, None)],
    ids=["link_with_no_next_attempt", "every_link_paused"],
)
async def test_connections_next_sync_is_now_for_a_link_with_no_next_attempt_and_none_with_no_link_on_the_schedule(
    connection, frozen_now, savings, next_sync
):
    """Everyday is paused, and Savings, with no next attempt set, is due at once, or is paused too, leaving the connection no next sync"""
    await _link(connection, "ACT-everyday", **_synced_through_yesterday(paused=True, next_attempt_at=frozen_now))
    await _link(connection, "ACT-savings", **_synced_through_yesterday(next_attempt_at=frozen_now) | savings)

    await _schedule_next_sync(connection, frozen_now)

    assert await _next_sync(connection) == (None if next_sync is None else frozen_now + next_sync)


async def test_connections_next_sync_waits_until_the_first_day_a_link_needs_starts_in_the_owners_timezone(connection, frozen_now):
    """In Phoenix it's 8 pm on 3 October, and Everyday, with no next attempt set, imports from the 4th

    No sync before midnight there has a day to fetch for Everyday, so the connection next syncs at
    midnight in Phoenix, not now, and not at midnight in UTC, since that has already passed
    """
    await _set_owner_timezone(connection, _PHOENIX)
    await _link(connection, "ACT-everyday", import_start=date(2026, 10, 4), checkpoint=date(2026, 10, 3), importing=True)

    await _schedule_next_sync(connection, frozen_now)

    assert await _next_sync(connection) == datetime(2026, 10, 4, tzinfo=_PHOENIX)


@pytest.mark.parametrize(
    ("failed_ago", "last_sent_ago"),
    [(None, timedelta(hours=1)), (timedelta(minutes=30), timedelta(minutes=30)), (timedelta(hours=2), timedelta(hours=1))],
    ids=["listing_worked", "listing_failed_since", "listing_failed_before_the_one_that_worked"],
)
async def test_connections_next_sync_lists_again_a_day_after_the_last_listing_while_a_link_waits_on_its_bank_account(
    connection, frozen_now, day_later, failed_ago, last_sent_ago
):
    """Everyday waits on Choose bank account, the connection's only link, and the bank accounts were listed an hour ago

    The connection next syncs a day after the last listing was sent, whether it worked or failed,
    to list them again, never at Everyday's own next attempt, two hours ago
    """
    await _link(
        connection,
        "ACT-everyday",
        **_synced_through_yesterday(state=BankLinkState.CHOOSE_ACCOUNT, next_attempt_at=frozen_now - timedelta(hours=2)),
    )
    if failed_ago is not None:
        async with TestSession() as session:
            (await session.get(BankConnection, connection.id)).discovery_failed_at = frozen_now - failed_ago
            await session.commit()

    await _schedule_next_sync(connection, frozen_now)

    assert await _next_sync(connection) == frozen_now - last_sent_ago + day_later


async def test_scan_lists_a_connection_whose_every_link_waits_on_its_bank_account_and_resumes_the_link(
    connection, provider, frozen_now, day_later
):
    """Everyday waits on Choose bank account, the only link on a connection listed at noon, and a sync ends at 1 pm

    A day after that listing the scan queues a sync that lists the bank accounts again. Fake Bank
    lists Everyday's as before, so Everyday resumes and syncs in the same job
    """
    listed_at = frozen_now - timedelta(hours=1)
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday(state=BankLinkState.CHOOSE_ACCOUNT))
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()
    provider.outcomes = [_returned("ACT-everyday"), _returned("ACT-everyday")]

    with freeze_time(listed_at + day_later, real_asyncio=True):
        await enqueue_due_work()
        await _run_jobs_until_none_is_due()

    assert (len(provider.discoveries), len(provider.fetches)) == (1, 1)
    assert await _link_states(everyday) == ["active"]


async def test_scan_queues_one_scheduled_sync_once_a_day_has_passed_since_the_last(connection, provider, frozen_now, day_later):
    """Everyday's sync at 12:30 pm on 3 October sets its connection's next sync for 1 pm on the 4th

    A scan at 12:59 pm queues nothing, the first scan from 1 pm queues a scheduled sync to run at
    once, and the scan after merges into it, so the connection still has one queued
    """
    started_at = frozen_now - day_later
    await _link(
        connection,
        "ACT-everyday",
        **_synced_through_yesterday(checkpoint=date(2026, 10, 2), last_success_at=datetime(2026, 10, 2, 12, 30, tzinfo=_BRISBANE)),
    )
    provider.outcomes = [_returned("ACT-everyday")]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    with freeze_time(started_at, real_asyncio=True):
        await _run_jobs_until_none_is_due()
    with freeze_time(frozen_now - timedelta(minutes=1), real_asyncio=True):
        await enqueue_due_work()
    queued_before = await _queued_jobs()

    await enqueue_due_work()
    queued_at = await _queued_jobs()
    await enqueue_due_work()

    assert await _next_sync(connection) == frozen_now
    assert queued_before == []
    assert queued_at == [("scheduled", timedelta(0), False)]
    assert await _queued_jobs() == [("scheduled", timedelta(0), False)]


@pytest.mark.parametrize("cause", ["budget_spent", "provider_quota_spent"])
async def test_scan_queues_a_scheduled_sync_due_while_no_request_is_free_for_when_one_frees(connection, provider, frozen_now, cause):
    """Everyday's daily sync is due at 1 pm with no request free until 5 pm, as the rolling day is spent or the provider said so

    The scan queues the sync for 5 pm, so nothing runs before then to find the budget spent
    """
    await _link(connection, "ACT-everyday", **_synced_through_yesterday(next_attempt_at=frozen_now))
    await _set_next_sync(connection, frozen_now)
    if cause == "budget_spent":
        await _spend_requests(connection, _DAILY_REQUESTS, frozen_now - timedelta(hours=20))
    else:
        async with TestSession() as session:
            stored = await session.get(BankConnection, connection.id)
            stored.request_budget_spent_until = frozen_now + timedelta(hours=4)
            await session.commit()

    await enqueue_due_work()

    assert await _queued_jobs() == [("scheduled", timedelta(hours=4), False)]
    assert await run_jobs(1) == 0
    assert provider.fetches == []


async def test_scan_queues_nothing_while_the_provider_is_turned_off_and_queues_the_sync_once_it_is_back(
    connection, provider, frozen_now, monkeypatch
):
    """Everyday's daily sync is due, but this server has turned its provider off, so no sync is queued to fail

    Once the provider is allowed again the next scan queues the sync still due
    """
    await _link(connection, "ACT-everyday", **_synced_through_yesterday(next_attempt_at=frozen_now))
    await _set_next_sync(connection, frozen_now)
    use_adapter(monkeypatch, provider, enabled=False)

    await enqueue_due_work()
    queued_while_off = await _queued_jobs()
    use_adapter(monkeypatch, provider)
    await enqueue_due_work()

    assert queued_while_off == []
    assert await _queued_jobs() == [("scheduled", timedelta(0), False)]


async def test_scan_queues_nothing_for_a_provider_no_longer_installed(connection, frozen_now, monkeypatch):
    """Everyday's daily sync is due, but the provider's folder was deleted, so no sync is queued to fail"""
    await _link(connection, "ACT-everyday", **_synced_through_yesterday(next_attempt_at=frozen_now))
    await _set_next_sync(connection, frozen_now)
    remove_provider(monkeypatch, FAKE_PROVIDER)

    await enqueue_due_work()

    assert await _queued_jobs() == []


async def test_scan_queues_nothing_after_a_job_finds_the_credential_rejected(connection, provider, frozen_now):
    """Fake Bank Online rejects the credential in Everyday's daily sync, so automatic sync stops until the user reconnects

    The job leaves Everyday with no next attempt set. That would make it due at once, but the job marks
    the connection Reconnect needed, so the scan after it queues nothing
    """
    await _link(connection, "ACT-everyday", **_synced_through_yesterday(next_attempt_at=frozen_now))
    provider.outcomes = [FetchResult(request_error=_rejected())]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()

    await enqueue_due_work()

    assert await _rejection(connection) == frozen_now
    assert await _queued_jobs() == []


@pytest.mark.parametrize("savings_paused", [False, True], ids=["savings_active", "both_paused"])
async def test_daily_sync_leaves_out_an_account_paused_for_review_and_none_is_queued_once_every_one_is(
    connection, provider, frozen_now, day_later, savings_paused
):
    """Everyday is paused with new items waiting, so the daily sync covers Savings alone and next runs a day on

    With Savings paused too, the sync due sends nothing and leaves the connection no next sync, so
    the next scan queues none
    """
    paused = {"paused": True, "next_attempt_at": frozen_now}
    await _link(connection, "ACT-everyday", **_synced_through_yesterday(**paused))
    await _link(connection, "ACT-savings", **_synced_through_yesterday(**(paused if savings_paused else {"next_attempt_at": frozen_now})))
    await _set_next_sync(connection, frozen_now)
    provider.outcomes = [_returned("ACT-savings")]

    await enqueue_due_work()
    await _run_jobs_until_none_is_due()
    await enqueue_due_work()

    assert _fetched(provider) == ([] if savings_paused else [_window(date(2026, 9, 19), _TODAY, ["ACT-savings"], pending=True)])
    assert await _next_sync(connection) == (None if savings_paused else frozen_now + day_later)
    assert await _queued_jobs() == []


async def test_scan_retries_a_link_whose_retry_no_job_was_queued_for(connection, provider, frozen_now):
    """Card's retry is due at 1 pm, but an unexpected error stops the job while it lists the bank accounts, before Card is fetched

    That job queues no retry for a time already passed, so Card's retry is the connection's next
    scheduled sync, and the next scan queues a sync that fetches Card
    """
    await _link(connection, "ACT-everyday", **_synced_through_yesterday(next_attempt_at=frozen_now + timedelta(hours=20)))
    await _link(connection, "ACT-card", **_synced_through_yesterday(retry_count=1, next_attempt_at=frozen_now))
    provider.outcomes = [RuntimeError("Unexpected bank data"), _returned("ACT-card")]
    await _seed_job(connection, BankSyncJobKind.RETRY, discover=True)
    await _run_jobs_until_none_is_due()
    queued_after_the_error = await _queued_jobs()

    await enqueue_due_work()
    await _run_jobs_until_none_is_due()

    assert queued_after_the_error == []
    assert _fetched(provider) == [_window(date(2026, 9, 19), _TODAY, ["ACT-card"], pending=True)]


async def test_scan_after_the_worker_stopped_for_three_days_queues_one_job_that_catches_up(connection, provider, frozen_now, day_later):
    """The worker stopped after Everyday's sync at 1 pm on 1 October, and restarts at 1 pm on the 4th, three daily syncs later

    The first scan queues one job. It fetches from 14 days before Everyday's checkpoint through
    today in one request, and the next sync is a day on
    """
    stopped_at = frozen_now - timedelta(days=3)
    await _link(
        connection,
        "ACT-everyday",
        **_synced_through_yesterday(checkpoint=date(2026, 10, 1), last_success_at=stopped_at, next_attempt_at=stopped_at + day_later),
    )
    await _set_next_sync(connection, stopped_at + day_later)
    provider.outcomes = [_returned("ACT-everyday")]

    await enqueue_due_work()
    queued = await _queued_jobs()
    await _run_jobs_until_none_is_due()

    assert queued == [("scheduled", timedelta(0), False)]
    assert _fetched(provider) == [_window(date(2026, 9, 17), _TODAY, ["ACT-everyday"], pending=True)]
    assert await _next_sync(connection) == frozen_now + day_later


async def test_scan_queues_nothing_for_a_connection_disconnected_after_it_was_found_due(connection, frozen_now):
    """The user disconnects between the scan listing the connection and queueing its sync, so there is nothing to queue"""
    async with TestSession() as session:
        await session.execute(delete(BankConnection).where(BankConnection.id == connection.id))
        await session.commit()

    async with _owner_session(connection.owner_id) as session:
        await queue_scheduled_sync(session, connection.id, now=frozen_now)
        await session.commit()

    assert await _queued_jobs() == []


async def test_scan_lists_the_bank_accounts_of_a_connection_whose_claim_stopped_mid_listing(connection, provider, frozen_now):
    """The app restarted while the claim two hours ago listed the bank accounts, leaving no listing and nothing queued

    The scan queues a sync that lists them, telling the owner's open pages the listing is pending,
    and once they are listed the connection, with nothing linked yet, isn't due again
    """
    await _set_discovered_at(connection, None)
    async with TestSession() as session:
        (await session.get(BankConnection, connection.id)).created_at = frozen_now - timedelta(hours=2)
        await session.commit()
    provider.outcomes = [_returned("ACT-everyday", "ACT-savings")]
    told_before = await _told_at(connection)

    await enqueue_due_work()
    queued = await _queued_jobs()
    pending = await _listing(connection)
    told_on_queueing = await _told_at(connection)
    await _run_jobs_until_none_is_due()
    await enqueue_due_work()

    assert queued == [("scheduled", timedelta(0), True)]
    assert (told_before, pending) == (None, (True, []))
    assert told_on_queueing is not None
    assert (len(provider.discoveries), provider.fetches) == (1, [])
    assert await _listing(connection) == (False, ["ACT-everyday", "ACT-savings"])
    assert await _queued_jobs() == []
