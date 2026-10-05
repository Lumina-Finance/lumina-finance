"""Linking a Lumina account to a bank account on one of the user's connections

A link decides which ledger a bank account's transactions land in, so every rule the link flow's
list shows is checked again here: one bank account feeds one ledger, an account follows one bank
account, the currencies match, and the import never starts outside the account's import range
"""

import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select, update

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection, BankExternalAccount, BankLinkState, BankProvider
from app.models.bank_sync_job import BankSyncJob
from app.services.bank_sync import availability, links
from app.services.bank_sync.import_range import ImportRange, calculate_import_range
from app.utils.dates import format_day
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    BANK_ACCOUNT_ID,
    _build_account,
    _build_bank_link,
    _build_external_account,
    _build_user,
    _commit_listed_connection,
    _link,
    _new_account,
    _sign_up,
)

_USER_TZ = ZoneInfo("America/Toronto")
_ACCOUNT_ALREADY_LINKED = "This account is already linked to a bank"
_BANK_ACCOUNT_ALREADY_LINKED = "That bank account is already linked to another account"


async def _linkable(client, name: str = "Everyday") -> tuple[dict, uuid.UUID, str, BankConnection]:
    """Sign up with an empty CAD account and a connection listing one CAD bank account at Harbour Bank"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, name)
    connection = await _commit_listed_connection(user_id, discovered_at=datetime.now(UTC))
    return headers, user_id, account_id, connection


async def _stored_links() -> list[tuple]:
    """Return every stored link's account, connection, bank account, state, kind, start and checkpoint, oldest first"""
    async with TestSession() as session:
        rows = await session.execute(
            select(
                BankAccountLink.account_id,
                BankAccountLink.connection_id,
                BankAccountLink.external_account_id,
                BankAccountLink.state,
                BankAccountLink.import_kind,
                BankAccountLink.import_start,
                BankAccountLink.checkpoint,
            ).order_by(BankAccountLink.linked_at)
        )
        return [tuple(row) for row in rows]


async def _queued_jobs() -> list[tuple]:
    """Return every stored job's connection, kind, discovery flag and status"""
    async with TestSession() as session:
        rows = await session.execute(select(BankSyncJob.connection_id, BankSyncJob.kind, BankSyncJob.discover, BankSyncJob.status))
        return [tuple(row) for row in rows]


def _today() -> date:
    """Return today in the zone _sign_up stores"""
    return datetime.now(_USER_TZ).date()


async def test_link_creates_the_link_and_queues_its_first_import(client):
    """Linking empty Everyday from 30 days ago starts an initial import there, queued at once"""
    headers, _, account_id, connection = await _linkable(client)
    start = _today() - timedelta(days=30)

    before = await client.get("/me/cache-status", headers=headers)
    linked = await _link(client, headers, account_id, connection.id, start_date=start)
    after = await client.get("/me/cache-status", headers=headers)

    assert linked.status_code == 201, linked.text
    body = linked.json()
    assert datetime.fromisoformat(body.pop("linked_at")) <= datetime.now(UTC)
    assert body == {
        "account_id": account_id,
        "connection_id": str(connection.id),
        "provider": "simplefin",
        "provider_name": "SimpleFIN",
        "external_account_id": BANK_ACCOUNT_ID,
        "external_account_name": "Everyday Chequing",
        "institution_name": "Harbour Bank",
        "import_start": start.isoformat(),
    }
    assert await _stored_links() == [
        (uuid.UUID(account_id), connection.id, BANK_ACCOUNT_ID, "active", "initial", start, start - timedelta(days=1))
    ]
    assert await _queued_jobs() == [(connection.id, "initial", False, "queued")]
    assert after.status_code == 200, after.text
    assert after.json()["personal"]["changed_at"] != before.json()["personal"]["changed_at"]
    assert after.json()["personal"]["last_change_from_current_session"] is True


async def test_link_of_an_account_unlinked_before_is_a_relink(client):
    """An account that was linked and then unlinked links the same way, with a relink import, and keeps its earlier link"""
    headers, _, account_id, connection = await _linkable(client)
    async with TestSession() as session:
        account = await session.get_one(Account, uuid.UUID(account_id))
        session.add(_build_bank_link(account, None, state=BankLinkState.UNLINKED, unlinked_at=datetime.now(UTC)))
        await session.commit()
    start = _today() - timedelta(days=10)

    linked = await _link(client, headers, account_id, connection.id, start_date=start)

    assert linked.status_code == 201, linked.text
    assert [(state, kind) for *_, state, kind, _, _ in await _stored_links()] == [("unlinked", "initial"), ("active", "relink")]
    assert await _queued_jobs() == [(connection.id, "initial", False, "queued")]


async def test_link_through_a_provider_withdrawn_from_new_connections_still_links(client, monkeypatch):
    """Withdrawing SimpleFIN's offer stops only new connections, so an existing one links further accounts"""
    monkeypatch.setattr(availability, "OFFERED_PROVIDERS", frozenset())
    headers, _, account_id, connection = await _linkable(client)

    linked = await _link(client, headers, account_id, connection.id)

    assert linked.status_code == 201, linked.text


def _archive_account(account_id, _connection):
    """Return a statement archiving the account"""
    return update(Account).where(Account.id == uuid.UUID(account_id)).values(is_archived=True)


def _reject_connection(_account_id, connection):
    """Return a statement recording that the provider rejected the connection"""
    return update(BankConnection).where(BankConnection.id == connection.id).values(credential_rejected_at=datetime.now(UTC))


def _unlist_bank_account(_account_id, connection):
    """Return a statement recording that a discovery no longer found the bank account"""
    return update(BankExternalAccount).where(BankExternalAccount.connection_id == connection.id).values(listed=False)


def _change_currency(currency):
    """Return a change giving the bank account another currency"""

    def change(_account_id, connection):
        """Return the statement"""
        return update(BankExternalAccount).where(BankExternalAccount.connection_id == connection.id).values(currency=currency)

    return change


@pytest.mark.parametrize(
    ("change", "status_code", "detail"),
    [
        (_archive_account, 422, "Archived accounts can't be linked to a bank"),
        (_reject_connection, 409, "SimpleFIN rejected this connection. Reconnect it in Settings with a new setup token"),
        (_unlist_bank_account, 404, "SimpleFIN no longer returns that bank account"),
        (_change_currency("USD"), 422, "That bank account is in USD, but Everyday is in CAD"),
        (
            _change_currency("https://bank.example/points"),
            422,
            "That bank account uses a currency of its own, which Lumina Finance can't track",
        ),
    ],
    ids=["archived-account", "rejected-connection", "bank-account-no-longer-listed", "different-currency", "custom-currency"],
)
async def test_link_refusals_save_nothing(client, change, status_code, detail):
    """Each rule the link flow's list shows is checked again, since the list can be out of date"""
    headers, _, account_id, connection = await _linkable(client)
    async with TestSession() as session:
        await session.execute(change(account_id, connection))
        await session.commit()

    refused = await _link(client, headers, account_id, connection.id)

    assert refused.status_code == status_code, refused.text
    assert refused.json()["detail"] == detail
    assert await _stored_links() == []
    assert await _queued_jobs() == []


async def test_link_by_a_user_who_may_not_link_bank_accounts_is_refused(client, monkeypatch):
    """The bank-linking check is enforced on the link, not only in the interface"""
    monkeypatch.setattr(availability, "may_link_bank_accounts", lambda _user_id: False)
    headers, _, account_id, connection = await _linkable(client)

    refused = await _link(client, headers, account_id, connection.id)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == "Bank sync isn't available for your account"
    assert await _stored_links() == []


async def test_link_through_a_disabled_provider_is_refused(client, monkeypatch):
    """A connection whose provider the deployment disabled links nothing"""
    monkeypatch.delitem(availability.ENABLED_ADAPTERS, BankProvider.SIMPLEFIN)
    headers, _, account_id, connection = await _linkable(client)

    refused = await _link(client, headers, account_id, connection.id)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Choose a bank provider this server supports"
    assert await _stored_links() == []


async def test_link_of_a_group_account_is_refused_to_its_admin(client):
    """A group account isn't the user's own, so even the group's admin can't link it"""
    headers, user_id = await _sign_up(client)
    group = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    assert group.status_code == 201, group.text
    account_id = await _new_account(client, headers, "Joint", group_id=group.json()["id"])
    connection = await _commit_listed_connection(user_id)

    refused = await _link(client, headers, account_id, connection.id)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == "Accounts shared with a group can't be linked to a bank yet"
    assert await _stored_links() == []


async def test_link_of_an_account_already_linked_is_refused(client):
    """An account follows one bank account at a time, so linking it to a second is refused"""
    headers, user_id, account_id, _ = await _linkable(client)
    connection = await _commit_listed_connection(user_id, BANK_ACCOUNT_ID, "ACT-2")
    assert (await _link(client, headers, account_id, connection.id)).status_code == 201

    refused = await _link(client, headers, account_id, connection.id, "ACT-2")

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == _ACCOUNT_ALREADY_LINKED
    assert [external_id for _, _, external_id, *_ in await _stored_links()] == [BANK_ACCOUNT_ID]


async def test_link_of_a_bank_account_linked_through_another_connection_is_refused(client):
    """Savings takes the bank account through one connection, so Everyday can't take it through a second over the same Bridge account"""
    headers, user_id, account_id, first = await _linkable(client)
    savings_id = await _new_account(client, headers, "Savings")
    second = await _commit_listed_connection(user_id)
    assert (await _link(client, headers, savings_id, first.id)).status_code == 201

    refused = await _link(client, headers, account_id, second.id)

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == _BANK_ACCOUNT_ALREADY_LINKED
    assert [account for account, *_ in await _stored_links()] == [uuid.UUID(savings_id)]


async def test_link_that_races_another_to_the_same_bank_account_is_refused(client, monkeypatch):
    """A link that missed one committed just before it is still refused, by the one-ledger-per-bank-account rule"""
    headers, user_id, account_id, first = await _linkable(client)
    savings_id = await _new_account(client, headers, "Savings")
    second = await _commit_listed_connection(user_id)
    assert (await _link(client, headers, savings_id, first.id)).status_code == 201

    # As if Savings' link committed after this request read the user's links
    async def read_none(_db, _user_id):
        return {}

    monkeypatch.setattr(links, "read_linked_bank_accounts", read_none)
    refused = await _link(client, headers, account_id, second.id)

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == _BANK_ACCOUNT_ALREADY_LINKED
    assert [account for account, *_ in await _stored_links()] == [uuid.UUID(savings_id)]
    assert await _queued_jobs() == [(first.id, "initial", False, "queued")]


async def test_link_to_an_institution_over_the_limit_is_refused(client, monkeypatch):
    """With a limit of one institution and Harbour Bank linked, a bank account at Lakeshore would go over it"""
    monkeypatch.setattr(availability, "get_institution_limit", lambda _user_id, _provider: 1)
    headers, _, account_id, connection = await _linkable(client)
    savings_id = await _new_account(client, headers, "Savings")
    async with TestSession() as session:
        lakeshore = _build_external_account(connection, "ACT-LAKE")
        lakeshore.institution_key = "lakeshore"
        lakeshore.institution_name = "Lakeshore Credit Union"
        session.add(lakeshore)
        await session.commit()
    assert (await _link(client, headers, savings_id, connection.id)).status_code == 201

    refused = await _link(client, headers, account_id, connection.id, "ACT-LAKE")

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == "Would go over your limit of 1 institution for SimpleFIN"
    assert [account for account, *_ in await _stored_links()] == [uuid.UUID(savings_id)]


async def test_link_starting_before_the_earliest_allowed_start_is_refused_with_the_range(client):
    """A start a month before SimpleFIN's 12-month limit is refused, naming the days that are allowed"""
    headers, _, account_id, connection = await _linkable(client)
    before = _today()

    refused = await _link(client, headers, account_id, connection.id, start_date=_empty_range(before).earliest_allowed - timedelta(days=31))
    after = _today()

    assert refused.status_code == 422, refused.text
    # Both days are allowed in case the request crossed midnight in Toronto
    assert refused.json()["detail"] in {
        f"Choose a start date from {format_day(allowed.earliest_allowed)} to {format_day(allowed.latest_allowed)}"
        for allowed in map(_empty_range, {before, after})
    }
    assert await _stored_links() == []


def _empty_range(today: date) -> ImportRange:
    """Return SimpleFIN's import range for an empty account on a day"""
    return calculate_import_range(today=today, latest_ledger_date=None, history_months=12, was_linked_before=False)


async def test_link_of_another_users_account_connection_or_bank_account_is_not_found(client):
    """Nothing of another user's is linked or revealed"""
    headers, _, account_id, connection = await _linkable(client)
    async with TestSession() as session:
        other = _build_user("other@example.com")
        session.add(other)
        await session.commit()
    theirs = await _commit_listed_connection(other.id, "ACT-THEIRS")
    async with TestSession() as session:
        their_account = _build_account(other.id, name="Theirs")
        session.add(their_account)
        await session.commit()

    their_account_refused = await _link(client, headers, their_account.id, connection.id)
    their_connection_refused = await _link(client, headers, account_id, theirs.id, "ACT-THEIRS")
    their_bank_account_refused = await _link(client, headers, account_id, connection.id, "ACT-THEIRS")

    assert their_account_refused.status_code == 404, their_account_refused.text
    assert their_account_refused.json()["detail"] == "Account not found"
    assert their_connection_refused.status_code == 404, their_connection_refused.text
    assert their_connection_refused.json()["detail"] == "Bank connection not found"
    assert their_bank_account_refused.status_code == 404, their_bank_account_refused.text
    assert their_bank_account_refused.json()["detail"] == "SimpleFIN no longer returns that bank account"
    assert await _stored_links() == []
