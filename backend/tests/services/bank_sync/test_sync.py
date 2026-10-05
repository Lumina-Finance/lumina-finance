"""Running a bank sync job: the listing it reads first, the windows it fetches, the records and checkpoints it stores and the job it queues next

Jobs run through the worker's run_jobs, as their owner under row-level security, against a scripted
provider. A checkpoint moved for days a response didn't bring back whole hides that gap for good, a
long import that stops after its first window leaves months missing, a job that keeps sending once
the request budget is spent can get the user's SimpleFIN token disabled, and a link failing on every
request that holds up the others, or takes each request that frees ahead of them, stalls their
imports. A booked record dropped is a transaction the user never sees, one stored twice or brought
back after a dismissal is a duplicate to clear, and one that skips review moves balances unchecked.
A pending item kept after it posted or was dropped shows a hold that's gone, and pending items
replaced by a window before today or for an account a fetch failed for hide holds still pending.
A job that skips its listing leaves new bank accounts unlisted and vanished ones syncing, and one
that stores what it found after losing its lease, for a link unlinked mid-fetch, or from a request
sent with a credential replaced mid-flight overwrites what the user, a reconnect or a later attempt
did. An attempt left unrecorded shows a sync that never happened, a retry sent early or for a failure
retrying can't fix spends requests for nothing, and one never queued leaves an account stale
"""

import asyncio
import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from typing import override
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import delete, func, select, text, update

from app.encryption import encrypt
from app.models.account import Account
from app.models.account_review_preference import AccountReviewPreference, ReviewDecision
from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState, BankProvider, BankProviderRequest, ProviderRequestPurpose
from app.models.bank_pending_transaction import BankPendingTransaction
from app.models.bank_sync_job import BankSyncJob, BankSyncJobKind, ProviderErrorKind
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition
from app.models.cache_state import UserCacheState
from app.models.transaction import Transaction
from app.models.user import User
from app.services.bank_sync import availability, sync
from app.services.bank_sync.availability import PROVIDER_ADAPTERS
from app.services.bank_sync.connections import build_connection_responses
from app.services.bank_sync.provider_requests import reserve_provider_request
from app.services.bank_sync.providers.contract import ExternalAccount, FetchResult, ProviderError, ProviderRecord
from app.services.bank_sync.worker import run_jobs
from tests.conftest import TestSession
from tests.fake_simplefin_bridge import FakeBridgeTransport
from tests.routes.support.bank_sync_helpers import (
    _attempts,
    _build_account,
    _build_bank_link,
    _build_bank_transaction,
    _build_external_account,
    _build_pending_transaction,
    _expire_lease,
    _job_states,
    _queued_jobs,
    _seed_job,
)
from tests.services.bank_sync.fake_provider import FakeProviderAdapter
from tests.services.bank_sync.stand_ins import FakeBridgeScenario, simplefin_adapter

# Without clock changes, so the examples' windows are whole runs of 90 calendar days. The frozen
# clock reads 1 pm on 4 October there
_BRISBANE = ZoneInfo("Australia/Brisbane")
_TODAY = date(2026, 10, 4)

# West of UTC without clock changes, where the frozen clock reads 8 pm on 3 October, already
# 4 October in UTC, so a day taken in the wrong timezone shows
_PHOENIX = ZoneInfo("America/Phoenix")

# Yesterday's daily sync, which left a link complete through 3 October
_YESTERDAYS_SYNC = datetime(2026, 10, 3, 9, 0, tzinfo=_BRISBANE)

# More jobs than any test here queues, so a job that keeps queueing another fails the test
_MOST_JOBS = 10

# Long enough for any step here to finish, so a missing protection fails the test rather than hanging it
_WAIT_SECONDS = 10

# Requests a SimpleFIN connection may send in 24 hours
_DAILY_REQUESTS = PROVIDER_ADAPTERS[BankProvider.SIMPLEFIN].daily_request_budget

# The connection's credential, and the one reconnecting it stores in its place
_CREDENTIAL = "https://user:secret@bridge.example/simplefin"
_RENEWED = "https://user:renewed@bridge.example/simplefin"

# The shared builder's values a dismissal clears, since a dismissed bank transaction keeps only its identity
_DISMISSED = {
    "disposition": BankTransactionDisposition.DISMISSED,
    "observed_date": None,
    "observed_amount": None,
    "description": None,
    "observed_at": None,
}

pytestmark = pytest.mark.usefixtures("worker_sessions")


@pytest.fixture
def provider(monkeypatch) -> FakeProviderAdapter:
    """Serve the connections' provider through a scripted fake"""
    fake = FakeProviderAdapter()
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, fake)
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
    """Return the fields of a link that yesterday's daily sync left complete through 3 October"""
    return {"import_start": date(2026, 1, 1), "checkpoint": date(2026, 10, 3), "last_success_at": _YESTERDAYS_SYNC} | values


def _bank_account(
    external_id: str,
    login_key: str = "CON-harbour",
    records: Sequence[ProviderRecord] = (),
    currency: str = "CAD",
) -> ExternalAccount:
    """Return a bank account as the provider lists it, in its account's currency unless told otherwise, with the records a fetch brought back"""
    return ExternalAccount(
        external_id=external_id,
        name=external_id,
        institution_key="ORG-harbour",
        institution_name="Harbour Bank",
        login_key=login_key,
        currency=currency,
        currency_raw=currency,
        balance=100_00,
        available_balance=None,
        balance_at=datetime(2026, 10, 4, tzinfo=UTC),
        records=tuple(records),
    )


def _returned(*external_ids: str) -> FetchResult:
    """Return a response bringing back each bank account whole"""
    return FetchResult(accounts=tuple(_bank_account(external_id) for external_id in external_ids))


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
    fields = {"merchant_name": None, "category_hint": None, "extras": {}, "pending": False} | values
    return ProviderRecord(external_id=external_id, date=day, amount=amount, raw_amount=raw_amount, description=description, **fields)


def _pending_record(external_id: str, day: date = _TODAY, **values) -> ProviderRecord:
    """Return a record still pending at the bank, a $4.50 coffee today unless told otherwise"""
    return _record(external_id, day, pending=True, **values)


async def _bank_transactions(*columns) -> list[tuple]:
    """Return these columns of every stored bank transaction, by bank account and then transaction ID"""
    async with TestSession() as session:
        rows = await session.execute(select(*columns).order_by(BankTransaction.external_account_id, BankTransaction.external_transaction_id))
        return [tuple(row) for row in rows]


async def _pending_transactions(*columns) -> list[tuple]:
    """Return these columns of every stored pending item, by transaction ID"""
    async with TestSession() as session:
        rows = await session.execute(select(*columns).order_by(BankPendingTransaction.external_transaction_id))
        return [tuple(row) for row in rows]


async def _store_pending(link: BankAccountLink, external_transaction_id: str, **values) -> None:
    """Commit a pending item an earlier sync found for the link's account, as the shared builder makes it unless told otherwise"""
    async with TestSession() as session:
        account = await session.get(Account, link.account_id)
        item = _build_pending_transaction(account, external_transaction_id)
        for field, value in values.items():
            setattr(item, field, value)
        session.add(item)
        await session.commit()


async def _store_bank_transaction(link: BankAccountLink, external_transaction_id: str, **values) -> uuid.UUID:
    """Commit a bank transaction the link's bank account sent, awaiting review as the shared builder makes it unless told otherwise

    Returns:
        Its id, which is also its review item's
    """
    async with TestSession() as session:
        account = await session.get(Account, link.account_id)
        record = _build_bank_transaction(account, external_transaction_id, external_account_id=link.external_account_id)
        for field, value in values.items():
            setattr(record, field, value)
        session.add(record)
        await session.commit()
    return record.id


def _cut_off(*external_ids: str) -> FetchResult:
    """Return a response with 1,000 transactions or more, which SimpleFIN may have cut short"""
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


async def _spend_requests(connection: BankConnection, count: int, oldest: datetime) -> None:
    """Commit requests sent a minute apart from the oldest, as the connection's budget counts them"""
    async with TestSession() as session:
        session.add_all(
            BankProviderRequest(
                owner_id=connection.owner_id,
                connection_id=connection.id,
                purpose=ProviderRequestPurpose.SYNC,
                requested_at=oldest + timedelta(minutes=minute),
            )
            for minute in range(count)
        )
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
    """Return when the owner's open pages were last told their data changed, or None when they never were"""
    async with TestSession() as session:
        return await session.scalar(select(UserCacheState.changed_at).where(UserCacheState.user_id == connection.owner_id))


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
            account_errors={"ACT-savings": ProviderError(ProviderErrorKind.TEMPORARY, "SimpleFIN Bridge reported a problem")},
            login_errors={"CON-card": ProviderError(ProviderErrorKind.BANK_LOGIN_NEEDED, "Sign in to your bank again")},
        )
    ]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(BankTransaction.external_account_id, BankTransaction.external_transaction_id) == [
        ("ACT-everyday", "TRN-coffee")
    ]
    assert await _checkpoints(*links) == [_TODAY, date(2026, 10, 3), date(2026, 10, 3), date(2026, 10, 3)]
    assert [(kind, status) for kind, status, *_ in await _jobs()] == [("scheduled", "succeeded"), ("retry", "queued")]


class _CardFailingProvider(FakeProviderAdapter):
    """Brings back each bank account asked for whole, except Card, whose bank login needs a sign-in on every request"""

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
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, provider)
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
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, provider)
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
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, provider)
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

    So it re-reads from 18 September to 3 October, where dates taken in UTC would carry on from 3 October to 4 October
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
    """A link imported from today needs one window of today, which asks for pending transactions and brings it up to date"""
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


async def test_job_whose_request_fails_records_the_failure_and_moves_no_checkpoint(connection, monkeypatch):
    """SimpleFIN Bridge can't be reached: the job records why, the owner's open pages are told again as it ends, and the checkpoint stays"""
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    provider = _HeldProvider()
    provider.outcomes = [FetchResult(request_error=ProviderError(ProviderErrorKind.TEMPORARY, "SimpleFIN Bridge couldn't be reached"))]
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, provider)
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
    assert await _told_at(connection) > told_while_fetching


@pytest.mark.parametrize("cause", ["budget_spent", "provider_asked_to_slow_down"])
async def test_job_without_a_request_to_spend_queues_itself_for_when_one_frees(connection, provider, frozen_now, cause):
    """An import waits for the request budget rather than failing, and fetches nothing it can't count

    The oldest request in the rolling day leaves it 24 hours after it was sent, so the job runs again then
    """
    link = await _link(connection, "ACT-1", import_start=date(2026, 9, 1), checkpoint=date(2026, 8, 31))
    oldest = frozen_now - timedelta(hours=20)
    await _spend_requests(connection, _DAILY_REQUESTS if cause == "budget_spent" else 1, oldest)
    provider.outcomes = [FetchResult(request_error=ProviderError(ProviderErrorKind.RATE_LIMITED, "SimpleFIN Bridge asked for fewer requests"))]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    assert await run_jobs(1) == 1

    assert len(provider.fetches) == (0 if cause == "budget_spent" else 1)
    assert [(kind, status) for kind, status, *_ in await _jobs()] == [("initial", "succeeded"), ("initial", "queued")]
    assert await _queued_jobs() == [("initial", oldest + timedelta(hours=24) - frozen_now, False)]
    assert await _checkpoints(link) == [date(2026, 8, 31)]


def _reported_a_problem() -> ProviderError:
    """Return an error of a bank account's own, which retrying may fix"""
    return ProviderError(ProviderErrorKind.TEMPORARY, "SimpleFIN Bridge reported a problem")


async def test_job_syncs_the_bank_accounts_it_brought_back_whole_and_retries_the_others_30_minutes_on(connection, provider, frozen_now):
    """At 1 pm Everyday comes back whole, while Savings has an error of its own and Travel didn't come back

    Everyday reads as synced now. Savings and Travel keep yesterday's last sync, show why this attempt
    failed and are retried at 1:30 pm, which the queued retry waits for
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
        (frozen_now, frozen_now, None, 0, None),
        (_YESTERDAYS_SYNC, frozen_now, "SimpleFIN Bridge reported a problem", 1, retry_at),
        (_YESTERDAYS_SYNC, frozen_now, "Fake Bank didn't return this bank account", 1, retry_at),
    ]
    assert await _queued_jobs() == [("retry", timedelta(minutes=30), False)]


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


async def test_job_counts_a_window_fetched_in_halves_as_one_attempt_for_a_link_failing_in_both(connection, provider, frozen_now):
    """1 January to 31 March comes back cut short and the bank account has an error of its own in each half, so its series has one failure"""
    link = await _link(connection, "ACT-1", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    failing = FetchResult(account_errors={"ACT-1": _reported_a_problem()})
    provider.outcomes = [_cut_off("ACT-1"), failing, failing]
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
    slow_down = ProviderError(ProviderErrorKind.RATE_LIMITED, "SimpleFIN Bridge asked for fewer requests")
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


async def test_job_for_a_retry_due_while_the_budget_is_spent_records_no_attempt_and_runs_once_a_request_frees(connection, provider, frozen_now):
    """The third retry is due at 1 pm with no request free until 5:10 pm, so nothing is sent and the link still shows its last failure

    Waiting for a request is no attempt, so the series doesn't move on. Once a request frees the
    retry brings the bank account back whole, which ends the series
    """
    failed_at = frozen_now - timedelta(minutes=90)
    link = await _link(
        connection,
        "ACT-1",
        **_synced_through_yesterday(
            last_attempt_at=failed_at, last_failure_reason="SimpleFIN Bridge reported a problem", retry_count=3, next_attempt_at=frozen_now
        ),
    )
    oldest = frozen_now - timedelta(hours=19, minutes=50)
    await _spend_requests(connection, _DAILY_REQUESTS, oldest)
    provider.outcomes = [_returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.RETRY)

    await _run_jobs_until_none_is_due()

    assert provider.fetches == []
    assert await _attempts(link) == [(_YESTERDAYS_SYNC, failed_at, "SimpleFIN Bridge reported a problem", 3, frozen_now)]
    assert await _queued_jobs() == [("retry", oldest + timedelta(hours=24) - frozen_now, False)]

    await _free_oldest_request(connection)
    await _run_jobs_until_none_is_due()

    assert len(provider.fetches) == 1
    assert await _attempts(link) == [(frozen_now, frozen_now, None, 0, None)]
    assert await _queued_jobs() == []


async def test_job_starts_no_retry_series_for_a_bank_account_whose_bank_needs_a_sign_in(connection, provider, frozen_now):
    """Card's first retry finds its bank login needing a sign-in as well as an error of its own, and retrying can't fix a sign-in

    Card shows the sign-in as why it failed and leaves its retry series, and no retry is queued
    """
    card = await _link(connection, "ACT-card", **_synced_through_yesterday(retry_count=1, next_attempt_at=frozen_now))
    provider.outcomes = [
        FetchResult(
            accounts=(_bank_account("ACT-card", login_key="CON-card"),),
            account_errors={"ACT-card": _reported_a_problem()},
            login_errors={"CON-card": ProviderError(ProviderErrorKind.BANK_LOGIN_NEEDED, "Sign in to your bank again")},
        )
    ]
    await _seed_job(connection, BankSyncJobKind.RETRY)

    await _run_jobs_until_none_is_due()

    assert await _attempts(card) == [(_YESTERDAYS_SYNC, frozen_now, "Sign in to your bank again", 0, None)]
    assert await _queued_jobs() == []


async def test_job_retries_a_link_simplefin_bridge_refused_over_a_payment_problem(
    connection, scenario: FakeBridgeScenario, monkeypatch, frozen_now
):
    """SimpleFIN Bridge answers 402, so the account shows the payment problem and is retried 30 minutes on, by when the user may have paid"""
    adapter = simplefin_adapter(FakeBridgeTransport())
    access_url = await adapter.claim(scenario.setup_token)
    async with TestSession() as session:
        await session.execute(update(BankConnection).where(BankConnection.id == connection.id).values(credential_encrypted=encrypt(access_url)))
        await session.commit()
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, adapter)
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    await scenario.change("PUT", "/fault", {"kind": "payment_required"})
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    retry_at = frozen_now + timedelta(minutes=30)
    assert await _attempts(link) == [(_YESTERDAYS_SYNC, frozen_now, "SimpleFIN Bridge reports a payment problem", 1, retry_at)]
    assert await _queued_jobs() == [("retry", timedelta(minutes=30), False)]


async def test_job_whose_request_met_a_payment_problem_starts_no_retry_series(connection, provider, frozen_now, day_later):
    """Card's daily sync is refused with a payment problem, which waiting minutes can't fix

    Card shows the payment problem as why it failed and rests until the next daily sync, with no
    retry queued, so the user's one request a day is all it spends while the problem stands
    """
    card = await _link(connection, "ACT-card", **_synced_through_yesterday())
    reason = "SimpleFIN Bridge reports a payment problem"
    provider.outcomes = [FetchResult(request_error=ProviderError(ProviderErrorKind.PAYMENT_REQUIRED, reason))]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _attempts(card) == [(_YESTERDAYS_SYNC, frozen_now, reason, 0, frozen_now + day_later)]
    assert await _queued_jobs() == []
    assert await _next_sync(connection) == frozen_now + day_later


async def test_job_ending_on_a_rejected_credential_queues_no_retry_or_listing(connection, provider, frozen_now):
    """Everyday, importing from 1 January, comes back in yen, and the next window, Savings' first retry, finds the credential rejected

    Neither a retry nor a listing can work until the user reconnects, so nothing is queued. Savings
    shows the rejection and leaves its series, and Everyday shows the currency it came back in
    """
    everyday = await _link(connection, "ACT-everyday", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    savings = await _link(connection, "ACT-savings", **_synced_through_yesterday(retry_count=1, next_attempt_at=frozen_now))
    provider.outcomes = [
        FetchResult(accounts=(_bank_account("ACT-everyday", currency="JPY"),)),
        FetchResult(
            request_error=ProviderError(ProviderErrorKind.CREDENTIAL_REJECTED, "SimpleFIN Bridge rejected the stored access credential")
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
        ("Fake Bank now reports this bank account in JPY, not CAD", 1, frozen_now + timedelta(minutes=30)),
        ("SimpleFIN Bridge rejected the stored access credential", 0, None),
    ]


async def test_job_leaving_a_due_retry_for_links_that_can_progress_retries_it_at_once(connection, provider, frozen_now):
    """Card failed in an earlier job and its retry is due, so this job plans it last, and Everyday's re-read reaches today without it

    The retry is queued again at once, with Card no longer held back, so the next job brings it back whole
    """
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    card = await _link(connection, "ACT-card", **_synced_through_yesterday(retry_count=1, next_attempt_at=frozen_now))
    provider.outcomes = [_returned("ACT-everyday"), _returned("ACT-card", "ACT-everyday")]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED, deferred_link_ids=[card.id])

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [
        _window(date(2026, 9, 19), _TODAY, ["ACT-everyday"], pending=True),
        _window(date(2026, 9, 19), _TODAY, ["ACT-card", "ACT-everyday"], pending=True),
    ]
    assert [attempt[2:] for attempt in await _attempts(everyday, card)] == [(None, 0, None), (None, 0, None)]


async def test_job_tells_the_owners_pages_as_a_part_records_a_failed_attempt(connection, monkeypatch):
    """A window cut short fails for the bank account in its earlier half, and the owner's open pages hear of it while the later half is out"""
    await _link(connection, "ACT-1", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    provider = _HeldProvider(held=(1, 3))
    provider.outcomes = [_cut_off("ACT-1"), FetchResult(account_errors={"ACT-1": _reported_a_problem()}), _returned("ACT-1")]
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, provider)
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
    assert await _bank_transactions(BankTransaction.external_transaction_id) == [("TRN-january",), ("TRN-march",)]
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
        FetchResult(account_errors={"ACT-1": ProviderError(ProviderErrorKind.TEMPORARY, "SimpleFIN Bridge reported a problem")}),
        _returned("ACT-1"),
    ]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert len(provider.fetches) == 3
    assert await _checkpoints(link) == [date(2025, 12, 31)]


async def test_job_never_moves_a_checkpoint_back_to_the_end_of_an_earlier_half(connection, frozen_now, provider):
    """The daily re-read from 19 September comes back cut short and the budget runs out after the earlier half, which ends 26 September

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

    Nor does it queue the retry Savings waits on, which couldn't work either
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
    """An operator turned SimpleFIN off: the job fails with a reason the account's sync details can show"""
    await _link(connection, "ACT-1", **_synced_through_yesterday())
    monkeypatch.delitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, raising=False)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    async with TestSession() as session:
        assert (await session.execute(select(BankSyncJob.status, BankSyncJob.last_error_reason))).one() == (
            "failed",
            "SimpleFIN is turned off on this server",
        )


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


@pytest.mark.parametrize("cause", ["budget_spent", "provider_asked_to_slow_down"])
async def test_job_flagged_to_discover_keeps_the_listing_pending_until_a_request_frees(connection, provider, frozen_now, cause):
    """With no request to spend, the flagged job queues itself still flagged, and lists the bank accounts once a request frees"""
    oldest = frozen_now - timedelta(hours=20)
    await _spend_requests(connection, _DAILY_REQUESTS if cause == "budget_spent" else 1, oldest)
    if cause == "provider_asked_to_slow_down":
        provider.outcomes.append(
            FetchResult(request_error=ProviderError(ProviderErrorKind.RATE_LIMITED, "SimpleFIN Bridge asked for fewer requests"))
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
    provider.outcomes = [FetchResult(request_error=ProviderError(ProviderErrorKind.RATE_LIMITED, "SimpleFIN Bridge asked for fewer requests"))]
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
    """Return a 1,500 yen meal, which an account in Canadian dollars would read as $15.00"""
    return _record("TRN-ramen", amount=-1500, raw_amount="-1500", description="RAMEN BAR")


async def test_job_stores_nothing_for_a_bank_account_a_fetch_lists_in_another_currency_and_lists_the_bank_accounts_next(connection, provider):
    """Sync now, with no listing due, finds Everyday's bank account in yen, though Everyday is in Canadian dollars

    Everyday keeps nothing and its checkpoint stays, while Savings syncs. The next job lists the bank
    accounts first, which leaves Everyday waiting for a bank account to be chosen
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
        _returned("ACT-savings"),
    ]
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    assert await run_jobs(1) == 1

    assert await _bank_transactions(BankTransaction.external_account_id, BankTransaction.external_transaction_id) == [
        ("ACT-savings", "TRN-interest")
    ]
    assert await _checkpoints(everyday, savings) == [date(2026, 10, 3), _TODAY]
    assert (await _attempts(everyday))[0][2] == "Fake Bank now reports this bank account in JPY, not CAD"
    async with TestSession() as session:
        assert (await session.scalars(select(BankSyncJob.discover).where(BankSyncJob.status == "queued"))).all() == [True]

    await _run_jobs_until_none_is_due()

    assert (len(provider.discoveries), len(provider.fetches)) == (1, 2)
    assert await _link_states(everyday, savings) == ["choose_account", "active"]
    assert await _bank_transactions(BankTransaction.external_transaction_id) == [("TRN-interest",)]


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
    assert await _bank_transactions(BankTransaction.external_transaction_id) == []
    assert (await _link_states(link), await _checkpoints(link)) == (["active"], [date(2026, 10, 3)])
    assert [status for _, status, *_ in await _jobs()] == ["succeeded", "queued"]
    assert await _queued_jobs() == [("retry", timedelta(minutes=30), False)]


async def test_job_whose_listing_fails_records_it_and_fetches_nothing(connection, provider, frozen_now):
    """SimpleFIN Bridge couldn't be reached for a stale listing, so the connection and the job record it, and no window is sent

    The listing was the attempt of the link the job was to sync, so the link records the failure too
    and is retried 30 minutes on
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    await _set_discovered_at(connection, frozen_now - timedelta(days=2))
    provider.outcomes = [FetchResult(request_error=ProviderError(ProviderErrorKind.TEMPORARY, "SimpleFIN Bridge couldn't be reached"))]
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
    assert await _attempts(link) == [
        (_YESTERDAYS_SYNC, frozen_now, "SimpleFIN Bridge couldn't be reached", 1, frozen_now + timedelta(minutes=30))
    ]


async def _wait_until_waiting_on(blocker_pid: int, running: asyncio.Task) -> None:
    """Wait until a backend waits on a lock the blocker holds, or the running task has finished"""
    async with TestSession() as observer:
        while not running.done():
            if await observer.scalar(
                text("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE NOT granted AND :pid = ANY(pg_blocking_pids(pid)))"),
                {"pid": blocker_pid},
            ):
                return
            await observer.rollback()
            await asyncio.sleep(0.02)


async def test_job_finishing_waits_for_the_connection_before_locking_its_links(connection, monkeypatch):
    """An unlink holding the connection locks Everyday's link while the job waits to write, and the job then leaves Everyday alone

    Whatever writes a connection's links locks the connection, then the job, then the links, so a job
    that locked its links first could deadlock with an unlink
    """
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    provider = _HeldProvider()
    provider.outcomes = [_returned("ACT-everyday")]
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, provider)
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
        FetchResult(request_error=ProviderError(ProviderErrorKind.CREDENTIAL_REJECTED, "SimpleFIN Bridge rejected the access URL")),
        FetchResult(
            accounts=(_bank_account("ACT-1", records=[_record("TRN-coffee")]),),
            warnings=(ProviderError(ProviderErrorKind.RATE_LIMITED, "SimpleFIN Bridge says the daily quota is used up"),),
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
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, provider)
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
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, provider)
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
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, provider)
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
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, provider)
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

    assert await _bank_transactions(BankTransaction.external_account_id, BankTransaction.external_transaction_id) == [
        ("ACT-everyday", "TRN-coffee")
    ]
    assert await _pending_transactions(BankPendingTransaction.account_id, BankPendingTransaction.external_transaction_id) == [
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
        FetchResult(account_errors={"ACT-1": ProviderError(ProviderErrorKind.TEMPORARY, "SimpleFIN Bridge reported a problem")}),
    ]
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, provider)
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
    assert [(reason, retries) for _, _, reason, retries, _ in await _attempts(link)] == [("SimpleFIN Bridge reported a problem", 1)]


async def test_job_attempt_that_lost_its_lease_while_listing_stores_nothing(connection, monkeypatch):
    """Attempt 1's listing leaves the bank account out but stalls past the lease, attempt 2's lists it, and attempt 1's answer moves nothing"""
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    async with TestSession() as session:
        session.add(_build_external_account(connection, "ACT-1"))
        await session.commit()
    provider = _HeldProvider()
    provider.outcomes = [FetchResult(), _returned("ACT-1"), _returned("ACT-1")]
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, provider)
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
    coffee = _record("TRN-coffee", merchant_name="Blue Bottle", extras={"memo": "Tap to pay"})
    provider.outcomes = [_returned_with({"ACT-everyday": [salary, fuel, coffee]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    awaiting = BankTransactionDisposition.AWAITING_REVIEW
    assert await _bank_transactions(
        BankTransaction.account_id,
        BankTransaction.external_transaction_id,
        BankTransaction.disposition,
        BankTransaction.observed_date,
        BankTransaction.observed_amount,
        BankTransaction.description,
        BankTransaction.merchant_name,
        BankTransaction.extras,
        BankTransaction.observed_at,
    ) == [
        (
            link.account_id,
            "TRN-coffee",
            awaiting,
            date(2026, 10, 2),
            -4_50,
            "POS 4411 COFFEE",
            "Blue Bottle",
            {"memo": "Tap to pay"},
            frozen_now,
        ),
        (link.account_id, "TRN-fuel", awaiting, _TODAY, -72_10, "NORTHERN FUEL STOP", None, {}, frozen_now),
        (link.account_id, "TRN-salary", awaiting, date(2026, 10, 1), 2_650_00, "DIRECT CREDIT BRIGHTWORKS SALARY", None, {}, frozen_now),
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

    assert await _bank_transactions(BankTransaction.external_transaction_id, BankTransaction.observed_amount, BankTransaction.raw_amount) == [
        ("TRN-fx", None, "-12.345")
    ]
    async with TestSession() as session:
        assert (await session.execute(select(BankAccountLink.checkpoint, BankAccountLink.last_success_at))).one() == (_TODAY, frozen_now)


async def test_job_reading_the_same_records_again_keeps_one_unchanged_item_each(connection, provider, frozen_now):
    """Sync now re-reads the days the daily sync read a day earlier, and the same coffee and the same unstorable -12.345 come back

    Each stays one item, untouched, so a bulk approval previewed in between still applies to it
    """
    await _link(connection, "ACT-1", **_synced_through_yesterday())
    response = _returned_with({"ACT-1": [_record("TRN-coffee"), _record("TRN-fx", amount=None, raw_amount="-12.345")]})
    provider.outcomes = [response, response]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()

    # The clock is frozen, so the daily sync is moved a day back for a needless refresh to show
    async with TestSession() as session:
        await session.execute(update(BankTransaction).values(observed_at=frozen_now - timedelta(days=1)))
        await session.commit()
    columns = (BankTransaction.external_transaction_id, BankTransaction.id, BankTransaction.version, BankTransaction.observed_at)
    stored = await _bank_transactions(*columns)

    await _seed_job(connection, BankSyncJobKind.MANUAL)
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
    """TRN-1 was dismissed when another bank account sent it into this account, or when this bank account fed another Lumina account

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

    assert await _bank_transactions(BankTransaction.external_transaction_id) == [("TRN-coffee",)]


async def test_job_replaces_each_accounts_pending_items_with_those_still_pending_at_the_bank(connection, provider):
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
    columns = (BankPendingTransaction.account_id, BankPendingTransaction.external_transaction_id, BankPendingTransaction.amount)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    await _run_jobs_until_none_is_due()
    after_the_first_sync = await _pending_transactions(*columns)

    await _seed_job(connection, BankSyncJobKind.MANUAL)
    await _run_jobs_until_none_is_due()

    assert after_the_first_sync == [
        (everyday.account_id, "P-coffee", -4_50),
        (everyday.account_id, "P-hotel", -200_00),
        (card.account_id, "P-refund", 25_00),
        (everyday.account_id, "P-shell", -60_00),
    ]
    assert await _pending_transactions(*columns) == [(everyday.account_id, "P-shell", -60_00)]
    assert await _bank_transactions(BankTransaction.external_transaction_id, BankTransaction.disposition) == [
        ("TRN-coffee", BankTransactionDisposition.AWAITING_REVIEW)
    ]


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
        BankPendingTransaction.external_transaction_id,
        BankPendingTransaction.transaction_date,
        BankPendingTransaction.amount,
        BankPendingTransaction.raw_amount,
        BankPendingTransaction.description,
        BankPendingTransaction.observed_at,
    ) == [
        (link.account_id, "P-coffee", _TODAY, -5_40, None, "POS 4411 COFFEE", frozen_now),
        (link.account_id, "P-fee", _TODAY, None, "-12.345", "FX FEE", frozen_now),
        (link.account_id, "P-fuel", date(2026, 10, 3), -72_10, None, "NORTHERN FUEL STOP", frozen_now),
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
            account_errors={"ACT-savings": ProviderError(ProviderErrorKind.TEMPORARY, "SimpleFIN Bridge reported a problem")},
            login_errors={"CON-card": ProviderError(ProviderErrorKind.BANK_LOGIN_NEEDED, "Sign in to your bank again")},
        )
    ]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _pending_transactions(BankPendingTransaction.account_id, BankPendingTransaction.external_transaction_id) == [
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
        assert await _pending_transactions(BankPendingTransaction.external_transaction_id) == [("P-march",)]
    assert await run_jobs(1) == 1

    assert await _pending_transactions(BankPendingTransaction.external_transaction_id) == [("P-now",)]
    assert len(provider.fetches) == 3


async def test_job_keeps_one_item_with_the_later_values_for_an_id_sent_twice_in_one_response(connection, provider):
    """The coffee comes back twice in one response, at $4.50 and then at $5.40

    It is one transaction, so the sync still succeeds and one item waits for review, at $5.40
    """
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    provider.outcomes = [_returned_with({"ACT-1": [_record("TRN-coffee"), _record("TRN-coffee", amount=-5_40, raw_amount="-5.40")]})]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(BankTransaction.external_transaction_id, BankTransaction.observed_amount) == [("TRN-coffee", -5_40)]
    assert [status for _, status, *_ in await _jobs()] == ["succeeded"]
    assert await _checkpoints(link) == [_TODAY]


async def test_job_keeps_records_from_the_import_start_on_for_a_user_far_east_of_utc(connection, scenario: FakeBridgeScenario, monkeypatch):
    """In Tarawa, 12 hours ahead of UTC, an import from 5 July fetches 5 July to 2 October, then 3 October to today

    SimpleFIN Bridge stamps each bank date at noon UTC, midnight starting the next day in Tarawa, so the
    first window brings back 4 July, before the import start and left out, and the second brings back
    2 October, which the first ended too soon for and which is kept though it is the checkpoint's own day
    """
    await _set_owner_timezone(connection, ZoneInfo("Pacific/Tarawa"))
    await scenario.change("POST", "/connections", {"conn_id": "CON-harbour", "name": "Harbour Bank", "org_id": "ORG-harbour"})
    bank_account = {
        "id": "ACT-1",
        "name": "Everyday Chequing",
        "conn_id": "CON-harbour",
        "currency": "CAD",
        "balance": "100.00",
        "balance_date": 1791115200,
    }
    await scenario.change("POST", "/accounts", bank_account)
    transactions = [
        {"id": f"TRN-{day}", "posted": day, "amount": "-4.50", "description": "POS 4411 COFFEE"}
        for day in ("2026-07-04", "2026-07-05", "2026-10-02")
    ]
    await scenario.change("POST", "/accounts/ACT-1/transactions", {"transactions": transactions})
    adapter = simplefin_adapter(FakeBridgeTransport())
    access_url = await adapter.claim(scenario.setup_token)
    async with TestSession() as session:
        await session.execute(update(BankConnection).where(BankConnection.id == connection.id).values(credential_encrypted=encrypt(access_url)))
        await session.commit()
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, adapter)
    link = await _link(connection, "ACT-1", import_start=date(2026, 7, 5), checkpoint=date(2026, 7, 4))
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(BankTransaction.external_transaction_id, BankTransaction.observed_date) == [
        ("TRN-2026-07-05", date(2026, 7, 5)),
        ("TRN-2026-10-02", date(2026, 10, 2)),
    ]
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
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, provider)
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
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, provider)
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

    assert await _bank_transactions(BankTransaction.external_transaction_id) == [("TRN-late",)]
    assert checkpoint_after_the_earlier_half == [date(2026, 10, 3)]
    assert told_as_it_started is not None
    assert told_after_the_earlier_half > told_as_it_started
