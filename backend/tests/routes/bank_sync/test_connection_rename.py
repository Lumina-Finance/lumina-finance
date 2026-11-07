"""Renaming a bank connection

A nickname is the user's own label for a connection, so it changes in any state, a blank or null one
brings back the provider's name, and another user's connection must never change
"""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.models.bank_connection import BankConnection
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _build_user, _commit_bank_connection, _sign_up


async def _stored_nickname(connection_id: uuid.UUID) -> str | None:
    """Return a connection's stored nickname"""
    async with TestSession() as session:
        return await session.scalar(select(BankConnection.nickname).where(BankConnection.id == connection_id))


@pytest.mark.parametrize("cleared_with", ["  ", None], ids=["blank", "null"])
async def test_rename_sets_and_clears_the_nickname_in_any_state(client, cleared_with):
    """A rejected connection is renamed Joint, and a blank or null nickname brings back Fake Bank"""
    headers, user_id = await _sign_up(client)
    connection = await _commit_bank_connection(user_id, created_at=datetime.now(UTC), rejected=True)

    named = await client.patch(f"/bank-sync/connections/{connection.id}", json={"nickname": "  Joint "}, headers=headers)
    cleared = await client.patch(f"/bank-sync/connections/{connection.id}", json={"nickname": cleared_with}, headers=headers)

    assert named.status_code == 200, named.text
    assert (named.json()["nickname"], named.json()["status"]) == ("Joint", "credential_rejected")
    assert cleared.status_code == 200, cleared.text
    assert (cleared.json()["nickname"], cleared.json()["provider_name"]) == (None, "Fake Bank")
    assert await _stored_nickname(connection.id) is None


async def test_rename_without_a_nickname_is_refused(client):
    """An empty body leaves Joint in place rather than clearing it"""
    headers, user_id = await _sign_up(client)
    connection = await _commit_bank_connection(user_id, created_at=datetime.now(UTC), nickname="Joint")

    refused = await client.patch(f"/bank-sync/connections/{connection.id}", json={}, headers=headers)

    assert refused.status_code == 422, refused.text
    assert [(error["loc"], error["type"]) for error in refused.json()["detail"]] == [(["body", "nickname"], "missing")]
    assert await _stored_nickname(connection.id) == "Joint"


async def test_rename_updates_cache_status(client):
    """Renaming a connection marks the user's data changed for cache validation"""
    headers, user_id = await _sign_up(client)
    connection = await _commit_bank_connection(user_id, created_at=datetime.now(UTC))

    before = await client.get("/me/cache-status", headers=headers)
    renamed = await client.patch(f"/bank-sync/connections/{connection.id}", json={"nickname": "Joint"}, headers=headers)
    after = await client.get("/me/cache-status", headers=headers)

    assert before.status_code == 200, before.text
    assert renamed.status_code == 200, renamed.text
    assert after.status_code == 200, after.text
    after_changed_at = after.json()["personal"]["changed_at"]
    assert after_changed_at is not None
    assert after_changed_at != before.json()["personal"]["changed_at"]
    assert after.json()["personal"]["last_change_from_current_session"] is True


async def test_rename_with_a_nickname_over_64_characters_is_refused(client):
    """The nickname is kept as it was"""
    headers, user_id = await _sign_up(client)
    connection = await _commit_bank_connection(user_id, created_at=datetime.now(UTC), nickname="Joint")

    refused = await client.patch(f"/bank-sync/connections/{connection.id}", json={"nickname": "J" * 65}, headers=headers)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Keep the nickname to 64 characters or fewer"
    assert await _stored_nickname(connection.id) == "Joint"


async def test_rename_of_another_users_connection_is_not_found(client):
    """Naming another user's connection changes nothing and doesn't reveal it exists"""
    headers, _ = await _sign_up(client)
    async with TestSession() as session:
        other = _build_user("other@example.com")
        session.add(other)
        await session.commit()
    theirs = await _commit_bank_connection(other.id, created_at=datetime.now(UTC), nickname="Theirs")

    refused = await client.patch(f"/bank-sync/connections/{theirs.id}", json={"nickname": "Mine"}, headers=headers)
    missing = await client.patch(f"/bank-sync/connections/{uuid.uuid4()}", json={"nickname": "Mine"}, headers=headers)

    assert refused.status_code == 404, refused.text
    assert refused.json()["detail"] == "Bank connection not found"
    assert missing.status_code == 404, missing.text
    assert missing.json()["detail"] == "Bank connection not found"
    assert await _stored_nickname(theirs.id) == "Theirs"
