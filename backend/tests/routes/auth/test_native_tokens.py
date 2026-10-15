"""Native app token delivery tests: the refresh token travels in the body instead of a cookie"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.models.auth_token import AuthToken
from app.models.base import AuthTokenKind
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _clears_cookie, _create_user, _enroll, _fresh_totp_code

_NATIVE = {"X-Lumina-Client": "native"}
_LOGIN = {"email": SIGNUP_PAYLOAD["email"], "password": SIGNUP_PAYLOAD["password"]}


async def _native_login(client):
    """Sign up the default user, then sign in as the native app and return the response"""
    await _create_user(client)
    client.cookies.clear()
    return await client.post("/auth/login", json=_LOGIN, headers=_NATIVE)


async def test_native_login_returns_refresh_token_without_cookie(client):
    """A native sign-in gets both tokens in the body and no cookie"""
    resp = await _native_login(client)

    assert resp.status_code == 200
    data = resp.json()
    assert data["access_token"]
    assert data["refresh_token"]
    assert "refresh_token" not in resp.cookies


async def test_native_signup_returns_refresh_token_without_cookie(client):
    """Signing up from the app keeps the new session in the app too"""
    await _create_user(client)
    resp = await client.post("/auth/signup", json={**SIGNUP_PAYLOAD, "email": "app@example.com"}, headers=_NATIVE)

    assert resp.status_code == 201
    assert resp.json()["refresh_token"]
    assert "refresh_token" not in resp.cookies


async def test_native_second_factor_returns_refresh_token_without_cookie(client):
    """The token arrives with the second factor, which is where a two-factor sign-in ends"""
    _, secret, _ = await _enroll(client)
    client.cookies.clear()
    login = await client.post("/auth/login", json=_LOGIN, headers=_NATIVE)

    resp = await client.post(
        "/auth/2fa/verify",
        json={"mfa_token": login.json()["mfa_token"], "code": _fresh_totp_code(secret)},
        headers=_NATIVE,
    )

    assert resp.status_code == 200
    assert resp.json()["refresh_token"]
    assert "refresh_token" not in resp.cookies


async def test_marked_request_with_origin_gets_cookie_only(client):
    """A browser always sends Origin, so page script that adds the marker still never reads the token"""
    await _create_user(client)
    client.cookies.clear()
    resp = await client.post("/auth/login", json=_LOGIN, headers={**_NATIVE, "Origin": "https://money.example.com"})

    assert resp.status_code == 200
    assert "refresh_token" not in resp.json()
    assert "refresh_token" in resp.cookies


async def test_web_login_leaves_refresh_token_out_of_body(client):
    """The web keeps its cookie, and its response carries no refresh token at all"""
    await _create_user(client)
    resp = await client.post("/auth/login", json=_LOGIN)

    assert "refresh_token" not in resp.json()
    assert "refresh_token" in resp.cookies


async def test_cookie_refresh_from_marked_request_answers_with_cookie(client):
    """A cookie session can't be turned into a readable token by claiming to be the app"""
    signup = await _create_user(client)
    client.cookies.set("refresh_token", signup.cookies["refresh_token"])

    resp = await client.post("/auth/refresh", headers=_NATIVE)

    assert resp.status_code == 200
    assert "refresh_token" not in resp.json()
    assert "refresh_token" in resp.cookies


async def test_native_refresh_rotates_token_in_body(client):
    """Presenting the body token returns a new pair in the body, still without a cookie"""
    old_token = (await _native_login(client)).json()["refresh_token"]

    resp = await client.post("/auth/refresh", json={"refresh_token": old_token}, headers=_NATIVE)

    assert resp.status_code == 200
    new_token = resp.json()["refresh_token"]
    assert new_token != old_token
    assert "refresh_token" not in resp.cookies


async def test_native_refresh_token_stops_after_grace(client):
    """The rotated-away body token follows the same grace window as a cookie token"""
    old_token = (await _native_login(client)).json()["refresh_token"]
    await client.post("/auth/refresh", json={"refresh_token": old_token}, headers=_NATIVE)

    async with TestSession() as session:
        result = await session.execute(
            select(AuthToken).where(
                AuthToken.token_kind == AuthTokenKind.REFRESH,
                AuthToken.refresh_grace_expires_at.is_not(None),
            ),
        )
        result.scalar_one().refresh_grace_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await session.commit()

    resp = await client.post("/auth/refresh", json={"refresh_token": old_token}, headers=_NATIVE)

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Refresh token is not active"
    assert not _clears_cookie(resp, "refresh_token")


async def test_native_logout_revokes_refresh_token(client):
    """Signing out of the app ends its session, so its refresh token stops working"""
    login = await _native_login(client)
    token = login.json()["refresh_token"]

    logout = await client.post("/auth/logout", json={"refresh_token": token}, headers=_NATIVE)
    resp = await client.post("/auth/refresh", json={"refresh_token": token}, headers=_NATIVE)

    assert logout.status_code == 200
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Session is not active"
