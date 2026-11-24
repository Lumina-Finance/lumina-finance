"""One person holds at most 10 live sign-in sessions, and the one renewed longest ago ends to make room

Guards against repeated sign-ins piling up sessions without end, and against the limit signing out a
device in use: the session that goes is the one whose expiry is earliest, which is the one renewed or
signed in longest ago, never one signed in first but refreshed since. A refresh ends nothing, and rows
that are no longer live count for nothing. The overlap tests guard the lock order, since a sign-in
ending a session beside another flow ending or redeeming that same session once deadlocked

Rows are seeded with chosen expires_at and created_at because liveness reads the database's clock,
which a frozen Python clock can't move. The limit is written out as 10 here rather than read from the
setting, so changing it fails a test
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import jwt
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

import app.services.auth.webauthn as webauthn_service
from app.main import app
from app.models.auth_session import AuthSession
from app.routes.auth import native as native_route
from app.services.auth import sessions
from tests.conftest import TestSession
from tests.routes.support import (
    SIGNUP_PAYLOAD,
    _assert_other_sessions_ended,
    _assert_session_works,
    _create_user,
    _enroll,
    _fresh_totp_code,
    _get_auth_header,
    _link_sign_in_providers,
    _refresh_session,
    _saved_copy_key,
    _seed_reset_token,
    _sign_in_again,
    _signed_in_code,
    sign_up_confirmed,
)
from tests.routes.support.lock_helpers import _held_request, _overlap, _pid, _record_pid
from tests.routes.support.passkey_helpers import _build_assertion, _seed_passkey

_PASSWORD = SIGNUP_PAYLOAD["password"]
_NEW_PASSWORD = "NewSecurePass123!"
_LOGIN = {"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD}
_END_OTHERS = "/auth/sessions/end-others"
_MAX_AGE = timedelta(days=30)

_Device = tuple[dict, str]


def _claims(auth: dict) -> dict:
    """Return the claims of the access token an auth header carries"""
    return jwt.decode(auth["Authorization"].removeprefix("Bearer "), options={"verify_signature": False})


def _session_id(auth: dict) -> uuid.UUID:
    """Return the session an auth header's access token belongs to"""
    return uuid.UUID(_claims(auth)["sid"])


def _user_id(auth: dict) -> uuid.UUID:
    """Return the user an auth header's access token belongs to"""
    return uuid.UUID(_claims(auth)["sub"])


async def _live_ids(user_id: uuid.UUID) -> set[uuid.UUID]:
    """Return the user's sessions that are live by the database's clock: unexpired and signed in within 30 days"""
    async with TestSession() as db:
        rows = await db.scalars(
            select(AuthSession.id).where(
                AuthSession.user_id == user_id,
                AuthSession.expires_at > func.now(),
                AuthSession.created_at > func.now() - _MAX_AGE,
            )
        )
        return set(rows)


async def _row_ids(user_id: uuid.UUID) -> set[uuid.UUID]:
    """Return every session row the user has, live or not"""
    async with TestSession() as db:
        return set(await db.scalars(select(AuthSession.id).where(AuthSession.user_id == user_id)))


async def _seed_rows(user_id: uuid.UUID, count: int) -> list[uuid.UUID]:
    """Insert live sessions with no tokens, for a test that only needs them counted, and return their ids"""
    ids = [uuid.uuid4() for _ in range(count)]
    async with TestSession() as db:
        db.add_all(AuthSession(id=session_id, user_id=user_id, expires_at=datetime.now(UTC) + timedelta(days=1)) for session_id in ids)
        await db.commit()
    return ids


async def _seed_non_live_rows(user_id: uuid.UUID) -> list[uuid.UUID]:
    """Insert a session that has expired and one that is unexpired but was signed in over 30 days ago"""
    now = datetime.now(UTC)
    expired = AuthSession(id=uuid.uuid4(), user_id=user_id, expires_at=now - timedelta(hours=1), created_at=now - timedelta(days=2))

    # Expiring before every live session, so a count that took it in would end a live one to make room
    too_old = AuthSession(
        id=uuid.uuid4(), user_id=user_id, expires_at=now + timedelta(hours=12), created_at=now - _MAX_AGE - timedelta(hours=1)
    )
    async with TestSession() as db:
        db.add_all([expired, too_old])
        await db.commit()
    return [expired.id, too_old.id]


async def _arrange(earliest_first: list[uuid.UUID]) -> None:
    """Give the sessions expiries a day apart, the first expiring soonest, and sign-in times in the opposite order

    The session expiring last was signed in longest ago, as one refreshed lately would be, so a limit
    that picked the oldest sign-in would end the wrong one
    """
    now = datetime.now(UTC)
    async with TestSession() as db:
        for rank, session_id in enumerate(earliest_first):
            row = await db.get(AuthSession, session_id)
            row.expires_at = now + timedelta(days=rank + 1)
            # Two days apart, so even twelve sessions stay well inside the 30-day maximum age
            row.created_at = now - timedelta(days=1 + 2 * rank)
        await db.commit()


async def _sign_in_to_limit(client, count: int = 10) -> list[_Device]:
    """Sign the default person up and in until they hold this many sessions, returning each device's tokens"""
    signup = await _create_user(client)
    devices = [(_get_auth_header(signup), signup.cookies["refresh_token"])]
    for _ in range(count - 1):
        devices.append(await _sign_in_again(client))
    return devices


async def _at_limit_arranged(client) -> tuple[uuid.UUID, list[_Device]]:
    """Return a person holding 10 sessions of real sign-ins, the first listed expiring soonest and the last signed in first"""
    devices = (await _sign_in_to_limit(client))[::-1]
    await _arrange([_session_id(auth) for auth, _ in devices])
    user_id = _user_id(devices[0][0])
    assert await _live_ids(user_id) == {_session_id(auth) for auth, _ in devices}, "starts at 10 live sessions"
    return user_id, devices


async def _fill_to_limit(user_id: uuid.UUID, held: list[uuid.UUID]) -> tuple[uuid.UUID, set[uuid.UUID]]:
    """Seed sessions up to 10, expiring before the ones held, returning the earliest and every live session"""
    seeded = await _seed_rows(user_id, 10 - len(held))
    await _arrange([*seeded, *held])
    live = await _live_ids(user_id)
    assert len(live) == 10, "starts at 10 live sessions"
    return seeded[0], live


async def _assert_signed_in_at_limit(user_id: uuid.UUID, before: set[uuid.UUID], ended: set[uuid.UUID], auth: dict) -> None:
    """Assert a sign-in left 10 live sessions: the earliest-expiring ones gone, the new one in, no other changed"""
    live = await _live_ids(user_id)
    assert len(live) == 10, "10 live sessions after the sign-in"
    assert not ended & live, "the earliest-expiring sessions ended"
    assert _session_id(auth) in live, "the new session is live"
    assert live == (before - ended) | {_session_id(auth)}, "no other session ended"


async def _post_isolated(path: str, **kwargs):
    """Post once from a client of its own, so overlapping requests don't share a cookie jar"""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as isolated:
        return await isolated.post(path, **kwargs)


def _hold_after_user_lock(monkeypatch, pids: list[int], held: asyncio.Event, release: asyncio.Event) -> None:
    """Make the held request wait, once it has the user's row, for the release"""
    original = sessions.lock_user_for_session_changes

    async def hold(db, user_id):
        await original(db, user_id)
        if _held_request.get():
            pids.append(await _pid(db))
            held.set()
            await release.wait()

    monkeypatch.setattr(sessions, "lock_user_for_session_changes", hold)


async def test_password_sign_in_at_ten_live_sessions_ends_only_the_earliest_expiry(client):
    """The 11th sign-in ends the session renewed longest ago, keeps one signed in first but renewed since, and counts no non-live row"""
    user_id, devices = await _at_limit_arranged(client)
    non_live = await _seed_non_live_rows(user_id)
    before = await _live_ids(user_id)
    assert len(before) == 10, "starts at 10 live sessions beside the two others"
    earliest, *others = devices

    new = await _sign_in_again(client)

    await _assert_signed_in_at_limit(user_id, before, {_session_id(earliest[0])}, new[0])
    assert set(non_live) <= await _row_ids(user_id), "the non-live rows are untouched"
    for device in others:
        await _assert_session_works(client, device)
    await _assert_other_sessions_ended(client, new, earliest)


async def test_password_sign_in_at_nine_live_sessions_beside_non_live_rows_ends_none(client):
    """Below the limit a sign-in ends nothing, and non-live rows don't bring a person to it"""
    devices = await _sign_in_to_limit(client, 9)
    user_id = _user_id(devices[0][0])
    non_live = await _seed_non_live_rows(user_id)
    assert len(await _live_ids(user_id)) == 9, "starts at 9 live sessions"

    new = await _sign_in_again(client)

    assert len(await _live_ids(user_id)) == 10
    for device in [*devices, new]:
        await _assert_session_works(client, device)
    assert set(non_live) <= await _row_ids(user_id), "the non-live rows are untouched"


async def test_password_sign_in_at_twelve_live_sessions_ends_the_three_with_the_earliest_expiry(client):
    """A person who held more than the limit before it shipped comes down to 10 at their next sign-in"""
    signup = await _create_user(client)
    user_id = _user_id(_get_auth_header(signup))
    seeded = await _seed_rows(user_id, 11)
    await _arrange([*seeded, _session_id(_get_auth_header(signup))])
    before = await _live_ids(user_id)
    assert len(before) == 12, "starts at 12 live sessions"

    new = await _sign_in_again(client)

    await _assert_signed_in_at_limit(user_id, before, set(seeded[:3]), new[0])


async def test_password_sign_in_at_the_limit_leaves_another_persons_sessions(client):
    """Another person's sessions, though they expire sooner than every one of the first person's, stay"""
    user_id, _ = await _at_limit_arranged(client)
    bystander_email = "bystander@example.com"
    signup = await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": bystander_email})
    bystander = [(_get_auth_header(signup), signup.cookies["refresh_token"])]
    bystander += [await _sign_in_again(client, bystander_email) for _ in range(2)]
    async with TestSession() as db:
        for auth, _ in bystander:
            (await db.get(AuthSession, _session_id(auth))).expires_at = datetime.now(UTC) + timedelta(minutes=30)
        await db.commit()
    assert len(await _live_ids(_user_id(bystander[0][0]))) == 3, "the other person starts with 3 live sessions"

    await _sign_in_again(client)

    assert len(await _live_ids(user_id)) == 10
    assert len(await _live_ids(_user_id(bystander[0][0]))) == 3
    for device in bystander:
        await _assert_session_works(client, device)


async def test_refresh_at_ten_live_sessions_ends_none(client):
    """Renewing a session adds none, so it never signs another device out"""
    user_id, devices = await _at_limit_arranged(client)
    before = await _live_ids(user_id)

    refreshed = await _refresh_session(client, devices[3][1])

    assert refreshed.status_code == 200
    assert await _live_ids(user_id) == before


async def test_fifteen_sign_ins_in_a_row_never_leave_more_than_ten_live_sessions(client):
    """Repeated sign-ins on one account keep the 10 most recent and sign the earlier devices out"""
    devices = await _sign_in_to_limit(client, 1)
    user_id = _user_id(devices[0][0])
    for signed_in in range(2, 16):
        devices.append(await _sign_in_again(client))
        assert len(await _live_ids(user_id)) == min(signed_in, 10), f"live sessions after {signed_in} sign-ins"

    for device in devices[5:]:
        await _assert_session_works(client, device)
    for device in devices[:5]:
        assert (await client.get("/auth/2fa/status", headers=device[0])).status_code == 401, "an earlier sign-in is signed out"


async def test_password_sign_in_that_ends_a_session_keeps_the_saved_copy_key(client):
    """Ending a session to make room signs no browser's saved copy out, as signing out doesn't"""
    signup = await _create_user(client)
    key = _saved_copy_key(signup)
    for _ in range(9):
        await _sign_in_again(client)
    user_id = _user_id(_get_auth_header(signup))
    before = await _live_ids(user_id)
    assert len(before) == 10, "starts at 10 live sessions"

    login = await client.post("/auth/login", json=_LOGIN)

    assert login.status_code == 200
    assert _session_id(_get_auth_header(login)) in await _live_ids(user_id)
    assert before - await _live_ids(user_id), "the sign-in ended a session"
    assert _saved_copy_key(login) == key
    assert key[1] == 0


async def test_two_password_sign_ins_at_once_at_nine_live_sessions_leave_ten(client, monkeypatch):
    """Both sign-ins count the sessions held, one after the other, so the second ends one"""
    devices = await _sign_in_to_limit(client, 9)
    user_id = _user_id(devices[0][0])
    held, release, entered, pids = asyncio.Event(), asyncio.Event(), asyncio.Event(), []
    _hold_after_user_lock(monkeypatch, pids, held, release)
    _record_pid(monkeypatch, sessions, "lock_user_for_session_changes", pids, entered)

    async def first():
        _held_request.set(True)
        return await _post_isolated("/auth/login", json=_LOGIN)

    async def second():
        return await _post_isolated("/auth/login", json=_LOGIN)

    responses = await _overlap(first, second, first_held=held, release=release, second_entered=entered, pids=pids)

    assert [response.status_code for response in responses] == [200, 200], [response.text for response in responses]
    assert len(await _live_ids(user_id)) == 10


async def test_sign_in_and_signing_out_other_devices_at_once_at_ten_live_sessions_both_succeed(client, monkeypatch):
    """A sign-in ending a session another device's sign-out is ending waits its turn rather than deadlocking"""
    user_id, devices = await _at_limit_arranged(client)
    caller = devices[-1]
    held, release, entered, pids = asyncio.Event(), asyncio.Event(), asyncio.Event(), []
    _hold_after_user_lock(monkeypatch, pids, held, release)
    _record_pid(monkeypatch, sessions, "_rotate_saved_copy_key", pids, entered)

    async def sign_in():
        _held_request.set(True)
        return await _post_isolated("/auth/login", json=_LOGIN)

    async def end_others():
        return await _post_isolated(_END_OTHERS, headers=caller[0], json={"password": _PASSWORD})

    signed_in, ended = await _overlap(sign_in, end_others, first_held=held, release=release, second_entered=entered, pids=pids)

    assert signed_in.status_code == 200, signed_in.text
    assert ended.status_code == 204, ended.text
    assert await _live_ids(user_id) == {_session_id(caller[0])}, "the sign-out then took every other session, the new one included"
    await _assert_session_works(client, caller)


async def test_sign_in_and_password_reset_at_once_at_ten_live_sessions_both_succeed(client, monkeypatch):
    """A reset ends every session, so it takes its turn behind a sign-in ending one rather than deadlocking with it"""
    user_id, _ = await _at_limit_arranged(client)
    token = await _seed_reset_token(user_id)
    held, release, entered, pids = asyncio.Event(), asyncio.Event(), asyncio.Event(), []
    _hold_after_user_lock(monkeypatch, pids, held, release)
    _record_pid(monkeypatch, sessions, "_rotate_saved_copy_key", pids, entered)

    async def sign_in():
        _held_request.set(True)
        return await _post_isolated("/auth/login", json=_LOGIN)

    async def reset():
        return await _post_isolated("/auth/password/reset", json={"token": token, "new_password": _NEW_PASSWORD})

    signed_in, reset_done = await _overlap(sign_in, reset, first_held=held, release=release, second_entered=entered, pids=pids)

    assert signed_in.status_code == 200, signed_in.text
    assert reset_done.status_code == 204, reset_done.text
    assert await _live_ids(user_id) == set(), "the reset then ended every session, the new one included"


async def test_native_exchange_and_sign_in_ending_its_web_session_at_once_both_succeed(client, monkeypatch):
    """A sign-in at the limit that would end the session an exchange is redeeming waits its turn rather than deadlocking"""
    code, verifier, _ = await _signed_in_code(client)
    async with TestSession() as db:
        web_id, user_id = (await db.execute(select(AuthSession.id, AuthSession.user_id))).one()
    seeded = await _seed_rows(user_id, 9)
    await _arrange([web_id, *seeded])
    assert await _live_ids(user_id) == {web_id, *seeded}, "starts at 10 live sessions, the web one expiring first"
    held, release, entered, pids = asyncio.Event(), asyncio.Event(), asyncio.Event(), []
    redeem = native_route.redeem_native_handoff_code

    async def hold_after_redeeming(db, **kwargs):
        redeemed = await redeem(db, **kwargs)
        if _held_request.get():
            pids.append(await _pid(db))
            held.set()
            await release.wait()
        return redeemed

    monkeypatch.setattr(native_route, "redeem_native_handoff_code", hold_after_redeeming)
    _record_pid(monkeypatch, sessions, "lock_user_for_session_changes", pids, entered)

    async def exchange():
        _held_request.set(True)
        return await _post_isolated("/auth/native/exchange", json={"code": code, "code_verifier": verifier})

    async def sign_in():
        return await _post_isolated("/auth/login", json=_LOGIN)

    exchanged, signed_in = await _overlap(exchange, sign_in, first_held=held, release=release, second_entered=entered, pids=pids)

    assert exchanged.status_code == 200, exchanged.text
    assert signed_in.status_code == 200, signed_in.text
    live = await _live_ids(user_id)
    assert len(live) == 10
    assert web_id not in live, "the web session ended"


async def test_two_factor_sign_in_at_ten_live_sessions_ends_the_one_with_the_earliest_expiry(client):
    """Finishing a password sign-in with an authenticator code starts its session under the limit too"""
    auth, secret, _ = await _enroll(client)
    user_id = _user_id(auth)
    earliest, before = await _fill_to_limit(user_id, [_session_id(auth)])
    challenge = await client.post("/auth/login", json=_LOGIN)
    assert challenge.status_code == 200

    verify = await client.post("/auth/2fa/verify", json={"mfa_token": challenge.json()["mfa_token"], "code": _fresh_totp_code(secret)})

    assert verify.status_code == 200, verify.text
    await _assert_signed_in_at_limit(user_id, before, {earliest}, _get_auth_header(verify))


async def test_passkey_sign_in_at_ten_live_sessions_ends_the_one_with_the_earliest_expiry(client, monkeypatch):
    """A passkey sign-in, with no password, starts its session under the limit too"""
    signup = await _create_user(client)
    user_id = _user_id(_get_auth_header(signup))
    earliest, before = await _fill_to_limit(user_id, [_session_id(_get_auth_header(signup))])
    credential_id = b"limit-credential"
    await _seed_passkey(str(user_id), credential_id)
    options = (await client.post("/auth/passkeys/authenticate/options")).json()
    assertion = _build_assertion(options["challenge"], credential_id, str(user_id))

    # The assertion crypto is the library's responsibility, so only its verdict is stubbed
    monkeypatch.setattr(webauthn_service, "verify_authentication_response", lambda **_: SimpleNamespace(new_sign_count=7))
    signed_in = await client.post("/auth/passkeys/authenticate", json={"credential": assertion})

    assert signed_in.status_code == 200, signed_in.text
    await _assert_signed_in_at_limit(user_id, before, {earliest}, _get_auth_header(signed_in))


async def test_provider_sign_in_at_ten_live_sessions_ends_the_one_with_the_earliest_expiry(client, provider_protocol):
    """A provider sign-in starts its session under the limit too"""
    signup = await _create_user(client)
    user_id = _user_id(_get_auth_header(signup))
    await _link_sign_in_providers(user_id, 1)
    earliest, before = await _fill_to_limit(user_id, [_session_id(_get_auth_header(signup))])
    provider_protocol["claims"] = {"sub": "subject-0", "email": SIGNUP_PAYLOAD["email"], "email_verified": True}
    started = await client.post("/auth/oidc/linked-idp-0/authorize")
    assert started.status_code == 200
    state = parse_qs(urlparse(started.json()["authorization_url"]).query)["state"][0]

    signed_in = await client.post("/auth/oidc/callback", json={"code": "any", "state": state})

    assert signed_in.status_code == 200, signed_in.text
    await _assert_signed_in_at_limit(user_id, before, {earliest}, _get_auth_header(signed_in))


async def test_native_exchange_at_ten_live_sessions_ends_its_web_session_and_nothing_else(client):
    """The exchange swaps the web session for the app's, so the person stays at 10 with no other device signed out"""
    code, verifier, _ = await _signed_in_code(client)
    async with TestSession() as db:
        web_id, user_id = (await db.execute(select(AuthSession.id, AuthSession.user_id))).one()
    seeded = await _seed_rows(user_id, 9)
    await _arrange([*seeded, web_id])
    before = await _live_ids(user_id)
    assert before == {web_id, *seeded}, "starts at 10 live sessions, the web one expiring last"
    client.cookies.clear()

    exchanged = await client.post("/auth/native/exchange", json={"code": code, "code_verifier": verifier})

    assert exchanged.status_code == 200, exchanged.text
    new_id = _session_id(_get_auth_header(exchanged))
    assert await _live_ids(user_id) == (before - {web_id}) | {new_id}
