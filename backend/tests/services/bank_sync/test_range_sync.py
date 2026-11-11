"""Running a link's date range import: the windows it fetches after the routine sync, and what it stores

Jobs run through the worker's run_jobs against the scripted provider, as in test_sync. A range window
longer than the provider allows is refused, and one sent without being counted can spend the user's
Fake Bank token. A range that stores records outside its days brings in what the user never asked
for, one that stores a transaction twice or brings back a dismissed item unasked makes the user clear
it again, and one that moves the checkpoint, the last successful sync or the pending items hides a
gap or a hold from the routine sync. A range that skips a day after a cut-off response or a refusal,
or stores what a window brought back after the link was unlinked, leaves a hole the user believes
is filled. A link import that ends before its range is fetched shows a balance match too early
"""

from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, timedelta
from typing import override
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import delete, func, select, update

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState, BankProviderRequest
from app.models.bank_hold import BankHold
from app.models.bank_pending_transaction import BankPendingTransaction
from app.models.bank_sync_job import BankSyncJob, BankSyncJobKind, ProviderErrorKind
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition, OpenReviewKind
from app.services.bank_sync.providers.contract import FetchResult, ProviderError, ProviderRecord
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _DISMISSED,
    _build_bank_transaction,
    _build_pending_transaction,
    _commit_accepted_items,
    _seed_job,
    _spend_requests,
)
from tests.services.bank_sync.fake_provider import FakeProviderAdapter, _bank_account, _returned, use_adapter
from tests.services.bank_sync.support import _BANK_ID, _KNOWN_BANK_IDS, _TODAY, _bank_transactions, _link, _run_jobs_until_none_is_due

_BRISBANE = ZoneInfo("Australia/Brisbane")

# Yesterday's daily sync. It left a link complete through 3 October
_YESTERDAYS_SYNC = datetime(2026, 10, 3, 9, 0, tzinfo=_BRISBANE)

# Fake Bank reaches back 12 months from 4 October
_PROVIDER_LIMIT = date(2025, 10, 1)

_AWAITING = BankTransactionDisposition.AWAITING_REVIEW
_DISMISSED_ITEM = BankTransactionDisposition.DISMISSED

pytestmark = pytest.mark.usefixtures("worker_sessions")


@pytest.fixture
def provider(fake_provider) -> FakeProviderAdapter:
    """The scripted fake serving the connections' provider"""
    return fake_provider


def _synced(frozen_now: datetime, **values) -> dict:
    """Return the fields of a link synced through 3 October yesterday, next due in 19 hours, so no routine sync is due

    Its own import ended long ago, and it reads as importing for the range it is given
    """
    return {
        "import_start": date(2026, 1, 1),
        "checkpoint": date(2026, 10, 3),
        "last_success_at": _YESTERDAYS_SYNC,
        "next_attempt_at": frozen_now + timedelta(hours=19),
        "importing": True,
    } | values


def _range(first_day: date, last_day: date, *, restores_dismissed: bool = False) -> dict:
    """Return the fields of a link with a date range import from its first day, none of it fetched yet"""
    return {
        "range_first_day": first_day,
        "range_last_day": last_day,
        "range_next_day": first_day,
        "range_restores_dismissed": restores_dismissed,
    }


def _record(external_id: str, day: date, *, amount: int = -4_50, raw_amount: str = "-4.50", removed: bool = False) -> ProviderRecord:
    """Return a booked $4.50 coffee on the day as the provider sends it, or of the amount given, or reported removed"""
    _KNOWN_BANK_IDS.add(external_id)
    return ProviderRecord(
        external_id=external_id,
        date=day,
        amount=amount,
        raw_amount=raw_amount,
        description="POS 4411 COFFEE",
        pending=False,
        removed=removed,
    )


def _window(first_day: date, last_day: date, *, pending: bool = False) -> tuple:
    """Return a fetch of ACT-1 from midnight on the first day to midnight after the last, in Brisbane"""
    start = datetime(first_day.year, first_day.month, first_day.day, tzinfo=_BRISBANE)
    end = datetime(last_day.year, last_day.month, last_day.day, tzinfo=_BRISBANE) + timedelta(days=1)
    return ("ACT-1",), start, end, pending


def _fetched(provider: FakeProviderAdapter) -> list[tuple]:
    """Return each fetch the provider was asked for, in the shape _window builds"""
    return [(tuple(sorted(call.account_ids)), call.start, call.end, call.include_pending) for call in provider.fetches]


def _cut_off() -> FetchResult:
    """Return a response bringing ACT-1 back that Fake Bank may have cut short"""
    return FetchResult(accounts=(_bank_account("ACT-1"),), possibly_cut_off=True)


def _refused() -> FetchResult:
    """Return a response with an error of ACT-1's own, as Fake Bank gives when it refuses the dates asked for"""
    return FetchResult(
        accounts=(_bank_account("ACT-1"),),
        account_errors={"ACT-1": ProviderError(ProviderErrorKind.UNKNOWN, "Fake Bank Online reported a problem")},
    )


def _outage() -> FetchResult:
    """Return a response failing the whole request because Fake Bank couldn't be reached"""
    return FetchResult(request_error=ProviderError(ProviderErrorKind.TEMPORARY, "Fake Bank Online couldn't be reached"))


def _with_records(*records: ProviderRecord) -> FetchResult:
    """Return a response bringing ACT-1 back whole with the records"""
    return FetchResult(accounts=(_bank_account("ACT-1", records=records),))


async def _stored_link(link: BankAccountLink) -> BankAccountLink:
    """Return the link as committed"""
    async with TestSession() as session:
        return await session.get_one(BankAccountLink, link.id)


async def _range_state(link: BankAccountLink) -> tuple:
    """Return the link's committed range days, next day, how its last range ended and whether it is importing"""
    stored = await _stored_link(link)
    return stored.range_first_day, stored.range_last_day, stored.range_next_day, stored.range_outcome, stored.importing


async def _store_record(link: BankAccountLink, external_id: str, **values) -> None:
    """Commit a bank transaction the link's bank account sent, awaiting review unless told otherwise"""
    _KNOWN_BANK_IDS.add(external_id)
    async with TestSession() as session:
        account = await session.get_one(Account, link.account_id)
        record = _build_bank_transaction(account, external_id, external_account_id=link.external_account_id)
        for field, value in values.items():
            setattr(record, field, value)
        session.add(record)
        await session.commit()


async def _requests_sent(connection: BankConnection) -> int:
    """Return how many requests the connection's budget counted"""
    async with TestSession() as session:
        return await session.scalar(
            select(func.count()).select_from(BankProviderRequest).where(BankProviderRequest.connection_id == connection.id)
        )


async def _free_requests(connection: BankConnection) -> None:
    """Let a day pass for the budget: the connection's requests leave it, and its queued job is due"""
    async with TestSession() as session:
        await session.execute(delete(BankProviderRequest).where(BankProviderRequest.connection_id == connection.id))
        await session.execute(
            update(BankSyncJob).where(BankSyncJob.status == "queued").values(run_after=datetime.now(UTC) - timedelta(minutes=1))
        )
        await session.commit()


class _ProviderWithHooks(FakeProviderAdapter):
    """Runs a step the test gives after the fetch numbered for it has its answer, before the job reads it, as though meanwhile"""

    def __init__(self, hooks: dict[int, Callable[[], Awaitable[None]]]) -> None:
        """Run each step after the fetch of its number, counted from 1"""
        super().__init__()
        self.hooks = hooks

    @override
    async def fetch(self, credential: str, **window) -> FetchResult:
        result = await super().fetch(credential, **window)
        hook = self.hooks.get(len(self.fetches))
        if hook is not None:
            await hook()
        return result


async def test_range_fetches_windows_of_at_most_90_days_after_the_routine_sync_and_leaves_its_progress_alone(connection, provider, frozen_now):
    """1 November to 31 March is two windows, one job each, every one counted and none asking for pending items

    The routine sync isn't due, so the range's windows are the only requests. Everyday's checkpoint,
    last successful sync and pending item stay as they were, and the range ends its import
    """
    link = await _link(connection, "ACT-1", **_synced(frozen_now), **_range(date(2025, 11, 1), date(2026, 3, 31)))
    async with TestSession() as session:
        session.add(_build_pending_transaction(await session.get_one(Account, link.account_id), "HOLD HARBOUR FUEL"))
        await session.commit()
    provider.outcomes = [_returned("ACT-1"), _returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2025, 11, 1), date(2026, 1, 29)), _window(date(2026, 1, 30), date(2026, 3, 31))]
    assert await _requests_sent(connection) == 2
    stored = await _stored_link(link)
    assert (stored.checkpoint, stored.last_success_at, stored.last_failure_reason) == (date(2026, 10, 3), _YESTERDAYS_SYNC, None)
    assert await _range_state(link) == (None, None, None, None, False)
    async with TestSession() as session:
        assert (await session.scalars(select(BankPendingTransaction.description))).all() == ["HOLD HARBOUR FUEL"]


async def test_range_waits_for_the_routine_sync_to_reach_today_in_the_same_job(connection, provider, frozen_now):
    """Everyday is due, so the job re-reads the 14 days before its checkpoint through today first, then fetches January to March"""
    link = await _link(connection, "ACT-1", **_synced(frozen_now, next_attempt_at=None), **_range(date(2026, 1, 1), date(2026, 3, 31)))
    provider.outcomes = [_returned("ACT-1"), _returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 9, 19), _TODAY, pending=True), _window(date(2026, 1, 1), date(2026, 3, 31))]
    assert (await _stored_link(link)).checkpoint == _TODAY
    assert await _range_state(link) == (None, None, None, None, False)


@pytest.mark.parametrize("restores_dismissed", [False, True], ids=["dismissed-stay-dismissed", "dismissed-come-back"])
async def test_range_stores_only_new_records_inside_its_days_and_brings_back_dismissed_ones_only_when_asked(
    connection, provider, frozen_now, restores_dismissed
):
    """January to March brings back a new coffee, one waiting, one in the ledger, four dismissed before and two new ones outside the range

    The new coffee waits for review, the waiting one is refreshed in place rather than stored twice,
    and the bank's new amount for the one in the ledger opens a correction, as a routine re-read
    does. A record dated 31 December, the day before the window, is left out, new or dismissed. A
    dismissed coffee dated inside the range comes back for review with the bank's values only when
    the range asks, while a dismissed record of no amount or reported removed stays dismissed, and a
    new record of no amount is a hold
    """
    link = await _link(
        connection, "ACT-1", **_synced(frozen_now), **_range(date(2026, 1, 1), date(2026, 3, 31), restores_dismissed=restores_dismissed)
    )
    await _store_record(link, "TRN-waiting")
    await _commit_accepted_items(link, plain=1)
    for dismissed in ("TRN-dismissed", "TRN-dismissed-early", "TRN-dismissed-zero", "TRN-dismissed-removed"):
        await _store_record(link, dismissed, **_DISMISSED)
    provider.outcomes = [
        _with_records(
            _record("TRN-new", date(2026, 2, 12)),
            _record("TRN-waiting", date(2026, 2, 1)),
            _record("TRN-accepted-0", date(2026, 2, 20)),
            _record("TRN-dismissed", date(2026, 2, 10)),
            _record("TRN-dismissed-early", date(2025, 12, 31)),
            _record("TRN-dismissed-zero", date(2026, 2, 11), amount=0, raw_amount="0.00"),
            _record("TRN-dismissed-removed", date(2026, 2, 14), removed=True),
            _record("TRN-early", date(2025, 12, 31)),
            _record("TRN-zero", date(2026, 2, 13), amount=0, raw_amount="0.00"),
        )
    ]
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    await _run_jobs_until_none_is_due()

    brought_back = (_AWAITING, date(2026, 2, 10), -4_50, 2) if restores_dismissed else (_DISMISSED_ITEM, None, None, 1)
    stored = await _bank_transactions(
        _BANK_ID, BankTransaction.disposition, BankTransaction.observed_date, BankTransaction.observed_amount, BankTransaction.version
    )
    assert [row for row in stored if row[0] != "TRN-accepted-0"] == [
        ("TRN-dismissed", *brought_back),
        ("TRN-dismissed-early", _DISMISSED_ITEM, None, None, 1),
        ("TRN-dismissed-removed", _DISMISSED_ITEM, None, None, 1),
        ("TRN-dismissed-zero", _DISMISSED_ITEM, None, None, 1),
        ("TRN-new", _AWAITING, date(2026, 2, 12), -4_50, 1),
        ("TRN-waiting", _AWAITING, date(2026, 2, 1), -4_50, 2),
    ]
    assert await _bank_transactions(_BANK_ID, BankTransaction.disposition, BankTransaction.open_kind) == [
        ("TRN-accepted-0", BankTransactionDisposition.ACCEPTED, OpenReviewKind.CORRECTION),
        *((bank_id, disposition, None) for bank_id, disposition, *_ in stored if bank_id != "TRN-accepted-0"),
    ]
    async with TestSession() as session:
        assert (await session.scalars(select(BankHold.hold_date))).all() == [date(2026, 2, 13)]


async def test_range_takes_up_where_it_stopped_once_the_request_budget_frees(connection, provider, frozen_now):
    """One of the 20 requests is left. The first window spends it, the next job waits for the budget, and the second window follows"""
    link = await _link(connection, "ACT-1", **_synced(frozen_now), **_range(date(2025, 11, 1), date(2026, 3, 31)))
    await _spend_requests(connection, FakeProviderAdapter.daily_request_budget - 1, frozen_now - timedelta(hours=1))
    provider.outcomes = [_returned("ACT-1"), _returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2025, 11, 1), date(2026, 1, 29))]
    assert await _range_state(link) == (date(2025, 11, 1), date(2026, 3, 31), date(2026, 1, 30), None, True)

    await _free_requests(connection)
    await _run_jobs_until_none_is_due()

    assert _fetched(provider)[1:] == [_window(date(2026, 1, 30), date(2026, 3, 31))]
    assert await _range_state(link) == (None, None, None, None, False)


async def test_range_fetched_again_in_halves_moves_on_only_over_days_stored_in_order(connection, provider, frozen_now):
    """January to March may have been cut short, so its halves are fetched. The first brings a coffee, the second meets an outage

    The range moves on to 15 February only, and the attempt failed, so the range waits for the
    routine sync to come back before fetching again
    """
    link = await _link(connection, "ACT-1", **_synced(frozen_now), **_range(date(2026, 1, 1), date(2026, 3, 31)))
    provider.outcomes = [_cut_off(), _with_records(_record("TRN-coffee", date(2026, 2, 1))), _outage()]
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [
        _window(date(2026, 1, 1), date(2026, 3, 31)),
        _window(date(2026, 1, 1), date(2026, 2, 14)),
        _window(date(2026, 2, 15), date(2026, 3, 31)),
    ]
    assert await _range_state(link) == (date(2026, 1, 1), date(2026, 3, 31), date(2026, 2, 15), None, True)
    assert await _bank_transactions(_BANK_ID) == [("TRN-coffee",)]
    stored = await _stored_link(link)
    assert (stored.last_failure_reason, stored.checkpoint) == ("Fake Bank Online couldn't be reached", date(2026, 10, 3))


async def test_range_the_provider_refuses_even_in_halves_ends_saying_so_and_leaves_the_link_syncing(connection, provider, frozen_now):
    """January to March is refused, then its first 45 days are too. The range ends with the reason, and its later half is never asked for

    A refused range is no fault of the link, so the link's own sync carries on with no failure
    """
    link = await _link(connection, "ACT-1", **_synced(frozen_now), **_range(date(2026, 1, 1), date(2026, 3, 31)))
    provider.outcomes = [_refused(), _refused()]
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(date(2026, 1, 1), date(2026, 3, 31)), _window(date(2026, 1, 1), date(2026, 2, 14))]
    assert await _range_state(link) == (None, None, None, "The date range import stopped: Fake Bank refused those dates", False)
    stored = await _stored_link(link)
    assert (stored.last_failure_reason, stored.retry_count, stored.state) == (None, 0, BankLinkState.ACTIVE)


async def test_range_reaching_behind_the_providers_limit_fetches_from_the_limit_and_says_what_was_left_out(connection, provider, frozen_now):
    """1 September to 15 November 2025, with Fake Bank reaching back to 1 October, fetches from 1 October and says so"""
    link = await _link(connection, "ACT-1", **_synced(frozen_now), **_range(date(2025, 9, 1), date(2025, 11, 15)))
    provider.outcomes = [_returned("ACT-1")]
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    await _run_jobs_until_none_is_due()

    assert _fetched(provider) == [_window(_PROVIDER_LIMIT, date(2025, 11, 15))]
    assert await _range_state(link) == (
        None,
        None,
        None,
        "Transactions before Oct 1, 2025 weren't imported: Fake Bank reaches back 12 months",
        False,
    )


async def test_range_wholly_behind_the_providers_limit_ends_without_a_request(connection, provider, frozen_now):
    """August and September 2025 fell behind Fake Bank's limit before the range ran, so it ends saying so and sends nothing"""
    link = await _link(connection, "ACT-1", **_synced(frozen_now), **_range(date(2025, 8, 1), date(2025, 9, 30)))
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    await _run_jobs_until_none_is_due()

    assert (provider.fetches, await _requests_sent(connection)) == ([], 0)
    assert await _range_state(link) == (
        None,
        None,
        None,
        "Transactions before Oct 1, 2025 weren't imported: Fake Bank reaches back 12 months",
        False,
    )


async def test_range_window_answered_after_its_link_was_unlinked_stores_nothing(connection, frozen_now, monkeypatch):
    """Everyday is unlinked while January to March is fetched, so the coffee it brought back is never stored for it"""
    link = await _link(connection, "ACT-1", **_synced(frozen_now), **_range(date(2026, 1, 1), date(2026, 3, 31)))

    async def unlink() -> None:
        """Unlink Everyday as the unlink request does, ending its range"""
        async with TestSession() as session:
            await session.execute(
                update(BankAccountLink)
                .where(BankAccountLink.id == link.id)
                .values(
                    state=BankLinkState.UNLINKED,
                    unlinked_at=frozen_now,
                    range_first_day=None,
                    range_last_day=None,
                    range_next_day=None,
                    range_restores_dismissed=None,
                )
            )
            await session.commit()

    adapter = _ProviderWithHooks({1: unlink})
    adapter.outcomes = [_with_records(_record("TRN-coffee", date(2026, 2, 1)))]
    use_adapter(monkeypatch, adapter)
    await _seed_job(connection, BankSyncJobKind.MANUAL)

    await _run_jobs_until_none_is_due()

    assert len(adapter.fetches) == 1
    assert await _bank_transactions(_BANK_ID) == []
    assert (await _stored_link(link)).range_next_day is None


async def test_link_import_keeps_running_until_its_range_is_fetched(connection, frozen_now, monkeypatch):
    """Everyday was linked today for August. The import of today ends its routine part, yet Everyday still imports while August is fetched

    So the balance match and the review pause wait for August, and the import ends with it
    """
    link = await _link(
        connection, "ACT-1", import_start=_TODAY, checkpoint=_TODAY - timedelta(days=1), **_range(date(2026, 8, 1), date(2026, 8, 31))
    )
    importing_during_range: list[bool] = []

    async def note_importing() -> None:
        """Note whether Everyday reads as importing while its range's window is out"""
        importing_during_range.append((await _stored_link(link)).importing)

    adapter = _ProviderWithHooks({2: note_importing})
    adapter.outcomes = [_returned("ACT-1"), _returned("ACT-1")]
    use_adapter(monkeypatch, adapter)
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert [(call.start, call.include_pending) for call in adapter.fetches] == [
        (datetime(2026, 10, 4, tzinfo=_BRISBANE), True),
        (datetime(2026, 8, 1, tzinfo=_BRISBANE), False),
    ]
    assert importing_during_range == [True]
    assert (await _stored_link(link)).checkpoint == _TODAY
    assert await _range_state(link) == (None, None, None, None, False)
