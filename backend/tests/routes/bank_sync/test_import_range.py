"""Reading where a bank import into an account may start

The start step shows this range before anything is linked, so it must answer only for the user's own
personal account, through a provider the deployment enables, and only for a user who may link
"""

import uuid

import pytest

from app.services.bank_sync import availability
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _build_account, _build_user, _new_account, _sign_up
from tests.services.bank_sync.fake_provider import FAKE_PROVIDER, remove_provider, use_adapter


async def _read_range(client, headers, account_id, provider: str = FAKE_PROVIDER):
    """Read an account's import range through the route"""
    return await client.get(f"/accounts/{account_id}/bank-link/import-range", params={"provider": provider}, headers=headers)


async def test_import_range_of_a_group_account_is_refused_to_its_admin(client):
    """A group account isn't the user's own, so even the group's admin can't link it"""
    headers, _ = await _sign_up(client)
    group = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    assert group.status_code == 201, group.text
    account_id = await _new_account(client, headers, "Joint", group_id=group.json()["id"])

    refused = await _read_range(client, headers, account_id)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == "Accounts shared with a group can't be linked to a bank yet"


async def test_import_range_of_another_users_account_is_not_found(client):
    """Another user's account reads the same as one that doesn't exist"""
    headers, _ = await _sign_up(client)
    async with TestSession() as session:
        other = _build_user("other@example.com")
        session.add(other)
        await session.flush()
        theirs = _build_account(other.id, name="Theirs")
        session.add(theirs)
        await session.commit()

    refused = await _read_range(client, headers, theirs.id)
    missing = await _read_range(client, headers, uuid.uuid4())

    assert refused.status_code == 404, refused.text
    assert refused.json()["detail"] == "Account not found"
    assert missing.status_code == 404, missing.text
    assert missing.json()["detail"] == "Account not found"


@pytest.mark.parametrize("gone", ["turned-off", "removed"])
async def test_import_range_through_a_provider_turned_off_or_removed_is_refused(client, fake_provider, monkeypatch, gone):
    """A deployment that turned the provider off, or deleted its folder, has no history limit to offer"""
    if gone == "turned-off":
        use_adapter(monkeypatch, fake_provider, enabled=False)
    else:
        remove_provider(monkeypatch, FAKE_PROVIDER)
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")

    refused = await _read_range(client, headers, account_id)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Choose a bank provider this server supports"


async def test_import_range_for_a_user_who_may_not_link_bank_accounts_is_refused(client, monkeypatch):
    """The bank-linking check is enforced on the start step's range, not only in the interface"""
    monkeypatch.setattr(availability, "may_link_bank_accounts", lambda _user_id: False)
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")

    refused = await _read_range(client, headers, account_id)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == "Bank sync isn't available for your account"
