"""Discovering a connection's bank accounts through the fake SimpleFIN Bridge

A bank account stored wrongly is linked or refused wrongly, a link moved on a gap the response
explains stops a working account's sync, and one not moved on a real vanish or currency change
reads amounts at the wrong precision. Every discovery is a request against the daily budget, so it
has to be counted before it is sent
"""

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import func, select

from app.encryption import encrypt
from app.models.bank_connection import BankAccountLink, BankConnection, BankExternalAccount, BankLinkState, BankProviderRequest
from app.models.currency import Currency
from app.services.bank_sync.discovery import apply_discovery, run_discovery
from app.services.bank_sync.provider_requests import RequestBudget, read_request_budget
from app.services.bank_sync.providers.contract import ExternalAccount, FetchResult
from app.services.bank_sync.providers.simplefin.adapter import SimpleFinAdapter
from tests.conftest import TestSession
from tests.fake_simplefin_bridge import FakeBridgeTransport
from tests.routes.support.bank_sync_helpers import _build_account, _build_bank_connection, _build_bank_link, _build_user
from tests.services.bank_sync.stand_ins import FakeBridgeScenario, simplefin_adapter

_NOW = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)
_BALANCE_AT = datetime.fromtimestamp(1791115200, UTC)

# Called with each accounts request before or after the fake Bridge answers it
type _Hook = Callable[[], Awaitable[None]]


class _WatchedTransport(httpx.AsyncBaseTransport):
    """Passes requests to the fake Bridge, running a hook as each accounts request is sent and answered"""

    def __init__(self, *, on_send: _Hook | None = None, on_answer: _Hook | None = None) -> None:
        """Run on_send before an accounts request reaches the fake, and on_answer once it has answered"""
        self._inner = FakeBridgeTransport()
        self._on_send = on_send
        self._on_answer = on_answer
        self.accounts_requests = 0

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        """Forward the request, running the hooks around an accounts request"""
        is_accounts = request.url.path.endswith("/accounts")
        if is_accounts:
            self.accounts_requests += 1
            if self._on_send:
                await self._on_send()
        response = await self._inner.handle_async_request(request)
        if is_accounts and self._on_answer:
            await self._on_answer()
        return response


async def _stored_connection(db) -> BankConnection:
    """Store a connection for a new user in CAD, its credential a placeholder no request is sent with"""
    db.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
    await db.flush()
    user = _build_user("discovery@example.com")
    db.add(user)
    await db.flush()
    connection = _build_bank_connection(user.id)
    db.add(connection)
    await db.flush()
    return connection


async def _claimed_connection(db, scenario: FakeBridgeScenario) -> BankConnection:
    """Claim the scenario and store its connection for a new user, as the claim request would"""
    access_url = await simplefin_adapter(FakeBridgeTransport()).claim(scenario.setup_token)
    db.add_all(
        [
            Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
            Currency(id="EUR", name="Euro", symbol="€", minor_unit_exponent=2),
        ]
    )
    connection = await _stored_connection(db)
    connection.credential_encrypted = encrypt(access_url)
    await db.flush()
    return connection


async def _linked(db, connection: BankConnection, name: str, external_id: str) -> BankAccountLink:
    """Add a USD account linked to the bank account"""
    account = _build_account(connection.owner_id, name)
    account.currency = "USD"
    db.add(account)
    await db.flush()
    link = _build_bank_link(account, connection, external_id)
    db.add(link)
    await db.flush()
    return link


async def _link_state(link: BankAccountLink) -> str:
    """Return the link's committed state"""
    async with TestSession() as session:
        return await session.scalar(select(BankAccountLink.state).where(BankAccountLink.id == link.id))


async def _listed(connection: BankConnection) -> dict[str, bool]:
    """Return whether each stored bank account of the connection is still listed, as committed"""
    async with TestSession() as session:
        rows = await session.execute(
            select(BankExternalAccount.external_id, BankExternalAccount.listed).where(BankExternalAccount.connection_id == connection.id)
        )
        return dict(rows.all())


async def _discover(db, connection: BankConnection, at: datetime = _NOW, transport: httpx.AsyncBaseTransport | None = None) -> bool:
    """Run a discovery as the claim request does, and commit what it wrote"""
    adapter: SimpleFinAdapter = simplefin_adapter(transport or FakeBridgeTransport())
    discovered = await run_discovery(db, connection, adapter, now=at)
    await db.commit()
    return discovered


async def test_discovery_stores_each_bank_account_as_listed(db, scenario: FakeBridgeScenario):
    """ISO, URL and empty currencies are kept as sent, and a missing available balance stays empty"""
    await scenario.add_harbour_accounts()
    await scenario.change("PATCH", "/accounts/ACT-savings", {"available_balance": "8150.00"})
    for account_id, name, currency in [
        ("ACT-miles", "Flight Miles", "https://www.simplefin.org/currencies/miles"),
        ("ACT-blank", "Gift Card", ""),
    ]:
        account = {
            "id": account_id,
            "name": name,
            "conn_id": "CON-harbourline",
            "currency": currency,
            "balance": "1200",
            "balance_date": 1791115200,
        }
        await scenario.change("POST", "/accounts", account)
    connection = await _claimed_connection(db, scenario)

    assert await _discover(db, connection) is True

    stored = (
        await db.execute(
            select(
                BankExternalAccount.external_id,
                BankExternalAccount.name,
                BankExternalAccount.institution_key,
                BankExternalAccount.institution_name,
                BankExternalAccount.login_key,
                BankExternalAccount.currency,
                BankExternalAccount.balance,
                BankExternalAccount.available_balance,
                BankExternalAccount.balance_at,
                BankExternalAccount.listed,
            ).order_by(BankExternalAccount.external_id)
        )
    ).all()
    harbourline = ("ORG-harbourline", "Harbourline Card Services", "CON-harbourline")
    assert [tuple(row) for row in stored] == [
        ("ACT-blank", "Gift Card", *harbourline, "", None, None, _BALANCE_AT, True),
        ("ACT-chequing", "Everyday Chequing", "ORG-harbour", "Harbour Bank", "CON-harbour", "USD", 251075, None, _BALANCE_AT, True),
        ("ACT-miles", "Flight Miles", *harbourline, "https://www.simplefin.org/currencies/miles", None, None, _BALANCE_AT, True),
        ("ACT-savings", "Online Savings", "ORG-harbour", "Harbour Bank", "CON-harbour", "USD", 820000, 815000, _BALANCE_AT, True),
        ("ACT-visa", "Rewards Visa", *harbourline, "USD", -64012, None, _BALANCE_AT, True),
    ]
    assert connection.discovered_at == _NOW


async def test_discovery_request_is_counted_before_it_is_sent_and_survives_a_crash(db, scenario: FakeBridgeScenario):
    """The request is committed before it leaves, so a worker that restarts just after sending still counted it"""
    await scenario.add_harbour_accounts()
    connection = await _claimed_connection(db, scenario)
    seen_at_send: list[int] = []

    async def count_committed() -> None:
        """Record how many of the connection's requests another session can already see"""
        async with TestSession() as session:
            seen_at_send.append(
                await session.scalar(
                    select(func.count()).select_from(BankProviderRequest).where(BankProviderRequest.connection_id == connection.id)
                )
            )

    async def crash() -> None:
        """Stop the sender once the Bridge has answered, as a restart would"""
        raise RuntimeError("The worker restarted")

    with pytest.raises(RuntimeError, match="The worker restarted"):
        await _discover(db, connection, transport=_WatchedTransport(on_send=count_committed, on_answer=crash))
    await db.rollback()

    assert seen_at_send == [1]
    async with TestSession() as session:
        purposes = (await session.scalars(select(BankProviderRequest.purpose).where(BankProviderRequest.connection_id == connection.id))).all()
    assert purposes == ["discovery"]


async def test_discovery_with_the_budget_spent_sends_nothing(db, scenario: FakeBridgeScenario):
    """A connection with 20 requests in the last 24 hours waits rather than discovering"""
    await scenario.add_harbour_accounts()
    connection = await _claimed_connection(db, scenario)
    db.add_all(
        BankProviderRequest(
            owner_id=connection.owner_id, connection_id=connection.id, purpose="sync", requested_at=_NOW - timedelta(hours=hour)
        )
        for hour in range(1, 21)
    )
    await db.flush()
    transport = _WatchedTransport()

    assert await _discover(db, connection, transport=transport) is False

    assert transport.accounts_requests == 0
    assert await _listed(connection) == {}


async def test_discovery_lists_a_bank_account_added_since_the_last_one(db, scenario: FakeBridgeScenario):
    """Northgate Credit Union, added in SimpleFIN Bridge after the claim, appears at the next discovery"""
    await scenario.add_harbour_accounts()
    connection = await _claimed_connection(db, scenario)
    await _discover(db, connection)
    await scenario.change("POST", "/connections", {"conn_id": "CON-northgate", "name": "Northgate Credit Union", "org_id": "ORG-northgate"})
    joint = {"id": "ACT-joint", "name": "Joint Chequing", "conn_id": "CON-northgate", "currency": "USD", "balance": "900.00"}
    await scenario.change("POST", "/accounts", joint)

    await _discover(db, connection, _NOW + timedelta(hours=3))

    assert await _listed(connection) == {"ACT-chequing": True, "ACT-savings": True, "ACT-visa": True, "ACT-joint": True}


async def test_discovery_vanished_linked_bank_account_moves_its_link_to_choose_account(db, scenario: FakeBridgeScenario):
    """Everyday Chequing missing from an error-free discovery stops Everyday's sync, and Rewards Visa carries on"""
    await scenario.add_harbour_accounts()
    connection = await _claimed_connection(db, scenario)
    everyday = await _linked(db, connection, "Everyday", "ACT-chequing")
    visa = await _linked(db, connection, "Visa", "ACT-visa")
    await _discover(db, connection)
    await scenario.change("PATCH", "/accounts/ACT-chequing", {"hidden": True})

    await _discover(db, connection, _NOW + timedelta(days=1))

    assert await _link_state(everyday) == BankLinkState.CHOOSE_ACCOUNT
    assert await _link_state(visa) == BankLinkState.ACTIVE
    assert await _listed(connection) == {"ACT-chequing": False, "ACT-savings": True, "ACT-visa": True}


@pytest.mark.parametrize(
    "problem",
    [
        {"code": "con.auth", "msg": "Harbour Bank needs you to sign in again.", "conn_id": "CON-harbour"},
        {"code": "act.closing", "msg": "Everyday Chequing is being updated.", "conn_id": "CON-harbour", "account_id": "ACT-chequing"},
        {"code": "gen.maintenance", "msg": "Some banks may be slow to update tonight."},
    ],
    ids=["bank-login-error", "account-error", "general-warning"],
)
async def test_discovery_missing_bank_account_with_an_explaining_error_keeps_its_link(db, scenario: FakeBridgeScenario, problem):
    """A sign-in problem at Harbour Bank, an error for the account or a general warning explains the gap"""
    await scenario.add_harbour_accounts()
    connection = await _claimed_connection(db, scenario)
    everyday = await _linked(db, connection, "Everyday", "ACT-chequing")
    await _discover(db, connection)
    await scenario.change("PATCH", "/accounts/ACT-chequing", {"hidden": True})
    await scenario.change("POST", "/errors", problem)

    await _discover(db, connection, _NOW + timedelta(days=1))

    assert await _link_state(everyday) == BankLinkState.ACTIVE
    assert (await _listed(connection))["ACT-chequing"] is True


async def test_discovery_link_returns_by_itself_when_its_bank_account_is_listed_again(db, scenario: FakeBridgeScenario):
    """Everyday Chequing listed again the next day with the same id and currency puts Everyday back to active"""
    await scenario.add_harbour_accounts()
    connection = await _claimed_connection(db, scenario)
    everyday = await _linked(db, connection, "Everyday", "ACT-chequing")
    await _discover(db, connection)
    await scenario.change("PATCH", "/accounts/ACT-chequing", {"hidden": True})
    await _discover(db, connection, _NOW + timedelta(days=1))
    assert await _link_state(everyday) == BankLinkState.CHOOSE_ACCOUNT
    await scenario.change("PATCH", "/accounts/ACT-chequing", {"hidden": False})

    await _discover(db, connection, _NOW + timedelta(days=2))

    assert await _link_state(everyday) == BankLinkState.ACTIVE
    assert (await _listed(connection))["ACT-chequing"] is True


async def test_discovery_currency_change_moves_the_link_until_the_currency_matches_again(db, scenario: FakeBridgeScenario):
    """Travel Wallet moving from USD to EUR refreshes its balance in euros and stops Travel's sync, and moving back resumes it"""
    await scenario.add_harbour_accounts()
    yen = {"id": "ACT-yen", "name": "Tokyo Wallet", "conn_id": "CON-harbour", "currency": "JPY", "balance": "15000"}
    await scenario.change("POST", "/accounts", yen)
    connection = await _claimed_connection(db, scenario)
    db.add(Currency(id="JPY", name="Japanese Yen", symbol="¥", minor_unit_exponent=0))
    travel = await _linked(db, connection, "Travel", "ACT-savings")
    await _discover(db, connection)
    await scenario.change("PATCH", "/accounts/ACT-savings", {"currency": "EUR", "balance": "7400.50"})
    await scenario.change("PATCH", "/accounts/ACT-yen", {"balance": "12500"})

    await _discover(db, connection, _NOW + timedelta(days=1))
    moved = await _link_state(travel)
    refreshed = (
        await db.execute(
            select(BankExternalAccount.external_id, BankExternalAccount.currency, BankExternalAccount.balance).where(
                BankExternalAccount.external_id.in_(("ACT-savings", "ACT-yen"))
            )
        )
    ).all()
    await scenario.change("PATCH", "/accounts/ACT-savings", {"currency": "USD"})
    await _discover(db, connection, _NOW + timedelta(days=2))

    assert moved == BankLinkState.CHOOSE_ACCOUNT
    # The yen has no minor unit, so 12,500 yen is stored as 12500
    assert sorted(tuple(row) for row in refreshed) == [("ACT-savings", "EUR", 740050), ("ACT-yen", "JPY", 12500)]
    assert await _link_state(travel) == BankLinkState.ACTIVE


async def test_discovery_without_a_usable_answer_changes_no_bank_account_or_link(db, scenario: FakeBridgeScenario):
    """An error page from the Bridge records the failure and leaves Everyday linked and syncing"""
    await scenario.add_harbour_accounts()
    connection = await _claimed_connection(db, scenario)
    everyday = await _linked(db, connection, "Everyday", "ACT-chequing")
    await _discover(db, connection)
    await scenario.change("PUT", "/fault", {"kind": "html_error"})

    assert await _discover(db, connection, _NOW + timedelta(days=1)) is False

    assert connection.discovery_failed_at == _NOW + timedelta(days=1)
    assert connection.discovered_at == _NOW
    assert await _link_state(everyday) == BankLinkState.ACTIVE
    assert await _listed(connection) == {"ACT-chequing": True, "ACT-savings": True, "ACT-visa": True}


@pytest.mark.parametrize(("fault", "stored"), [("rate_limited", False), ("quota_warning", True)], ids=["429", "quota-warning-with-data"])
async def test_discovery_told_the_quota_is_spent_marks_the_budget_spent(db, scenario: FakeBridgeScenario, fault, stored):
    """A 429 stores nothing and a quota warning keeps the data, and either way nothing more is sent for 24 hours"""
    await scenario.add_harbour_accounts()
    connection = await _claimed_connection(db, scenario)
    await scenario.change("PUT", "/fault", {"kind": fault})

    assert await _discover(db, connection) is stored

    assert await read_request_budget(db, connection, now=_NOW) == RequestBudget(
        limit=20, used=20, available_again_at=_NOW + timedelta(hours=24)
    )
    assert bool(await _listed(connection)) is stored


async def test_discovery_bank_account_listed_twice_is_stored_once(db):
    """A provider repeating a bank account in one answer doesn't fail the discovery"""
    connection = await _stored_connection(db)
    listed = ExternalAccount(
        external_id="ACT-chequing",
        name="Everyday Chequing",
        institution_key="ORG-harbour",
        institution_name="Harbour Bank",
        login_key="CON-harbour",
        currency="USD",
        currency_raw="USD",
        balance=251075,
        available_balance=None,
        balance_at=_BALANCE_AT,
    )

    await apply_discovery(db, connection, FetchResult(accounts=(listed, listed)), now=_NOW)

    assert await db.scalar(select(func.count()).select_from(BankExternalAccount)) == 1
