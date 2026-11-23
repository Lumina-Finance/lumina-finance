"""What a bank sync job does with a link to an account the installed check keeps read-only, as its currency is another than the owner's main one

A job that brought records into such an account would change a record the user can't change, and one
that counted the skip as a failure would show a failed sync and email the owner about nothing they
can fix. One that left the link due at once would queue an empty sync every scan
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.allowance_hook import AllowanceKind
from app.models.bank_connection import BankAccountLink, BankConnection
from app.models.bank_sync_job import BankSyncJob, BankSyncJobKind, ProviderErrorKind
from app.models.bank_transaction import BankTransaction
from app.services.bank_sync.providers.contract import FetchResult, ProviderError, ProviderRecord
from app.services.bank_sync.schedule import DAILY_SYNC_INTERVAL
from tests.conftest import TestSession
from tests.routes.support.allowance_helpers import install_check, seed_usd_currency
from tests.routes.support.bank_sync_helpers import _attempts, _build_account, _build_bank_link, _build_external_account, _seed_job
from tests.services.bank_sync.fake_provider import FakeProviderAdapter, _bank_account
from tests.services.bank_sync.support import _BANK_ID, _KNOWN_BANK_IDS, _bank_transactions, _run_jobs_until_none_is_due

pytestmark = pytest.mark.usefixtures("worker_sessions")

# Yesterday's daily sync in the owner's Brisbane left both links complete through 3 October
_YESTERDAYS_SYNC = datetime(2026, 10, 3, 9, 0, tzinfo=ZoneInfo("Australia/Brisbane"))


async def _commit_link(connection: BankConnection, external_id: str, currency: str) -> BankAccountLink:
    """Commit an account in the currency, listed and linked to the bank account, which yesterday's daily sync left complete"""
    account = _build_account(connection.owner_id, name=external_id)
    account.currency = currency
    listed = _build_external_account(connection, external_id)
    listed.currency = currency
    link = _build_bank_link(account, connection, external_id, last_success_at=_YESTERDAYS_SYNC, importing=False)
    link.import_start = date(2026, 1, 1)
    link.checkpoint = date(2026, 10, 3)
    async with TestSession() as session:
        session.add_all([account, listed])
        await session.flush()
        session.add(link)
        await session.commit()
    return link


def _coffee(external_id: str) -> ProviderRecord:
    """Return a booked $4.50 coffee on 2 October"""
    _KNOWN_BANK_IDS.add(external_id)
    return ProviderRecord(
        external_id=external_id,
        date=date(2026, 10, 2),
        amount=-4_50,
        raw_amount="-4.50",
        description="POS 4411 COFFEE",
        pending=False,
        note="POS 4411 COFFEE",
        merchant=None,
    )


async def _next_sync_at(connection: BankConnection) -> datetime | None:
    """Return when the connection's next scheduled sync is due"""
    async with TestSession() as session:
        return await session.scalar(select(BankConnection.next_sync_at).where(BankConnection.id == connection.id))


@pytest.fixture
async def links(connection, linked) -> tuple[BankAccountLink, BankAccountLink]:
    """The linked accounts, with a scheduled sync queued"""
    await _seed_job(connection, BankSyncJobKind.SCHEDULED)
    return linked


@pytest.fixture
async def linked(connection, fake_provider: FakeProviderAdapter) -> tuple[BankAccountLink, BankAccountLink]:
    """A Canadian and a US account linked on the connection, each with a coffee waiting at the bank"""
    await seed_usd_currency()
    cad = await _commit_link(connection, "ACT-cad", "CAD")
    usd = await _commit_link(connection, "ACT-usd", "USD")
    fake_provider.outcomes = [
        FetchResult(
            accounts=(
                _bank_account("ACT-cad", records=[_coffee("TRN-cad")]),
                _bank_account("ACT-usd", records=[_coffee("TRN-usd")], currency="USD"),
            )
        )
    ]
    return cad, usd


async def test_job_brings_nothing_into_a_read_only_account_records_no_attempt_and_emails_nobody(
    connection, links, fake_provider: FakeProviderAdapter, frozen_now, sent_action_emails
):
    """The Canadian account syncs as always, and the US one is left as yesterday's sync left it, looked at again no sooner than a day on

    The check is asked once for the whole job
    """
    cad, usd = links
    usd_before = await _attempts(usd)
    asked = install_check(refused={AllowanceKind.FOREIGN_CURRENCIES})

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(BankTransaction.external_account_id, _BANK_ID) == [("ACT-cad", "TRN-cad")]
    assert [call.account_ids for call in fake_provider.fetches] == [("ACT-cad",)], "the job asked the bank for the read-only account"
    assert await _attempts(usd) == usd_before, "the skip changed the read-only account's link"
    assert (await _attempts(cad))[0][0] == frozen_now
    assert sent_action_emails == []
    assert await _next_sync_at(connection) >= frozen_now + DAILY_SYNC_INTERVAL
    assert [request.kind for request in asked].count(AllowanceKind.FOREIGN_CURRENCIES) == 1


async def test_sync_now_for_a_read_only_account_is_dropped_and_passes_nothing_on(connection, linked, fake_provider: FakeProviderAdapter):
    """The user asked both accounts to sync now, the US one held back from an earlier job, and the job syncs the Canadian one alone

    Kept among the links asked for, the US one would be handed on to a further job that could never sync it
    """
    cad, usd = linked
    asked = await _seed_job(connection, BankSyncJobKind.MANUAL, deferred_link_ids=[usd.id], requested_link_ids=[cad.id, usd.id])
    install_check(refused={AllowanceKind.FOREIGN_CURRENCIES})

    await _run_jobs_until_none_is_due()

    assert [call.account_ids for call in fake_provider.fetches] == [("ACT-cad",)]
    async with TestSession() as session:
        later = (
            await session.execute(select(BankSyncJob.requested_link_ids, BankSyncJob.deferred_link_ids).where(BankSyncJob.id != asked.id))
        ).all()
    assert later == [], "the job queued another for the read-only link"


async def test_sync_now_handed_on_after_a_rate_limit_leaves_the_read_only_account_out(connection, linked, fake_provider: FakeProviderAdapter):
    """The bank asks for fewer requests on the Canadian fetch, and the job queued after it takes the Canadian account alone"""
    cad, usd = linked
    asked = await _seed_job(connection, BankSyncJobKind.MANUAL, deferred_link_ids=[usd.id], requested_link_ids=[cad.id, usd.id])
    fake_provider.outcomes = [
        FetchResult(request_error=ProviderError(ProviderErrorKind.RATE_LIMITED, "Fake Bank Online asked for fewer requests"))
    ]
    install_check(refused={AllowanceKind.FOREIGN_CURRENCIES})

    await _run_jobs_until_none_is_due()

    async with TestSession() as session:
        later = (
            await session.execute(select(BankSyncJob.requested_link_ids, BankSyncJob.deferred_link_ids).where(BankSyncJob.id != asked.id))
        ).all()
    assert [set(requested) for requested, _ in later] == [{cad.id}]
    assert all(usd.id not in deferred for _, deferred in later), "the read-only link was handed on as held back"


async def test_job_with_no_check_installed_syncs_an_account_in_another_currency(links, fake_provider: FakeProviderAdapter, frozen_now):
    """Both accounts sync"""
    cad, usd = links

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(BankTransaction.external_account_id, _BANK_ID) == [("ACT-cad", "TRN-cad"), ("ACT-usd", "TRN-usd")]
    assert [sorted(call.account_ids) for call in fake_provider.fetches] == [["ACT-cad", "ACT-usd"]]
    assert [attempt[0] for attempt in await _attempts(cad, usd)] == [frozen_now, frozen_now]


async def test_job_syncs_an_account_in_another_currency_the_check_allows(links, fake_provider: FakeProviderAdapter):
    """A check refusing something else leaves the US account syncing"""
    install_check(refused={AllowanceKind.TAX_ADVANTAGED_CATEGORY})

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(BankTransaction.external_account_id, _BANK_ID) == [("ACT-cad", "TRN-cad"), ("ACT-usd", "TRN-usd")]
