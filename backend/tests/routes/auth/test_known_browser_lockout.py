"""A stranger guessing an address's password never signs its owner out or locks the owner's own browser

Guards the sign-in lockout buckets end to end: failures from a browser that has signed in to the
address count apart from everyone else's, and only a lock on that browser, or on one session stepping
up, ends the account's sessions
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.models.auth import LoginLockout
from app.routes.auth.cookie_helpers import KNOWN_BROWSER_COOKIE_KEY
from app.services.auth.known_browser import SHARED_BUCKET, session_bucket, sign_in_bucket
from app.services.auth.login_email_hash import seal_login_email
from tests.conftest import TestSession
from tests.routes.support import (
    SIGNUP_PAYLOAD,
    _assert_bare_cookie,
    _assert_host_bound_cookie,
    _browser_bucket,
    _create_user,
    _enroll,
    _fresh_totp_code,
    _get_auth_header,
    _get_login_lockout,
    _resend_cookie,
    _seed_reset_token,
    _sign_in_again,
    sign_up_confirmed,
)
from tests.routes.support.auth_helpers import _cookie_headers_for
from tests.routes.support.marker_guard import MarkerGuardClient

_EMAIL = SIGNUP_PAYLOAD["email"]
_PASSWORD = SIGNUP_PAYLOAD["password"]
_ATTEMPTS_BEFORE_LOCK = 5
_LOCKED = {"detail": "Account temporarily locked"}
_KNOWN_BROWSER_MAX_AGE = 400 * 24 * 60 * 60
_NEW_PASSWORD = "NewSecurePass123!"
_HOUSEMATE_EMAIL = "housemate@example.com"
_NATIVE = {"x-lumina-client": "native"}


@pytest.fixture
async def stranger():
    """Return a client with no cookies, as a browser that has never signed in to the address"""
    async with MarkerGuardClient() as other:
        yield other


async def _wrong_logins(browser, count: int, email: str = _EMAIL) -> list:
    """Send wrong-password sign-ins from a browser, returning each response"""
    return [await browser.post("/auth/login", json={"email": email, "password": "wrong-password"}) for _ in range(count)]


async def _right_login(browser):
    """Sign in with the right password from a browser"""
    return await browser.post("/auth/login", json={"email": _EMAIL, "password": _PASSWORD})


async def _is_signed_in(browser, auth: dict) -> bool:
    """Return whether the access token still works"""
    return (await browser.get("/auth/2fa/status", headers=auth)).status_code == 200


async def test_over_https_the_host_bound_cookie_is_read_back_into_the_browsers_own_bucket(client):
    """A browser on an HTTPS site sends the host-bound cookie, so its failures count apart from strangers'"""
    client.headers["x-forwarded-proto"] = "https"
    await _create_user(client)
    host_cookie = f"__Host-{KNOWN_BROWSER_COOKIE_KEY}"
    _resend_cookie(client, host_cookie)
    browser_bucket = sign_in_bucket(client.cookies.get(host_cookie), _EMAIL)
    assert browser_bucket != SHARED_BUCKET

    await _wrong_logins(client, 2)

    assert (await _get_login_lockout(_EMAIL, browser_bucket)).failed_attempt_count == 2, "the failures count in the browser's bucket"
    assert await _get_login_lockout(_EMAIL) is None, "none count in the shared bucket"


async def _seed_locks(email: str, buckets: list[str]) -> None:
    """Store a counted failure for the email in each bucket, as senders of every kind would leave them"""
    async with TestSession() as db:
        for bucket in buckets:
            db.add(
                LoginLockout(
                    email_hash=seal_login_email(email),
                    bucket_hash=bucket,
                    failed_attempt_count=2,
                    locked_until=datetime.now(UTC) + timedelta(minutes=20),
                    last_failed_at=datetime.now(UTC),
                )
            )
        await db.commit()


async def test_a_strangers_wrong_passwords_lock_the_shared_bucket_and_leave_the_owner_signed_in(client, stranger):
    """Five wrong passwords from a browser that never signed in to the address end none of the owner's sessions"""
    owner = _get_auth_header(await _create_user(client))
    second_device = await _sign_in_again(client)
    assert _browser_bucket(client) != SHARED_BUCKET, "the owner's browser is known after signing up"

    attempts = await _wrong_logins(stranger, _ATTEMPTS_BEFORE_LOCK + 1)

    assert [response.status_code for response in attempts] == [401] * _ATTEMPTS_BEFORE_LOCK + [423], "the stranger is locked after five"
    assert attempts[-1].json() == _LOCKED
    assert await _is_signed_in(client, owner), "the owner's first session stays signed in"
    assert await _is_signed_in(client, second_device[0]), "the owner's second session stays signed in"
    assert (await _get_login_lockout(_EMAIL)).locked_until is not None, "the shared bucket holds the lock"
    assert await _get_login_lockout(_EMAIL, _browser_bucket(client)) is None, "the owner's browser counted nothing"


async def test_the_owners_known_browser_signs_in_while_a_stranger_is_locked(client, stranger):
    """During a stranger's lock the owner signs in from their browser, and the stranger still cannot"""
    await _create_user(client)
    await _wrong_logins(stranger, _ATTEMPTS_BEFORE_LOCK)

    owner = await _right_login(client)
    refused = await _right_login(stranger)

    assert owner.status_code == 200, "the owner's browser is not counted with the stranger"
    assert (refused.status_code, refused.json()) == (423, _LOCKED), "the stranger stays locked, even with the right password"


async def test_a_cookie_made_for_another_address_gives_a_stranger_no_bucket_of_the_owners(client, stranger):
    """Guessing the owner's password with a cookie that is known only for the guesser's own address counts as a stranger"""
    owner = _get_auth_header(await _create_user(client))
    await sign_up_confirmed(stranger, {**SIGNUP_PAYLOAD, "email": "guesser@example.com"})
    assert stranger.cookies.get(KNOWN_BROWSER_COOKIE_KEY), "the guesser's browser holds a cookie for their own address"

    attempts = await _wrong_logins(stranger, _ATTEMPTS_BEFORE_LOCK)

    assert attempts[-1].status_code == 401
    assert (await _get_login_lockout(_EMAIL)).failed_attempt_count == _ATTEMPTS_BEFORE_LOCK, "the failures count in the shared bucket"
    assert await _is_signed_in(client, owner), "the owner stays signed in"


async def test_five_wrong_passwords_from_the_owners_browser_lock_it_and_end_every_session(client, stranger):
    """A browser the address has signed in from, failing five times, may be a stolen laptop, so every session ends"""
    owner = _get_auth_header(await _create_user(client))
    second_device = await _sign_in_again(client)

    attempts = await _wrong_logins(client, _ATTEMPTS_BEFORE_LOCK)
    refused = await _right_login(client)

    assert [response.status_code for response in attempts] == [401] * _ATTEMPTS_BEFORE_LOCK
    assert (refused.status_code, refused.json()) == (423, _LOCKED), "the locked browser is refused with the right password"
    assert not await _is_signed_in(client, owner), "the first session ends"
    assert not await _is_signed_in(client, second_device[0]), "the second session ends"
    assert (await _right_login(stranger)).status_code == 200, "the lock on one browser leaves other browsers unlocked"


async def test_browsers_unknown_to_the_address_share_one_count_of_five(client):
    """Failures from different strangers add up in the one shared bucket, so rotating browsers does not widen the allowance"""
    await _create_user(client)
    async with MarkerGuardClient() as first, MarkerGuardClient() as second:
        await _wrong_logins(first, 3)
        await _wrong_logins(second, 2)

        refused = await _right_login(first)

    assert (refused.status_code, refused.json()) == (423, _LOCKED)
    assert (await _get_login_lockout(_EMAIL)).failed_attempt_count == _ATTEMPTS_BEFORE_LOCK


@pytest.mark.parametrize("is_native", [False, True], ids=["browser", "native-app"])
async def test_five_wrong_step_ups_in_one_session_end_every_session(client, stranger, is_native):
    """Step-up counts per session, so a session grinding the password at a sensitive change signs everything out"""
    owner = _get_auth_header(await _create_user(client))
    second_device = await _sign_in_again(client)

    # A native app holds no cookie, so its requests come from the client that never signed in
    requester, headers = (stranger, {**owner, **_NATIVE}) if is_native else (client, owner)
    for _ in range(_ATTEMPTS_BEFORE_LOCK):
        wrong = await requester.post("/auth/2fa/setup", headers=headers, json={"step_up": {"password": "wrong-password"}})
        assert wrong.status_code == 401

    assert not await _is_signed_in(client, owner), "the grinding session ends"
    assert not await _is_signed_in(client, second_device[0]), "the account's other session ends too"


@pytest.mark.parametrize("is_native", [False, True], ids=["browser", "native-app"])
async def test_a_strangers_lock_never_blocks_a_step_up(client, stranger, is_native):
    """A step-up with the right password goes through while strangers are locked out of the address"""
    owner = _get_auth_header(await _create_user(client))
    async with MarkerGuardClient() as guesser:
        await _wrong_logins(guesser, _ATTEMPTS_BEFORE_LOCK)

    requester, headers = (stranger, {**owner, **_NATIVE}) if is_native else (client, owner)
    setup = await requester.post("/auth/2fa/setup", headers=headers, json={"step_up": {"password": _PASSWORD}})

    assert setup.status_code == 200, setup.text


async def test_sign_in_hands_a_browser_its_cookie_and_renewal_never_does(client):
    """Only a completed sign-in from a browser sets the cookie, so a stolen refresh token cannot make a known browser"""
    await _create_user(client)
    client.cookies.clear()

    wrong = (await _wrong_logins(client, 1))[0]
    login = await _right_login(client)
    refreshed = await client.post("/auth/refresh")
    native = await client.post("/auth/login", headers=_NATIVE, json={"email": _EMAIL, "password": _PASSWORD})

    assert (wrong.status_code, _cookie_headers_for(wrong, KNOWN_BROWSER_COOKIE_KEY)) == (401, []), "a wrong password sets no cookie"
    header = _assert_bare_cookie(login, KNOWN_BROWSER_COOKIE_KEY)
    attributes = [part.strip() for part in header.split(";")[1:]]
    assert {"httponly", "samesite=lax", "path=/", f"max-age={_KNOWN_BROWSER_MAX_AGE}"} <= set(attributes)
    assert _cookie_headers_for(refreshed, KNOWN_BROWSER_COOKIE_KEY) == [], "a renewal sets no cookie"
    assert refreshed.status_code == 200
    assert _cookie_headers_for(native, KNOWN_BROWSER_COOKIE_KEY) == [], "a native app gets none"


async def test_a_password_that_still_needs_a_second_factor_hands_out_no_cookie_until_the_factor_passes(client):
    """The browser becomes known only once the whole sign-in completes, never at the password step"""
    _, secret, _ = await _enroll(client)
    client.cookies.clear()

    password_step = await _right_login(client)
    verified = await client.post("/auth/2fa/verify", json={"mfa_token": password_step.json()["mfa_token"], "code": _fresh_totp_code(secret)})

    assert password_step.json()["mfa_required"] is True
    assert _cookie_headers_for(password_step, KNOWN_BROWSER_COOKIE_KEY) == [], "the password step sets no cookie"
    assert verified.status_code == 200
    assert len(_cookie_headers_for(verified, KNOWN_BROWSER_COOKIE_KEY)) == 1, "the second factor completes the sign-in and sets it"


async def test_a_second_address_signed_in_from_one_browser_keeps_the_first_known(client):
    """A shared browser stays known for every address signed in from it"""
    await _create_user(client)
    assert (await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": _HOUSEMATE_EMAIL})).status_code == 201

    cookie = client.cookies.get(KNOWN_BROWSER_COOKIE_KEY)

    assert sign_in_bucket(cookie, _EMAIL) != SHARED_BUCKET, "the first address is still known"
    assert sign_in_bucket(cookie, _HOUSEMATE_EMAIL) != SHARED_BUCKET, "the second address is known"


async def test_the_cookie_takes_the_host_bound_name_over_https_and_sign_out_leaves_it(client):
    """Over HTTPS a sibling hostname can't plant the cookie, and signing out keeps the browser known"""
    client.headers["x-forwarded-proto"] = "https"
    signup = await _create_user(client)

    header = _assert_host_bound_cookie(signup, KNOWN_BROWSER_COOKIE_KEY)
    assert "httponly" in header
    logout = await client.post("/auth/logout", headers=_get_auth_header(signup))

    assert logout.status_code == 200
    assert _cookie_headers_for(logout, f"__Host-{KNOWN_BROWSER_COOKIE_KEY}") == [], "sign-out sends no removal for the cookie"
    assert _cookie_headers_for(logout, KNOWN_BROWSER_COOKIE_KEY) == []


async def test_changing_the_password_clears_every_bucket_of_the_address(client):
    """The owner proving their password forgets the failures and locks of strangers and browsers alike"""
    auth = _get_auth_header(await _create_user(client))
    buckets = [SHARED_BUCKET, _browser_bucket(client), session_bucket(uuid.uuid4())]
    await _seed_locks(_EMAIL, buckets)

    changed = await client.patch("/auth/password", headers=auth, json={"current_password": _PASSWORD, "new_password": _NEW_PASSWORD})

    assert changed.status_code == 204
    for bucket in buckets:
        assert await _get_login_lockout(_EMAIL, bucket) is None, f"bucket {bucket[:4]!r} is cleared"


async def test_resetting_the_password_clears_every_bucket_of_the_address(client):
    """A verified reset forgets the failures and locks of strangers and browsers alike, so the owner signs in at once"""
    signup = await _create_user(client)
    buckets = [SHARED_BUCKET, _browser_bucket(client), session_bucket(uuid.uuid4())]
    await _seed_locks(_EMAIL, buckets)
    raw_token = await _seed_reset_token(uuid.UUID(signup.json()["user"]["id"]))

    reset = await client.post("/auth/password/reset", json={"token": raw_token, "new_password": _NEW_PASSWORD})

    assert reset.status_code == 204
    for bucket in buckets:
        assert await _get_login_lockout(_EMAIL, bucket) is None, f"bucket {bucket[:4]!r} is cleared"
