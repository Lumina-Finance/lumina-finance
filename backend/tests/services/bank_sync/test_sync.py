"""Running a bank sync job: the listing it reads first, the windows it fetches, the checkpoints it moves and the job it queues next

Jobs run through the worker's run_jobs, as their owner under row-level security, against a scripted
provider. A checkpoint moved for days a response didn't bring back whole hides that gap for good, a
long import that stops after its first window leaves months missing, a job that keeps sending once
the request budget is spent can get the user's SimpleFIN token disabled, a job that skips its
listing leaves new bank accounts unlisted and vanished ones syncing, and a job that writes after
losing its lease or for a link unlinked mid-fetch overwrites what the user or a later attempt did
"""

import asyncio
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from typing import override
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import delete, select, text, update

from app.encryption import encrypt
from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState, BankProvider, BankProviderRequest, ProviderRequestPurpose
from app.models.bank_sync_job import BankSyncJob, BankSyncJobKind, ProviderErrorKind
from app.models.cache_state import UserCacheState
from app.models.user import User
from app.services.bank_sync import availability
from app.services.bank_sync.availability import PROVIDER_ADAPTERS
from app.services.bank_sync.connections import build_connection_responses
from app.services.bank_sync.providers.contract import ExternalAccount, FetchResult, ProviderError
from app.services.bank_sync.worker import run_jobs
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _build_account,
    _build_bank_link,
    _build_external_account,
    _expire_lease,
    _job_states,
    _seed_job,
)
from tests.services.bank_sync.fake_provider import FakeProviderAdapter

# Without clock changes, so the examples' windows are whole runs of 90 calendar days. The frozen
# clock reads 1 pm on 4 October there
_BRISBANE = ZoneInfo("Australia/Brisbane")
_TODAY = date(2026, 10, 4)

# Yesterday's daily sync, which left a link complete through 3 October
_YESTERDAYS_SYNC = datetime(2026, 10, 3, 9, 0, tzinfo=_BRISBANE)

# More jobs than any test here queues, so a job that keeps queueing another fails the test
_MOST_JOBS = 10

# Long enough for any step here to finish, so a missing protection fails the test rather than hanging it
_WAIT_SECONDS = 10

# Requests a SimpleFIN connection may send in 24 hours
_DAILY_REQUESTS = PROVIDER_ADAPTERS[BankProvider.SIMPLEFIN].daily_request_budget

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
        stored.credential_encrypted = encrypt("https://user:secret@bridge.example/simplefin")
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


def _bank_account(external_id: str, login_key: str = "CON-harbour") -> ExternalAccount:
    """Return a bank account as the provider lists it"""
    return ExternalAccount(
        external_id=external_id,
        name=external_id,
        institution_key="ORG-harbour",
        institution_name="Harbour Bank",
        login_key=login_key,
        currency="CAD",
        currency_raw="CAD",
        balance=100_00,
        available_balance=None,
        balance_at=datetime(2026, 10, 4, tzinfo=UTC),
    )


def _returned(*external_ids: str) -> FetchResult:
    """Return a response bringing back each bank account whole"""
    return FetchResult(accounts=tuple(_bank_account(external_id) for external_id in external_ids))


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


async def _listing(connection: BankConnection) -> tuple[bool, list[str]]:
    """Return whether the connection shows a listing pending, and the bank accounts it lists, as its owner sees them"""
    async with TestSession() as session:
        stored = await session.get(BankConnection, connection.id)
        [response] = await build_connection_responses(session, connection.owner_id, [stored])
    return response.discovery_pending, [account.external_id for account in response.accounts]


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


async def test_job_moves_only_the_checkpoints_of_bank_accounts_the_response_brought_back_whole(connection, provider):
    """Savings has an error of its own, Card's bank login needs a sign-in and Travel didn't come back, so only Everyday's checkpoint moves"""
    names = ("ACT-everyday", "ACT-savings", "ACT-card", "ACT-travel")
    links = [await _link(connection, name, **_synced_through_yesterday()) for name in names]
    provider.outcomes = [
        FetchResult(
            accounts=(_bank_account("ACT-everyday"), _bank_account("ACT-savings"), _bank_account("ACT-card", login_key="CON-card")),
            account_errors={"ACT-savings": ProviderError(ProviderErrorKind.TEMPORARY, "SimpleFIN Bridge reported a problem")},
            login_errors={"CON-card": ProviderError(ProviderErrorKind.BANK_LOGIN_NEEDED, "Sign in to your bank again")},
        )
    ]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _checkpoints(*links) == [_TODAY, date(2026, 10, 3), date(2026, 10, 3), date(2026, 10, 3)]
    assert [status for _, status, *_ in await _jobs()] == ["succeeded"]


class _CardFailingProvider(FakeProviderAdapter):
    """Brings back each bank account asked for whole, except Card, which fails on every request"""

    def __init__(self, failure: str) -> None:
        """Fail Card's bank login, or Card's bank account alone"""
        super().__init__()
        self.failure = failure

    @override
    async def fetch(self, credential: str, **window) -> FetchResult:
        accounts = tuple(
            _bank_account(external_id, login_key="CON-card" if external_id == "ACT-card" else "CON-harbour")
            for external_id in window["account_ids"]
        )
        problem = ProviderError(
            ProviderErrorKind.BANK_LOGIN_NEEDED if self.failure == "bank_login" else ProviderErrorKind.TEMPORARY, "Card failed"
        )
        if self.failure == "bank_login":
            self.outcomes = [FetchResult(accounts=accounts, login_errors={"CON-card": problem})]
        else:
            self.outcomes = [FetchResult(accounts=accounts, account_errors={"ACT-card": problem})]
        return await super().fetch(credential, **window)


@pytest.mark.parametrize("failure", ["bank_login", "bank_account"])
async def test_job_leaves_out_a_link_whose_fetch_failed_and_syncs_the_others(connection, monkeypatch, failure):
    """Card, importing from 1 January, fails on every request, so after its window fails the job goes on to Everyday's daily re-read"""
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    card = await _link(connection, "ACT-card", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    provider = _CardFailingProvider(failure)
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, provider)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [
        _window(date(2026, 1, 1), date(2026, 3, 31), ["ACT-card"]),
        _window(date(2026, 9, 19), _TODAY, ["ACT-everyday"], pending=True),
    ]
    assert await _checkpoints(everyday, card) == [_TODAY, date(2025, 12, 31)]
    assert [status for _, status, *_ in await _jobs()] == ["succeeded"]


async def test_job_carries_an_import_past_a_link_that_fails_on_every_request(connection, monkeypatch):
    """Everyday and Card both import from 1 January and Card's bank login needs a sign-in, so Everyday's import still reaches today

    Each job tries Card again first, until retrying a failing link waits for its own schedule
    """
    everyday = await _link(connection, "ACT-everyday", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    card = await _link(connection, "ACT-card", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    provider = _CardFailingProvider("bank_login")
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, provider)
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    card_alone = _window(date(2026, 1, 1), date(2026, 3, 31), ["ACT-card"])
    assert _fetched(provider) == [
        _window(date(2026, 1, 1), date(2026, 3, 31), ["ACT-card", "ACT-everyday"]),
        card_alone,
        _window(date(2026, 4, 1), date(2026, 6, 29), ["ACT-everyday"]),
        card_alone,
        _window(date(2026, 6, 30), date(2026, 9, 27), ["ACT-everyday"]),
        card_alone,
        _window(date(2026, 9, 28), _TODAY, ["ACT-everyday"], pending=True),
    ]
    assert await _checkpoints(everyday, card) == [_TODAY, date(2025, 12, 31)]


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
    phoenix = ZoneInfo("America/Phoenix")
    async with TestSession() as session:
        (await session.get(User, connection.owner_id)).tz = "America/Phoenix"
        await session.commit()
    link = await _link(
        connection,
        "ACT-1",
        **_synced_through_yesterday(checkpoint=date(2026, 10, 2), last_success_at=datetime(2026, 10, 2, 19, tzinfo=phoenix)),
    )
    provider.outcomes = [_returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 9, 18), date(2026, 10, 3), pending=True, timezone=phoenix)]
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
    """The link synced through today at 8 am and again at 1 pm, so it reads as synced at 1 pm though its checkpoint stays today"""
    await _link(connection, "ACT-1", **_synced_through_yesterday(checkpoint=_TODAY, last_success_at=datetime(2026, 10, 4, 8, tzinfo=_BRISBANE)))
    provider.outcomes = [_returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 9, 20), _TODAY, pending=True)]
    async with TestSession() as session:
        assert (await session.execute(select(BankAccountLink.checkpoint, BankAccountLink.last_success_at))).one() == (_TODAY, frozen_now)


async def test_job_whose_request_fails_records_the_failure_and_moves_no_checkpoint(connection, provider):
    """SimpleFIN Bridge can't be reached: the job records why, the owner's open pages are told so, and the link keeps its checkpoint"""
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    provider.outcomes = [FetchResult(request_error=ProviderError(ProviderErrorKind.TEMPORARY, "SimpleFIN Bridge couldn't be reached"))]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert await _checkpoints(link) == [date(2026, 10, 3)]
    assert [(status, error) for _, status, error, _ in await _jobs()] == [("failed", "temporary")]
    async with TestSession() as session:
        assert await session.get(UserCacheState, connection.owner_id) is not None


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
    async with TestSession() as session:
        assert await session.scalar(select(BankSyncJob.run_after).where(BankSyncJob.status == "queued")) == oldest + timedelta(hours=24)
    assert await _checkpoints(link) == [date(2026, 8, 31)]


async def test_job_fetches_a_window_whose_response_may_be_cut_short_again_in_two_halves(connection, provider):
    """1 January to 31 March brings back 1,000 transactions, so it is fetched again as two 45-day halves, and the import carries on"""
    link = await _link(connection, "ACT-1", import_start=date(2026, 1, 1), checkpoint=date(2025, 12, 31))
    provider.outcomes = [_cut_off("ACT-1"), _returned("ACT-1"), _returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    assert await run_jobs(1) == 1

    assert _fetched(provider) == [
        _window(date(2026, 1, 1), date(2026, 3, 31)),
        _window(date(2026, 1, 1), date(2026, 2, 14)),
        _window(date(2026, 2, 15), date(2026, 3, 31)),
    ]
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
    async with TestSession() as session:
        assert await session.scalar(select(BankSyncJob.run_after).where(BankSyncJob.status == "queued")) == oldest + timedelta(hours=24)


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


async def test_job_sends_nothing_for_a_rejected_connection(connection, provider):
    """A credential the provider rejected can't work until the user reconnects, so the job ends without spending a request"""
    await _link(connection, "ACT-1", **_synced_through_yesterday())
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
    async with TestSession() as session:
        queued = (await session.execute(select(BankSyncJob.discover, BankSyncJob.run_after).where(BankSyncJob.status == "queued"))).one()
    assert queued == (True, oldest + timedelta(hours=24))

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
    async with TestSession() as session:
        queued = (await session.execute(select(BankSyncJob.discover, BankSyncJob.run_after).where(BankSyncJob.status == "queued"))).one()
    assert queued == (False, oldest + timedelta(hours=24))


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


async def test_job_whose_listing_fails_records_it_and_fetches_nothing(connection, provider, frozen_now):
    """SimpleFIN Bridge couldn't be reached for a stale listing, so the connection and the job record it, and no window is sent"""
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    await _set_discovered_at(connection, frozen_now - timedelta(days=2))
    provider.outcomes = [FetchResult(request_error=ProviderError(ProviderErrorKind.TEMPORARY, "SimpleFIN Bridge couldn't be reached"))]
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    await _run_jobs_until_none_is_due()

    assert provider.fetches == []
    async with TestSession() as session:
        assert await session.scalar(select(BankConnection.discovery_failed_at).where(BankConnection.id == connection.id)) == frozen_now
    assert [(status, error) for _, status, error, _ in await _jobs()] == [("failed", "temporary")]
    assert await _checkpoints(link) == [date(2026, 10, 3)]


class _HeldProvider(FakeProviderAdapter):
    """Waits in its first request, after the answer is decided, until the test releases it, as a slow provider would"""

    def __init__(self) -> None:
        """Start with the first request not yet sent"""
        super().__init__()
        self.sending = asyncio.Event()
        self.release = asyncio.Event()

    @override
    async def discover(self, credential: str, **options) -> FetchResult:
        return await self._answer(await super().discover(credential, **options))

    @override
    async def fetch(self, credential: str, **window) -> FetchResult:
        return await self._answer(await super().fetch(credential, **window))

    async def _answer(self, result: FetchResult) -> FetchResult:
        """Return the answer, holding the first until released"""
        if not self.sending.is_set():
            self.sending.set()
            await self.release.wait()
        return result


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
        await provider.sending.wait()
        async with TestSession() as unlinking:
            blocker_pid = await unlinking.scalar(text("SELECT pg_backend_pid()"))
            await unlinking.execute(select(BankConnection.id).where(BankConnection.id == connection.id).with_for_update())
            provider.release.set()
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


async def test_job_sends_each_request_with_the_credential_stored_when_it_is_counted(connection, monkeypatch):
    """A reconnect replaces the credential while the job lists the bank accounts, so the window that follows goes out with the new one"""
    await _link(connection, "ACT-1", **_synced_through_yesterday())
    provider = _HeldProvider()
    provider.outcomes = [_returned("ACT-1"), _returned("ACT-1")]
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, provider)
    await _seed_job(connection, BankSyncJobKind.RETRY, discover=True)

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await provider.sending.wait()
        async with TestSession() as session:
            await session.execute(
                update(BankConnection)
                .where(BankConnection.id == connection.id)
                .values(credential_encrypted=encrypt("https://user:renewed@bridge.example/simplefin"))
            )
            await session.commit()
        provider.release.set()
        await running

    assert provider.discoveries == ["https://user:secret@bridge.example/simplefin"]
    assert [call.credential for call in provider.fetches] == ["https://user:renewed@bridge.example/simplefin"]


async def test_job_moves_no_checkpoint_for_a_link_unlinked_while_it_fetched(connection, monkeypatch):
    """Savings is unlinked while the job waits on the provider, so only Everyday takes what came back"""
    everyday = await _link(connection, "ACT-everyday", **_synced_through_yesterday())
    savings = await _link(connection, "ACT-savings", **_synced_through_yesterday())
    provider = _HeldProvider()
    provider.outcomes = [_returned("ACT-everyday", "ACT-savings")]
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, provider)
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    async with asyncio.timeout(_WAIT_SECONDS):
        running = asyncio.create_task(run_jobs(1))
        await provider.sending.wait()
        async with TestSession() as session:
            await session.execute(
                update(BankAccountLink)
                .where(BankAccountLink.id == savings.id)
                .values(state=BankLinkState.UNLINKED, unlinked_at=datetime(2026, 10, 4, tzinfo=UTC))
            )
            await session.commit()
        provider.release.set()
        await running

    assert await _checkpoints(everyday, savings) == [_TODAY, date(2026, 10, 3)]


async def test_job_attempt_that_lost_its_lease_while_fetching_writes_nothing(connection, monkeypatch):
    """Attempt 1 stalls on the provider past its lease, attempt 2 finds the bank account failing, and attempt 1's late answer changes nothing"""
    link = await _link(connection, "ACT-1", **_synced_through_yesterday())
    provider = _HeldProvider()
    provider.outcomes = [
        _returned("ACT-1"),
        FetchResult(account_errors={"ACT-1": ProviderError(ProviderErrorKind.TEMPORARY, "SimpleFIN Bridge reported a problem")}),
    ]
    monkeypatch.setitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN, provider)
    job = await _seed_job(connection, BankSyncJobKind.SCHEDULED)

    async with asyncio.timeout(_WAIT_SECONDS):
        first_attempt = asyncio.create_task(run_jobs(1))
        await provider.sending.wait()
        await _expire_lease(job)
        assert await run_jobs(1) == 1
        provider.release.set()
        assert await first_attempt == 1

    assert await _checkpoints(link) == [date(2026, 10, 3)]
    assert await _job_states() == {job.id: ("succeeded", 2)}


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
        await provider.sending.wait()
        await _expire_lease(job)
        assert await run_jobs(1) == 1
        provider.release.set()
        assert await first_attempt == 1

    assert await _link_states(link) == ["active"]
    assert await _listing(connection) == (False, ["ACT-1"])
    assert await _job_states() == {job.id: ("succeeded", 2)}
