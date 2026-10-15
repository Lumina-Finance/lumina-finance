"""Native handoff tests: a web sign-in in the app's system sheet hands its session to the app"""

import asyncio
import base64
import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import jwt
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update

from app.main import app
from app.models.auth_session import AuthSession
from app.services.auth import tokens
from tests.conftest import TestSession
from tests.routes.support import _create_user


def _clock_set_back(age: timedelta) -> type[datetime]:
    """Return a datetime whose now is the given age ago, so a code is issued as if that long ago"""

    class _Earlier(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.now(tz) - age

    return _Earlier


def _pkce_pair() -> tuple[str, str]:
    """Return a PKCE verifier and its S256 challenge, as the app makes them"""
    verifier = secrets.token_urlsafe(32)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


async def _hand_off(client, access_token: str, challenge: str):
    """Submit the page's handoff form and return the query the redirect hands to the app"""
    resp = await client.post(
        "/auth/native/handoff",
        data={"access_token": access_token, "code_challenge": challenge},
        follow_redirects=False,
    )
    assert resp.status_code == 303
    location = urlsplit(resp.headers["location"])
    assert f"{location.scheme}://{location.netloc}{location.path}" == "luminafinance://auth/callback"
    return {name: values[0] for name, values in parse_qs(location.query).items()}


async def _signed_in_code(client) -> tuple[str, str, str]:
    """Sign up in the web, hand off, and return the code, its verifier and the web refresh cookie"""
    signup = await _create_user(client)
    verifier, challenge = _pkce_pair()
    query = await _hand_off(client, signup.json()["access_token"], challenge)
    return query["code"], verifier, signup.cookies["refresh_token"]


async def test_exchange_starts_native_session_and_ends_web_session(client):
    """The app gets both tokens in the body, and the web session in the sheet stops working"""
    code, verifier, web_cookie = await _signed_in_code(client)
    client.cookies.clear()

    resp = await client.post("/auth/native/exchange", json={"code": code, "code_verifier": verifier})

    assert resp.status_code == 200
    assert resp.json()["refresh_token"]
    assert "refresh_token" not in resp.cookies
    client.cookies.set("refresh_token", web_cookie)
    assert (await client.post("/auth/refresh")).status_code == 401


async def test_handoff_with_invalid_access_token_tells_app_it_failed(client):
    """A page whose session has gone sends the app an error instead of leaving the sheet stuck"""
    _, challenge = _pkce_pair()

    query = await _hand_off(client, "not-a-token", challenge)

    assert query == {"error": "handoff_failed"}


async def _hand_off_session_started_ago(client, age: timedelta) -> dict[str, str]:
    """Sign up, backdate the web session's start by the given age, and hand it off"""
    signup = await _create_user(client)
    async with TestSession() as session:
        await session.execute(update(AuthSession).values(created_at=datetime.now(UTC) - age))
        await session.commit()
    _, challenge = _pkce_pair()
    return await _hand_off(client, signup.json()["access_token"], challenge)


async def test_handoff_from_long_open_session_is_refused(client):
    """Only a sign-in that just finished can hand off, so a script in a long-open tab can't mint an app session"""
    query = await _hand_off_session_started_ago(client, timedelta(minutes=11))

    assert query == {"error": "handoff_failed"}


async def test_handoff_after_sign_up_setup_succeeds(client):
    """A sign-up hands off only once its second factor and recovery codes are set up, which takes minutes"""
    query = await _hand_off_session_started_ago(client, timedelta(minutes=5))

    assert "code" in query


async def test_exchange_with_wrong_verifier_is_refused_and_spends_code(client):
    """Only the app that asked can exchange, and a wrong guess burns the code"""
    code, verifier, _ = await _signed_in_code(client)

    wrong = await client.post("/auth/native/exchange", json={"code": code, "code_verifier": "x" * 43})
    retry = await client.post("/auth/native/exchange", json={"code": code, "code_verifier": verifier})

    assert wrong.status_code == 401
    assert wrong.json()["detail"] == "Invalid or expired handoff"
    assert retry.status_code == 401


@pytest.mark.parametrize(("age", "status"), [(timedelta(seconds=55), 200), (timedelta(seconds=65), 401)])
async def test_code_works_for_one_minute(client, monkeypatch, age, status):
    """A code left unexchanged for more than a minute stops working"""
    signup = await _create_user(client)
    verifier, challenge = _pkce_pair()
    monkeypatch.setattr(tokens, "datetime", _clock_set_back(age))
    code = (await _hand_off(client, signup.json()["access_token"], challenge))["code"]
    monkeypatch.undo()
    issued_at = jwt.decode(code, options={"verify_signature": False})["iat"]
    assert abs(datetime.now(UTC).timestamp() - age.total_seconds() - issued_at) < 5

    resp = await client.post("/auth/native/exchange", json={"code": code, "code_verifier": verifier})

    assert resp.status_code == status


async def test_exchange_after_web_sign_out_is_refused(client):
    """A code from a session that has since ended can't start a new one"""
    code, verifier, web_cookie = await _signed_in_code(client)
    client.cookies.set("refresh_token", web_cookie)
    await client.post("/auth/logout")

    resp = await client.post("/auth/native/exchange", json={"code": code, "code_verifier": verifier})

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or expired handoff"


async def test_concurrent_exchanges_of_one_session_start_one_native_session(client):
    """Two codes handed off from one web session can't both turn into native sessions"""
    signup = await _create_user(client)
    access_token = signup.json()["access_token"]
    pairs = [_pkce_pair(), _pkce_pair()]
    codes = [(await _hand_off(client, access_token, challenge))["code"] for _, challenge in pairs]

    async def exchange(code: str, verifier: str):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as exchange_client:
            return await exchange_client.post("/auth/native/exchange", json={"code": code, "code_verifier": verifier})

    results = await asyncio.gather(*(exchange(code, verifier) for code, (verifier, _) in zip(codes, pairs, strict=True)))

    assert sorted(resp.status_code for resp in results) == [200, 401]
