"""Linking an account: the clock's boundaries and the locks a link takes

The fresh-discovery age and the ends of the import range are boundaries checked here to the second,
under a clock frozen for every module. A route test pins only the modules it names. The locks matter only while another party is
mid-flight: a second link of the same account must wait and see the first, a discovery that stops
listing the bank account must wait and move the new link with the others, and choosing a bank
account again must see an unlink or a discovery that moved the link meanwhile
"""

import asyncio
from datetime import date, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState
from app.models.bank_sync_job import BankSyncJobKind, BankSyncJobStatus, ProviderErrorKind
from app.models.currency import Currency
from app.models.user import User
from app.schemas.bank_sync import BankAccountLinkResponse, LinkBankAccountRequest
from app.services.bank_sync import links
from app.services.bank_sync.discovery import apply_discovery
from app.services.bank_sync.links import ACCOUNT_ALREADY_LINKED, link_bank_account, list_bank_accounts_for_account, unlink_account
from app.services.bank_sync.providers.contract import ExternalAccount, FetchResult, ProviderError
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _build_account,
    _build_bank_link,
    _build_user,
    _commit_listed_connection,
    _seed_job,
    _update_connection,
)
from tests.routes.support.identity_helpers import _act_as
from tests.routes.support.lock_helpers import _wait_until_waiting_on
from tests.services.bank_sync.support import _jobs

# A month before the frozen clock's 3 October in Toronto, well inside the import range
_START = date(2026, 9, 3)


@pytest.fixture
async def linkable() -> tuple[User, Account, BankConnection]:
    """Commit a Toronto user with an empty CAD account and a connection listing ACT-1 and ACT-2 at Harbour Bank"""
    async with TestSession() as session:
        session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
        user = _build_user("linker@example.com")
        session.add(user)
        await session.flush()
        account = _build_account(user.id)
        session.add(account)
        await session.commit()
    return user, account, await _commit_listed_connection(user.id, "ACT-1", "ACT-2")


async def _list_as(user: User, account: Account, connection: BankConnection):
    """List the connection's bank accounts for the account, as the user under row-level security"""
    async with _act_as(user.id) as db:
        return await list_bank_accounts_for_account(db, user, connection.id, account.id)


async def _link_as(user: User, account: Account, connection: BankConnection, external_id: str, start: date) -> BankAccountLinkResponse:
    """Link the account to a bank account on the connection, as the user under row-level security"""
    request = LinkBankAccountRequest(connection_id=connection.id, external_account_id=external_id, start_date=start)
    async with _act_as(user.id) as db:
        return await link_bank_account(db, user, account.id, request)


async def _link_states() -> list[tuple]:
    """Return every link's bank account and state"""
    async with TestSession() as session:
        return [tuple(row) for row in await session.execute(select(BankAccountLink.external_account_id, BankAccountLink.state))]


@pytest.mark.parametrize(
    ("age", "asks"),
    [(timedelta(hours=1), False), (timedelta(hours=1, seconds=1), True)],
    ids=["exactly-an-hour", "an-hour-and-a-second"],
)
async def test_link_flow_asks_for_a_discovery_once_the_last_is_over_an_hour_old(linkable, frozen_now, age, asks):
    """A listing exactly an hour old is still fresh, and one a second older asks for a discovery"""
    user, account, connection = linkable
    await _update_connection(connection, discovered_at=frozen_now - age)

    listed = await _list_as(user, account, connection)

    assert listed.discovery_pending is asks
    assert await _jobs() == ([(BankSyncJobKind.RETRY, True, BankSyncJobStatus.QUEUED)] if asks else [])


async def test_link_flow_with_the_request_budget_spent_asks_for_no_discovery(linkable, frozen_now):
    """A discovery counts against the budget, so none is asked for while Fake Bank says it is spent"""
    user, account, connection = linkable
    await _update_connection(
        connection,
        discovered_at=frozen_now - timedelta(hours=3),
        request_budget_spent_until=frozen_now + timedelta(hours=1),
    )

    listed = await _list_as(user, account, connection)

    assert listed.discovery_pending is False
    assert await _jobs() == []


async def test_link_flow_with_a_discovery_running_asks_for_no_second_one(linkable, frozen_now):
    """While a job is listing the bank accounts, opening the flow waits for it rather than queueing another"""
    user, account, connection = linkable
    await _update_connection(connection, discovered_at=frozen_now - timedelta(hours=3))
    await _seed_job(
        connection,
        BankSyncJobKind.SCHEDULED,
        status=BankSyncJobStatus.RUNNING,
        discover=True,
        attempt=1,
        lease_expires_at=frozen_now + timedelta(minutes=10),
    )

    listed = await _list_as(user, account, connection)

    assert listed.discovery_pending is True
    assert await _jobs() == [(BankSyncJobKind.SCHEDULED, True, BankSyncJobStatus.RUNNING)]


@pytest.mark.parametrize(
    ("start", "allowed"),
    [(date(2025, 10, 1), True), (date(2025, 9, 30), False), (date(2026, 10, 3), True), (date(2026, 10, 4), False)],
    ids=["earliest-allowed", "a-day-before-it", "today", "tomorrow"],
)
async def test_link_start_has_to_be_inside_the_import_range(linkable, frozen_now, start, allowed):
    """At 11 pm on 3 October in Toronto, an empty account takes a start from 1 October 2025 through today"""
    user, account, connection = linkable

    if allowed:
        linked = await _link_as(user, account, connection, "ACT-1", start)
        assert linked.import_start == start
    else:
        with pytest.raises(HTTPException) as refused:
            await _link_as(user, account, connection, "ACT-1", start)
        assert (refused.value.status_code, refused.value.detail) == (422, "Choose a start date from Oct 1, 2025 to Oct 3, 2026")
        assert await _link_states() == []


class _PausedRead:
    """Holds the first link request once it has taken its locks, until the test releases it"""

    def __init__(self, read) -> None:
        """Wrap the read the link makes right after locking"""
        self._read = read
        self.reached = asyncio.Event()
        self.release = asyncio.Event()
        self.pid: int | None = None

    async def __call__(self, db, user_id):
        """Pause the first caller, recording its database backend, and pass every later one through"""
        if not self.reached.is_set():
            self.pid = await db.scalar(text("SELECT pg_backend_pid()"))
            self.reached.set()
            await self.release.wait()
        return await self._read(db, user_id)


async def test_link_waits_for_a_link_of_the_same_account_still_saving_and_is_refused(linkable, monkeypatch, frozen_now):
    """Two links of Everyday at once: the second waits for the first and is told the account is already linked"""
    user, account, connection = linkable
    paused = _PausedRead(links.read_linked_bank_accounts)
    monkeypatch.setattr(links, "read_linked_bank_accounts", paused)

    async with asyncio.timeout(10):
        first = asyncio.create_task(_link_as(user, account, connection, "ACT-1", _START))
        await paused.reached.wait()
        second = asyncio.create_task(_link_as(user, account, connection, "ACT-2", _START))
        await _wait_until_waiting_on(paused.pid, second)
        paused.release.set()
        await first
        with pytest.raises(HTTPException) as refused:
            await second

    assert (refused.value.status_code, refused.value.detail) == (409, ACCOUNT_ALREADY_LINKED)
    assert await _link_states() == [("ACT-1", "active")]


async def test_discovery_that_stops_listing_a_bank_account_waits_for_its_link_and_moves_it(linkable, monkeypatch, frozen_now):
    """A discovery that no longer finds ACT-1 while Everyday is being linked to it moves the new link to Choose bank account"""
    user, account, connection = linkable
    paused = _PausedRead(links.read_linked_bank_accounts)
    monkeypatch.setattr(links, "read_linked_bank_accounts", paused)

    async def discover_nothing():
        """Store a discovery that lists none of the connection's bank accounts, as the user"""
        async with _act_as(user.id) as db:
            discovered = await db.get_one(BankConnection, connection.id)
            await apply_discovery(db, discovered, FetchResult(), now=frozen_now)
            await db.commit()

    async with asyncio.timeout(10):
        linking = asyncio.create_task(_link_as(user, account, connection, "ACT-1", _START))
        await paused.reached.wait()
        discovery = asyncio.create_task(discover_nothing())
        await _wait_until_waiting_on(paused.pid, discovery)
        paused.release.set()
        await linking
        await discovery

    assert await _link_states() == [("ACT-1", "choose_account")]


async def _commit_choosing_link(account: Account, connection: BankConnection) -> None:
    """Commit the account's link to ACT-1 waiting in Choose bank account"""
    async with TestSession() as session:
        session.add(_build_bank_link(account, connection, "ACT-1", state=BankLinkState.CHOOSE_ACCOUNT))
        await session.commit()


async def _link_kinds() -> list[tuple]:
    """Return every link's bank account, state and import kind, by bank account"""
    async with TestSession() as session:
        rows = await session.execute(
            select(BankAccountLink.external_account_id, BankAccountLink.state, BankAccountLink.import_kind).order_by(
                BankAccountLink.external_account_id
            )
        )
        return [tuple(row) for row in rows]


async def test_choose_again_finding_its_link_unlinked_meanwhile_links_afresh(linkable, monkeypatch, frozen_now):
    """Everyday is unlinked while choosing ACT-2 again, so the choice makes a new link as a relink and the ended one stays ended"""
    user, account, connection = linkable
    await _commit_choosing_link(account, connection)
    paused = _PausedRead(links.read_linked_bank_accounts)
    monkeypatch.setattr(links, "read_linked_bank_accounts", paused)

    async def unlink():
        """Unlink Everyday as the user"""
        async with _act_as(user.id) as db:
            await unlink_account(db, user, account.id)

    async with asyncio.timeout(10):
        choosing = asyncio.create_task(_link_as(user, account, connection, "ACT-2", _START))
        await paused.reached.wait()
        await unlink()
        paused.release.set()
        await choosing

    assert await _link_kinds() == [("ACT-1", "unlinked", "initial"), ("ACT-2", "active", "relink")]


async def test_choose_again_finding_its_link_active_again_meanwhile_is_refused(linkable, monkeypatch, frozen_now):
    """A discovery lists ACT-1 again while Everyday chooses ACT-2, so the link is back on ACT-1 and the choice is refused"""
    user, account, connection = linkable
    await _commit_choosing_link(account, connection)
    paused = _PausedRead(links.read_linked_bank_accounts)
    monkeypatch.setattr(links, "read_linked_bank_accounts", paused)
    act_1 = ExternalAccount(
        external_id="ACT-1",
        name="Everyday Chequing",
        institution_key="harbour",
        institution_name="Harbour Bank",
        login_key="login-1",
        currency="CAD",
        currency_raw="CAD",
        balance=None,
        available_balance=None,
        balance_at=frozen_now,
    )

    async def list_act_1_again():
        """Store a discovery listing ACT-1 again, and failing for ACT-2 so it isn't taken as gone, as the user"""
        result = FetchResult(
            accounts=(act_1,), account_errors={"ACT-2": ProviderError(ProviderErrorKind.TEMPORARY, "Harbour Bank didn't answer")}
        )
        async with _act_as(user.id) as db:
            discovered = await db.get_one(BankConnection, connection.id)
            await apply_discovery(db, discovered, result, now=frozen_now)
            await db.commit()

    async with asyncio.timeout(10):
        choosing = asyncio.create_task(_link_as(user, account, connection, "ACT-2", _START))
        await paused.reached.wait()
        await list_act_1_again()
        paused.release.set()
        with pytest.raises(HTTPException) as refused:
            await choosing

    assert (refused.value.status_code, refused.value.detail) == (409, ACCOUNT_ALREADY_LINKED)
    assert await _link_kinds() == [("ACT-1", "active", "initial")]
