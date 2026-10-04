"""Listing and renaming bank connections

Settings shows each connection from this list, so its status, bank accounts, eligible accounts and
request budget have to read true, and another user's connection must never show or change
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.models.account import Account
from app.models.bank_connection import BankConnection, BankProviderRequest
from app.models.bank_sync_job import BankSyncJob, BankSyncJobKind
from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.support import _create_account, _create_user, _get_auth_header
from tests.routes.support.bank_sync_helpers import (
    _build_bank_connection,
    _build_bank_link,
    _build_external_account,
    _build_user,
)

_BUDGET_FREE = {"limit": 20, "used": 0, "available_again_at": None}


async def _sign_up(client) -> tuple[dict, uuid.UUID]:
    """Sign up the default user, with USD available for accounts, and return their auth headers and id"""
    signup = await _create_user(client)
    assert signup.status_code == 201, signup.text
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()
    return _get_auth_header(signup), uuid.UUID(signup.json()["user"]["id"])


async def _connection_for(owner_id: uuid.UUID, *, created_at: datetime, nickname: str | None = None, rejected: bool = False) -> BankConnection:
    """Commit a SimpleFIN connection for the owner"""
    async with TestSession() as session:
        connection = _build_bank_connection(owner_id)
        connection.created_at = created_at
        connection.nickname = nickname
        if rejected:
            connection.credential_rejected_at = created_at + timedelta(days=1)
        session.add(connection)
        await session.commit()
    return connection


async def test_connections_list_describes_each_connection_and_its_bank_accounts(client):
    """Bank accounts say which account they feed or could feed, a rejected connection keeps its list, and the budget shows"""
    headers, user_id = await _sign_up(client)
    everyday = await _create_account(client, headers, name="Everyday", currency="USD")
    savings = await _create_account(client, headers, name="Savings", currency="USD")
    assert everyday.status_code == 201, everyday.text
    assert savings.status_code == 201, savings.text
    everyday_id, savings_id = uuid.UUID(everyday.json()["id"]), uuid.UUID(savings.json()["id"])

    now = datetime.now(UTC)
    harbour = await _connection_for(user_id, created_at=now - timedelta(days=2), nickname="Joint")
    rejected = await _connection_for(user_id, created_at=now - timedelta(days=1), rejected=True)
    async with TestSession() as session:
        chequing = _build_external_account(harbour, "ACT-chequing")
        chequing.currency = "USD"
        visa = _build_external_account(harbour, "ACT-visa")
        visa.currency = "USD"
        visa.name = "Rewards Visa"
        miles = _build_external_account(harbour, "ACT-miles")
        miles.currency = "https://www.simplefin.org/currencies/miles"
        miles.name = "Flight Miles"
        gone = _build_external_account(harbour, "ACT-gone")
        gone.listed = False
        kept = _build_external_account(rejected, "ACT-kept")
        kept.currency = "USD"
        kept.name = "Kept Chequing"
        session.add_all([chequing, visa, miles, gone, kept])
        await session.flush()
        session.add(_build_bank_link(await session.get(Account, everyday_id), harbour, "ACT-chequing"))
        session.add_all(
            BankProviderRequest(owner_id=user_id, connection_id=harbour.id, purpose="sync", requested_at=now - timedelta(hours=hours))
            for hours in range(1, 21)
        )
        await session.commit()

    response = await client.get("/bank-sync/connections", headers=headers)

    assert response.status_code == 200, response.text
    body = response.json()
    assert [connection["id"] for connection in body] == [str(harbour.id), str(rejected.id)]
    first, second = body
    assert (first["nickname"], first["status"], first["server_label"], first["discovery_pending"]) == (
        "Joint",
        "active",
        "bridge.example",
        False,
    )
    # The oldest of the 20 requests was 20 hours ago, so one frees in 4 hours
    assert first["request_budget"]["used"] == 20
    assert datetime.fromisoformat(first["request_budget"]["available_again_at"]) == now + timedelta(hours=4)
    assert [
        (account["external_id"], account["custom_currency"], account["linked_account_id"], account["eligible_account_ids"])
        for account in first["accounts"]
    ] == [
        ("ACT-chequing", False, str(everyday_id), []),
        ("ACT-miles", True, None, []),
        ("ACT-visa", False, None, [str(savings_id)]),
    ]
    assert (second["nickname"], second["status"], second["request_budget"]) == (None, "credential_rejected", _BUDGET_FREE)
    assert [(account["external_id"], account["eligible_account_ids"]) for account in second["accounts"]] == [("ACT-kept", [str(savings_id)])]


async def test_connections_list_shows_a_queued_discovery_as_pending(client):
    """A job asked to discover the bank accounts marks its connection as waiting for them"""
    headers, user_id = await _sign_up(client)
    connection = await _connection_for(user_id, created_at=datetime.now(UTC))
    async with TestSession() as session:
        session.add(BankSyncJob(owner_id=user_id, connection_id=connection.id, kind=BankSyncJobKind.MANUAL, discover=True))
        await session.commit()

    response = await client.get("/bank-sync/connections", headers=headers)

    assert response.status_code == 200, response.text
    assert [(item["discovery_pending"], item["accounts"]) for item in response.json()] == [(True, [])]


async def test_connections_list_leaves_out_another_users_connections(client):
    """Only the signed-in user's own connections are listed"""
    headers, _ = await _sign_up(client)
    async with TestSession() as session:
        other = _build_user("other@example.com")
        session.add(other)
        await session.commit()
    await _connection_for(other.id, created_at=datetime.now(UTC))

    response = await client.get("/bank-sync/connections", headers=headers)

    assert response.status_code == 200, response.text
    assert response.json() == []


async def test_rename_sets_and_clears_the_nickname_in_any_state(client):
    """A rejected connection is renamed Joint, and a blank nickname brings back SimpleFIN"""
    headers, user_id = await _sign_up(client)
    connection = await _connection_for(user_id, created_at=datetime.now(UTC), rejected=True)

    named = await client.patch(f"/bank-sync/connections/{connection.id}", json={"nickname": "  Joint "}, headers=headers)
    cleared = await client.patch(f"/bank-sync/connections/{connection.id}", json={"nickname": "  "}, headers=headers)

    assert named.status_code == 200, named.text
    assert (named.json()["nickname"], named.json()["status"]) == ("Joint", "credential_rejected")
    assert cleared.status_code == 200, cleared.text
    assert (cleared.json()["nickname"], cleared.json()["provider_name"]) == (None, "SimpleFIN")
    async with TestSession() as session:
        assert await session.scalar(select(BankConnection.nickname).where(BankConnection.id == connection.id)) is None


async def test_rename_with_a_nickname_over_64_characters_is_refused(client):
    """The nickname is kept as it was"""
    headers, user_id = await _sign_up(client)
    connection = await _connection_for(user_id, created_at=datetime.now(UTC), nickname="Joint")

    refused = await client.patch(f"/bank-sync/connections/{connection.id}", json={"nickname": "J" * 65}, headers=headers)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Keep the nickname to 64 characters or fewer"
    async with TestSession() as session:
        assert await session.scalar(select(BankConnection.nickname).where(BankConnection.id == connection.id)) == "Joint"


async def test_rename_of_another_users_connection_is_not_found(client):
    """Naming another user's connection changes nothing and doesn't reveal it exists"""
    headers, _ = await _sign_up(client)
    async with TestSession() as session:
        other = _build_user("other@example.com")
        session.add(other)
        await session.commit()
    theirs = await _connection_for(other.id, created_at=datetime.now(UTC), nickname="Theirs")

    refused = await client.patch(f"/bank-sync/connections/{theirs.id}", json={"nickname": "Mine"}, headers=headers)
    missing = await client.patch(f"/bank-sync/connections/{uuid.uuid4()}", json={"nickname": "Mine"}, headers=headers)

    assert refused.status_code == 404, refused.text
    assert refused.json()["detail"] == "Bank connection not found"
    assert missing.status_code == 404, missing.text
    assert missing.json()["detail"] == "Bank connection not found"
    async with TestSession() as session:
        assert await session.scalar(select(BankConnection.nickname).where(BankConnection.id == theirs.id)) == "Theirs"
