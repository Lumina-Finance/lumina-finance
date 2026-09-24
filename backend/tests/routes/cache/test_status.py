import importlib
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from tests.routes.support import _create_account, _create_user, _get_auth_header


async def _create_second_user(client):
    """Sign up a second user and return auth headers plus user ID."""
    resp = await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "SecurePassword123!",
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
        "password": "SecurePassword123!",
    })
    return _get_auth_header(resp)


def _parse_iso_timestamp(value: str) -> datetime:
    """Parse an API timestamp in either offset or Zulu form."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _assert_utc_timestamp(value: str) -> None:
    """Assert an API timestamp is explicitly UTC-aware."""
    assert _parse_iso_timestamp(value).utcoffset() == UTC.utcoffset(None)


def _assert_date_boundary(payload: dict, zone_name: str = "America/Toronto") -> None:
    """The advertised rollover is midnight after the viewer's current day."""
    zone = ZoneInfo(zone_name)
    next_midnight = _parse_iso_timestamp(payload["next_calculation_boundary_at"])
    _assert_utc_timestamp(payload["next_calculation_boundary_at"])
    assert next_midnight.astimezone(zone).date().isoformat() > payload["current_date"]
    assert next_midnight.astimezone(zone).time().isoformat() == "00:00:00"
    assert len(payload["calculation_date_token"]) == 64


async def test_cache_status_initially_null(client):
    """A fresh user has no visible app-data cache timestamp."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/me/cache-status", headers=headers)

    assert resp.status_code == 200
    _assert_date_boundary(resp.json())
    assert resp.json() == {
        "changed_at": None,
        "current_date": resp.json()["current_date"],
        "calculation_date_token": resp.json()["calculation_date_token"],
        "next_calculation_boundary_at": resp.json()["next_calculation_boundary_at"],
        "personal": {
            "changed_at": None,
            "last_change_from_current_session": False,
        },
        "groups": {},
    }


async def test_cache_status_uses_profile_date_and_dst_midnight(client, monkeypatch):
    """The same instant yields owner-local dates and a DST-aware next refresh time."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    instant = datetime(2026, 3, 8, 4, 30, tzinfo=UTC)

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return instant.astimezone(tz) if tz else instant

    user_routes = importlib.import_module("app.routes.users.router")
    monkeypatch.setattr(user_routes, "datetime", FixedDateTime)

    toronto = (await client.get("/me/cache-status", headers=headers)).json()
    assert toronto["current_date"] == "2026-03-07"
    assert _parse_iso_timestamp(toronto["next_calculation_boundary_at"]) == datetime(2026, 3, 8, 5, tzinfo=UTC)

    update = await client.patch("/me", json={"tz": "Asia/Tokyo"}, headers=headers)
    assert update.status_code == 200
    tokyo = (await client.get("/me/cache-status", headers=headers)).json()
    assert tokyo["current_date"] == "2026-03-08"
    assert _parse_iso_timestamp(tokyo["next_calculation_boundary_at"]) == datetime(2026, 3, 8, 15, tzinfo=UTC)

    instant = datetime(2026, 3, 8, 6, 30, tzinfo=UTC)
    update = await client.patch("/me", json={"tz": "America/Toronto"}, headers=headers)
    assert update.status_code == 200
    dst_day = (await client.get("/me/cache-status", headers=headers)).json()
    assert dst_day["current_date"] == "2026-03-08"
    assert _parse_iso_timestamp(dst_day["next_calculation_boundary_at"]) == datetime(2026, 3, 9, 4, tzinfo=UTC)


async def test_cache_status_advances_at_visible_group_owner_midnight(client, monkeypatch):
    """A Toronto member gets a new date token when a Tokyo group owner reaches midnight."""
    owner = await _create_user(client)
    owner_headers = _get_auth_header(owner)
    assert (await client.patch("/me", json={"tz": "Asia/Tokyo"}, headers=owner_headers)).status_code == 200
    group = await _create_group(client, owner_headers)
    member_headers, member_id = await _create_second_user(client)
    assert (await client.post(
        f"/groups/{group.json()['id']}/members", json={"user_id": member_id}, headers=owner_headers,
    )).status_code == 201

    instant = datetime(2026, 3, 7, 14, 59, tzinfo=UTC)

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return instant.astimezone(tz) if tz else instant

    user_routes = importlib.import_module("app.routes.users.router")
    monkeypatch.setattr(user_routes, "datetime", FixedDateTime)

    before = (await client.get("/me/cache-status", headers=member_headers)).json()
    instant = datetime(2026, 3, 7, 15, tzinfo=UTC)
    after = (await client.get("/me/cache-status", headers=member_headers)).json()

    assert before["current_date"] == after["current_date"] == "2026-03-07"
    assert _parse_iso_timestamp(before["next_calculation_boundary_at"]) == instant
    assert before["calculation_date_token"] != after["calculation_date_token"]
    assert _parse_iso_timestamp(after["next_calculation_boundary_at"]) == datetime(2026, 3, 8, 5, tzinfo=UTC)


async def test_personal_write_updates_cache_status(client):
    """Creating a personal account records a visible cache timestamp."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    status_resp = await client.get("/me/cache-status", headers=headers)

    assert account_resp.status_code == 201
    assert status_resp.status_code == 200
    payload = status_resp.json()
    _assert_date_boundary(payload)
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
    _assert_date_boundary(before_resp.json())
    assert before_resp.json() == {
        "changed_at": None,
        "current_date": before_resp.json()["current_date"],
        "calculation_date_token": before_resp.json()["calculation_date_token"],
        "next_calculation_boundary_at": before_resp.json()["next_calculation_boundary_at"],
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
