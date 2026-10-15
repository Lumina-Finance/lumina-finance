"""Native handoff tests: a web sign-in in the app's system sheet hands its session to the app"""

import asyncio
import base64
import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

from httpx import ASGITransport, AsyncClient
from sqlalchemy import update

from app.main import app
from app.models.auth import MfaChallenge
from tests.conftest import TestSession
from tests.routes.support import _create_user


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


async def test_exchange_with_wrong_verifier_is_refused_and_spends_code(client):
    """Only the app that asked can exchange, and a wrong guess burns the code"""
    code, verifier, _ = await _signed_in_code(client)

    wrong = await client.post("/auth/native/exchange", json={"code": code, "code_verifier": "x" * 43})
    retry = await client.post("/auth/native/exchange", json={"code": code, "code_verifier": verifier})

    assert wrong.status_code == 401
    assert retry.status_code == 401


async def test_exchange_replay_is_refused(client):
    """A code starts one session only"""
    code, verifier, _ = await _signed_in_code(client)

    first = await client.post("/auth/native/exchange", json={"code": code, "code_verifier": verifier})
    replay = await client.post("/auth/native/exchange", json={"code": code, "code_verifier": verifier})

    assert first.status_code == 200
    assert replay.status_code == 401


async def test_expired_code_is_refused(client):
    """A code left unexchanged past its lifetime stops working"""
    code, verifier, _ = await _signed_in_code(client)
    async with TestSession() as session:
        await session.execute(update(MfaChallenge).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
        await session.commit()

    resp = await client.post("/auth/native/exchange", json={"code": code, "code_verifier": verifier})

    assert resp.status_code == 401


async def test_exchange_after_web_sign_out_is_refused(client):
    """A code from a session that has since ended can't start a new one"""
    code, verifier, web_cookie = await _signed_in_code(client)
    client.cookies.set("refresh_token", web_cookie)
    await client.post("/auth/logout")

    resp = await client.post("/auth/native/exchange", json={"code": code, "code_verifier": verifier})

    assert resp.status_code == 401


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
