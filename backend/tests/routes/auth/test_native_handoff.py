"""Native handoff tests: a web sign-in in the app's system sheet hands its session to the app"""

import asyncio
import base64
import contextlib
import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated
from urllib.parse import parse_qs, urlsplit

import jwt
import pytest
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.database import current_session_id_ctx, get_db
from app.dependencies import get_authenticated_user
from app.main import app
from app.models.auth import MfaChallenge
from app.models.auth_session import AuthSession
from app.models.auth_token import AuthToken
from app.models.base import AuthTokenKind
from app.models.user import User
from app.services.auth import native_handoff as native_handoff_service
from app.services.auth import tokens
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _create_user, _resend_cookie


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


@pytest.mark.parametrize("cookie", [None, "not-a-token"], ids=["missing", "not-a-token"])
async def test_handoff_without_a_usable_session_cookie_is_refused_and_leaves_the_web_session(client, cookie):
    """An access token taken from the page is not enough, and the refusal signs nobody out"""
    signup = await _create_user(client)
    web_cookie = signup.cookies["refresh_token"]
    client.cookies.clear()
    if cookie is not None:
        client.cookies.set("refresh_token", cookie)
    _, challenge = _pkce_pair()

    query = await _hand_off(client, signup.json()["access_token"], challenge)

    assert query == {"error": "handoff_failed"}
    client.cookies.set("refresh_token", web_cookie)
    assert (await client.post("/auth/refresh")).status_code == 200


@pytest.mark.parametrize(
    ("sent_as", "handed_off"),
    [("__Host-refresh_token", True), ("refresh_token", False)],
    ids=["host-bound-name", "bare-name"],
)
async def test_handoff_over_https_takes_the_session_cookie_only_under_its_host_bound_name(client, sent_as, handed_off):
    """Over HTTPS the sheet's sign-in cookie is the host-bound one, so a bare-name copy proves no session"""
    client.headers["x-forwarded-proto"] = "https"
    signup = await _create_user(client)
    _resend_cookie(client, "__Host-refresh_token", send_as=sent_as)
    _, challenge = _pkce_pair()

    query = await _hand_off(client, signup.json()["access_token"], challenge)

    assert ("code" in query) is handed_off
    assert query.get("error") == (None if handed_off else "handoff_failed")


async def test_handoff_with_the_cookie_of_another_session_is_refused(client):
    """A cookie from one of the account's other sessions can't stand in for the session the access token belongs to"""
    first = await _create_user(client)
    first_cookie = first.cookies["refresh_token"]
    second = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": SIGNUP_PAYLOAD["password"]})
    client.cookies.set("refresh_token", first_cookie)
    _, challenge = _pkce_pair()

    query = await _hand_off(client, second.json()["access_token"], challenge)

    assert query == {"error": "handoff_failed"}


async def test_handoff_with_a_cookie_that_is_no_longer_active_is_refused(client):
    """A refresh cookie whose token has been revoked can't back a handoff, even beside a live access token"""
    signup = await _create_user(client)
    async with TestSession() as session:
        await session.execute(delete(AuthToken).where(AuthToken.token_kind == AuthTokenKind.REFRESH))
        await session.commit()
    _, challenge = _pkce_pair()

    query = await _hand_off(client, signup.json()["access_token"], challenge)

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


async def test_handoff_within_window_succeeds(client):
    """A session that began minutes ago, inside the window, can still hand off"""
    query = await _hand_off_session_started_ago(client, timedelta(minutes=5))

    assert "code" in query


@pytest.mark.parametrize(
    "challenge",
    [None, "short", "A" * 44, "A" * 42 + "+"],
    ids=["missing", "short", "too-long", "outside-base64url"],
)
async def test_handoff_with_bad_challenge_tells_app_it_failed(client, challenge):
    """A valid sign-in still gets no code for a challenge that isn't a SHA-256 digest"""
    signup = await _create_user(client)
    form = {"access_token": signup.json()["access_token"]}
    if challenge is not None:
        form["code_challenge"] = challenge

    resp = await client.post("/auth/native/handoff", data=form, follow_redirects=False)

    assert resp.status_code == 303
    assert resp.headers["location"] == "luminafinance://auth/callback?error=handoff_failed"


async def test_handoff_with_repeated_challenge_tells_app_it_failed(client):
    """A challenge sent twice is refused, since which value counts would be ambiguous"""
    signup = await _create_user(client)
    _, challenge = _pkce_pair()
    form = {"access_token": signup.json()["access_token"], "code_challenge": [challenge, challenge]}

    resp = await client.post("/auth/native/handoff", data=form, follow_redirects=False)

    assert resp.status_code == 303
    assert resp.headers["location"] == "luminafinance://auth/callback?error=handoff_failed"


async def test_handoff_with_binary_body_tells_app_it_failed(client):
    """A body that isn't a urlencoded form is refused the same way"""
    resp = await client.post("/auth/native/handoff", content=b"\xff\xfe", follow_redirects=False)

    assert resp.status_code == 303
    assert resp.headers["location"] == "luminafinance://auth/callback?error=handoff_failed"


@pytest.fixture
def user_check_override():
    """Replace the signed-in-user check as outside code does, noting each token it is given before calling the original

    Takes a Request beside the usual two arguments, so a replacement with dependencies of its own is
    resolved by the framework and never called by hand
    """
    seen: list[str] = []

    async def noting_user_check(
        request: Request,
        credentials: Annotated[HTTPAuthorizationCredentials, Depends(HTTPBearer())],
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> User:
        seen.append(credentials.credentials)
        return await get_authenticated_user(credentials, db)

    app.dependency_overrides[get_authenticated_user] = noting_user_check
    yield seen
    app.dependency_overrides.pop(get_authenticated_user, None)


async def test_handoff_checks_the_access_token_through_the_signed_in_user_override(client, user_check_override):
    """A replacement of the signed-in-user check sees the handoff's token, as it does on every other route"""
    signup = await _create_user(client)
    access_token = signup.json()["access_token"]

    query = await _hand_off(client, access_token, _pkce_pair()[1])

    assert user_check_override == [access_token]
    assert "code" in query


@pytest.mark.parametrize("refusal", [HTTPException, StarletteHTTPException], ids=["fastapi", "starlette"])
async def test_handoff_refused_by_the_signed_in_user_override_tells_app_it_failed(client, refusal):
    """A replacement refusing the token ends the sheet in the app, whichever kind of refusal it raises"""
    signup = await _create_user(client)

    async def refusing_user_check(credentials: Annotated[HTTPAuthorizationCredentials, Depends(HTTPBearer())]) -> User:
        raise refusal(status_code=401, detail="Refused")

    app.dependency_overrides[get_authenticated_user] = refusing_user_check
    try:
        query = await _hand_off(client, signup.json()["access_token"], _pkce_pair()[1])
    finally:
        app.dependency_overrides.pop(get_authenticated_user, None)

    assert query == {"error": "handoff_failed"}


async def test_handoff_with_a_non_ascii_access_token_tells_app_it_failed(client):
    """A token holding characters outside ASCII is refused like any other bad token, never answered with a server error"""
    _, challenge = _pkce_pair()

    query = await _hand_off(client, "€", challenge)

    assert query == {"error": "handoff_failed"}


@pytest.mark.parametrize("field_count", [0, 2], ids=["missing", "repeated"])
async def test_handoff_ignores_an_authorization_header_when_the_form_field_is_unusable(client, field_count):
    """The form's field is the only token this route reads, so a header from elsewhere can't stand in for it"""
    signup = await _create_user(client)
    access_token = signup.json()["access_token"]
    _, challenge = _pkce_pair()
    form = {"code_challenge": challenge, "access_token": [access_token] * field_count}

    resp = await client.post(
        "/auth/native/handoff",
        data=form,
        headers={"Authorization": f"Bearer {access_token}"},
        follow_redirects=False,
    )

    assert resp.status_code == 303
    assert resp.headers["location"] == "luminafinance://auth/callback?error=handoff_failed"


@pytest.mark.parametrize("token_is_good", [True, False], ids=["handed-off", "refused"])
async def test_handoff_leaves_the_request_headers_as_sent_for_request_observers(client, request_records, token_is_good):
    """The token the route presents as a header is gone from the request's scope by the time observers see it, refusal included"""
    signup = await _create_user(client)
    request_records.clear()

    await _hand_off(client, signup.json()["access_token"] if token_is_good else "not-a-token", _pkce_pair()[1])

    [record] = request_records
    assert record.route == "/native/handoff"
    names = {name.lower() for name, _ in record.scope["headers"]}
    assert b"authorization" not in names
    assert {b"cookie", b"content-type"} <= names, "the request's own headers are put back as they were"


@pytest.mark.parametrize("cookie", [None, "not-a-token"], ids=["missing", "not-a-token"])
async def test_handoff_without_session_identity_from_the_user_check_is_refused(client, cookie):
    """A replacement that returns a user but leaves no session identity can't turn a missing or unusable cookie into a code"""
    signup = await _create_user(client)
    client.cookies.clear()
    if cookie is not None:
        client.cookies.set("refresh_token", cookie)

    async def user_check_without_session(
        credentials: Annotated[HTTPAuthorizationCredentials, Depends(HTTPBearer())],
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> User:
        user = await get_authenticated_user(credentials, db)
        current_session_id_ctx.set(None)
        return user

    app.dependency_overrides[get_authenticated_user] = user_check_without_session
    try:
        query = await _hand_off(client, signup.json()["access_token"], _pkce_pair()[1])
    finally:
        app.dependency_overrides.pop(get_authenticated_user, None)

    assert query == {"error": "handoff_failed"}


async def test_exchange_with_unusable_code_is_refused(client):
    """A garbage string and a real access token are both refused as an invalid handoff, never an error page"""
    signup = await _create_user(client)
    verifier, _ = _pkce_pair()

    for code in ("garbage", signup.json()["access_token"]):
        resp = await client.post("/auth/native/exchange", json={"code": code, "code_verifier": verifier})

        assert resp.status_code == 401
        assert resp.json()["detail"] == "Invalid or expired handoff"


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


async def test_an_expired_code_is_refused_while_a_later_handoff_leaves_its_row(client):
    """A code past its expiry can't start a session, and handing off again doesn't delete it on the side"""
    signup = await _create_user(client)
    verifier, challenge = _pkce_pair()
    code = (await _hand_off(client, signup.json()["access_token"], challenge))["code"]
    async with TestSession() as db:
        await db.execute(update(MfaChallenge).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
        await db.commit()

    await _hand_off(client, signup.json()["access_token"], _pkce_pair()[1])
    async with TestSession() as db:
        assert len((await db.scalars(select(MfaChallenge))).all()) == 2, "the expired code is left to the scheduled cleanup"

    resp = await client.post("/auth/native/exchange", json={"code": code, "code_verifier": verifier})

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or expired handoff"


async def test_exchange_after_web_sign_out_is_refused(client):
    """A code from a session that has since ended can't start a new one"""
    code, verifier, web_cookie = await _signed_in_code(client)
    client.cookies.set("refresh_token", web_cookie)
    await client.post("/auth/logout")

    resp = await client.post("/auth/native/exchange", json={"code": code, "code_verifier": verifier})

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or expired handoff"


async def test_concurrent_exchanges_of_one_session_start_one_native_session(client, monkeypatch):
    """Two codes handed off from one web session can't both turn into native sessions

    Each exchange waits at the point where it spends its code until the other arrives, so unless the
    web session's lock keeps the second one out, both always get there together and both succeed
    """
    arrivals = []
    both_arrived = asyncio.Event()
    spend_code = native_handoff_service.consume_mfa_challenge

    async def wait_for_other_exchange(*args, **kwargs):
        arrivals.append(args)
        if len(arrivals) == 2:
            both_arrived.set()
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(both_arrived.wait(), timeout=2)
        return await spend_code(*args, **kwargs)

    monkeypatch.setattr(native_handoff_service, "consume_mfa_challenge", wait_for_other_exchange)
    signup = await _create_user(client)
    access_token = signup.json()["access_token"]
    pairs = [_pkce_pair(), _pkce_pair()]
    codes = [(await _hand_off(client, access_token, challenge))["code"] for _, challenge in pairs]

    async def exchange(code: str, verifier: str):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as exchange_client:
            return await exchange_client.post("/auth/native/exchange", json={"code": code, "code_verifier": verifier})

    results = await asyncio.gather(*(exchange(code, verifier) for code, (verifier, _) in zip(codes, pairs, strict=True)))

    assert sorted(resp.status_code for resp in results) == [200, 401]
