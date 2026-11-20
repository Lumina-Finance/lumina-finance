"""A session ends 30 days after sign-in, however recently it refreshed"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.models.auth_session import AuthSession
from tests.conftest import TestSession
from tests.routes.support import _create_user, _get_auth_header

# Written out here rather than read from the setting, so changing the limit fails a test
_MAX_AGE = timedelta(days=30)


async def _age_session(*, signed_in_ago: timedelta, refreshed_ago: timedelta) -> None:
    """Backdate the only session's sign-in and last refresh, leaving it unexpired by its own expiry

    Liveness reads the database clock, so the rows are seeded rather than the clock moved
    """
    async with TestSession() as session:
        auth_session = (await session.execute(select(AuthSession))).scalar_one()
        now = datetime.now(UTC)
        auth_session.created_at = now - signed_in_ago
        auth_session.expires_at = now - refreshed_ago + timedelta(days=1)
        await session.commit()


async def test_session_older_than_30_days_is_refused_at_refresh_and_on_a_request(client):
    """A session signed in over 30 days ago stops working even though it refreshed a minute ago"""
    signup = await _create_user(client)
    headers = _get_auth_header(signup)
    refresh_cookie = signup.cookies["refresh_token"]
    assert (await client.get("/auth/2fa/status", headers=headers)).status_code == 200

    await _age_session(signed_in_ago=_MAX_AGE + timedelta(minutes=1), refreshed_ago=timedelta(minutes=1))

    request = await client.get("/auth/2fa/status", headers=headers)
    assert request.status_code == 401
    assert request.json()["detail"] == "Session is not active"

    client.cookies.set("refresh_token", refresh_cookie)
    refresh = await client.post("/auth/refresh")
    assert refresh.status_code == 401
    assert refresh.json()["detail"] == "Session is not active"


async def test_session_just_under_30_days_old_still_works(client):
    """A session signed in a minute short of 30 days ago still refreshes and serves requests"""
    signup = await _create_user(client)
    headers = _get_auth_header(signup)
    refresh_cookie = signup.cookies["refresh_token"]

    await _age_session(signed_in_ago=_MAX_AGE - timedelta(minutes=1), refreshed_ago=timedelta(minutes=1))

    assert (await client.get("/auth/2fa/status", headers=headers)).status_code == 200

    client.cookies.set("refresh_token", refresh_cookie)
    refresh = await client.post("/auth/refresh")
    assert refresh.status_code == 200
