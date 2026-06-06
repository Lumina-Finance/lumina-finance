from datetime import datetime

from tests.routes.conftest import _create_account, _create_user, _get_auth_header


async def _create_second_user(client):
    """Sign up a second user and return auth headers plus user ID."""
    resp = await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "securepassword123",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    return _get_auth_header(resp), resp.json()["user"]["id"]


async def _create_group(client, headers):
    """Create a group for cache-status tests."""
    return await client.post("/groups", json={"name": "Smith Family"}, headers=headers)


def _parse_iso_timestamp(value: str) -> datetime:
    """Parse an API timestamp in either offset or Zulu form."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


async def test_cache_status_initially_null(client):
    """A fresh user has no visible app-data cache timestamp."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/me/cache-status", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == {"changed_at": None}


async def test_personal_write_updates_cache_status(client):
    """Creating a personal account records a visible cache timestamp."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    status_resp = await client.get("/me/cache-status", headers=headers)

    assert account_resp.status_code == 201
    assert status_resp.status_code == 200
    changed_at = status_resp.json()["changed_at"]
    assert changed_at is not None
    assert _parse_iso_timestamp(changed_at)


async def test_group_write_updates_member_cache_status(client):
    """Adding a user to a changed group exposes the group cache timestamp."""
    signup_resp = await _create_user(client)
    owner_headers = _get_auth_header(signup_resp)
    member_headers, member_id = await _create_second_user(client)

    before_resp = await client.get("/me/cache-status", headers=member_headers)
    group_resp = await _create_group(client, owner_headers)
    add_member_resp = await client.post(
        f"/groups/{group_resp.json()['id']}/members",
        json={"user_id": member_id},
        headers=owner_headers,
    )
    after_resp = await client.get("/me/cache-status", headers=member_headers)

    assert before_resp.status_code == 200
    assert before_resp.json() == {"changed_at": None}
    assert group_resp.status_code == 201
    assert add_member_resp.status_code == 201
    changed_at = after_resp.json()["changed_at"]
    assert changed_at is not None
    assert _parse_iso_timestamp(changed_at)
