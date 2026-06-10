from datetime import UTC, datetime

from tests.routes.support import _create_account, _create_user, _get_auth_header


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


async def _login_default_user(client):
    """Log in as the default test user and return auth headers."""
    resp = await client.post("/auth/login", json={
        "email": "test@example.com",
        "password": "securepassword123",
    })
    return _get_auth_header(resp)


def _parse_iso_timestamp(value: str) -> datetime:
    """Parse an API timestamp in either offset or Zulu form."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _assert_utc_timestamp(value: str) -> None:
    """Assert an API timestamp is explicitly UTC-aware."""
    assert _parse_iso_timestamp(value).utcoffset() == UTC.utcoffset(None)


async def test_cache_status_initially_null(client):
    """A fresh user has no visible app-data cache timestamp."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/me/cache-status", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == {
        "changed_at": None,
        "personal": {
            "changed_at": None,
            "last_change_from_current_session": False,
        },
        "groups": {},
    }


async def test_personal_write_updates_cache_status(client):
    """Creating a personal account records a visible cache timestamp."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    status_resp = await client.get("/me/cache-status", headers=headers)

    assert account_resp.status_code == 201
    assert status_resp.status_code == 200
    payload = status_resp.json()
    changed_at = payload["changed_at"]
    assert changed_at is not None
    _assert_utc_timestamp(changed_at)
    assert payload["personal"] == {
        "changed_at": changed_at,
        "last_change_from_current_session": True,
    }
    assert payload["groups"] == {}


async def test_other_session_personal_write_marks_status_external(client):
    """A personal change from another session is visible as external."""
    signup_resp = await _create_user(client)
    first_session_headers = _get_auth_header(signup_resp)
    second_session_headers = await _login_default_user(client)

    account_resp = await _create_account(client, second_session_headers)
    status_resp = await client.get("/me/cache-status", headers=first_session_headers)

    assert account_resp.status_code == 201
    assert status_resp.status_code == 200
    payload = status_resp.json()
    changed_at = payload["changed_at"]
    assert changed_at is not None
    _assert_utc_timestamp(changed_at)
    assert payload["personal"] == {
        "changed_at": changed_at,
        "last_change_from_current_session": False,
    }


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
    assert before_resp.json() == {
        "changed_at": None,
        "personal": {
            "changed_at": None,
            "last_change_from_current_session": False,
        },
        "groups": {},
    }
    assert group_resp.status_code == 201
    assert add_member_resp.status_code == 201
    payload = after_resp.json()
    changed_at = payload["changed_at"]
    assert changed_at is not None
    _assert_utc_timestamp(changed_at)
    group_id = group_resp.json()["id"]
    assert payload["personal"]["changed_at"] is None
    assert payload["personal"]["last_change_from_current_session"] is False
    assert payload["groups"][group_id]["changed_at"] is not None
    assert payload["groups"][group_id]["last_change_from_current_session"] is False
