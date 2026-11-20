"""Shared auth route test helpers"""

import time
from datetime import UTC, datetime, timedelta

import pyotp
from sqlalchemy import func, select

from app.encryption import encrypt
from app.models.auth import AuthIdentity, LoginLockout, PasswordResetToken
from app.models.base import AuthProvider
from app.models.currency import Currency
from app.models.oidc import OidcIdentity, OidcProvider
from app.schemas.auth import SignupRequest
from app.services.auth.login_email_hash import seal_login_email
from app.services.auth.token_hashing import hash_token
from app.services.auth.tokens import SignupConfirmationClaims, create_signup_confirmation_token
from tests.conftest import TestSession
from tests.routes.support.mailbox import mailbox


def _fresh_totp_code(secret: str) -> str:
    """Return a TOTP code one step past the enrolment code, inside the window verification accepts

    Enrolment records the confirming code as used, so exercising TOTP as a live second factor needs a
    later step's code rather than the one that confirmed setup
    """
    totp = pyotp.TOTP(secret)
    return totp.at(int(time.time()) + totp.interval)


async def _get_login_lockout(email: str) -> LoginLockout | None:
    """Return the lockout record for an email, or None when no failure is counted for it"""
    async with TestSession() as session:
        return await session.get(LoginLockout, seal_login_email(email))


SIGNUP_PAYLOAD = {
    "email": "test@example.com",
    "password": "SecurePassword123!",
    "first_name": "Test",
    "tz": "America/Toronto",
    "base_currency": "CAD",
}


async def _seed_currency():
    """Insert the CAD currency row required by user signup

    Returns:
        None
    """
    async with TestSession() as session:
        # Insert the default signup currency so auth route tests can create users
        session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()


async def sign_up_through_email(client, payload):
    """Sign a user up and confirm the emailed link, as a person does to get a working account

    For tests whose subject is sign-up itself. Any other test gets its user from sign_up_confirmed

    Args:
        client: Async test client
        payload: Sign-up profile plus the password the person chooses at confirmation

    Returns:
        API response from confirming, signing the new user in
    """
    profile = {key: value for key, value in payload.items() if key != "password"}
    signup = await client.post("/auth/signup", json=profile)
    assert signup.status_code == 204, signup.text

    token = mailbox.confirmation_token(payload["email"])
    return await client.post("/auth/signup/confirm", json={"token": token, "new_password": payload["password"]})


async def sign_up_confirmed(client, payload):
    """Give a test a confirmed user and their session without the email round trip

    Makes the signed token the emailed link would carry and confirms it through the real route, so
    the account, its password and its session are exactly what confirming creates. Only the sign-up
    request and the mailbox are left out, since a test whose subject is not sign-up has no use for them

    Args:
        client: Async test client
        payload: Sign-up profile plus the password the person chooses at confirmation

    Returns:
        API response from confirming, signing the new user in
    """
    profile = SignupRequest.model_validate({key: value for key, value in payload.items() if key != "password"})
    token = create_signup_confirmation_token(
        SignupConfirmationClaims(profile.email, profile.first_name, profile.last_name, profile.tz, profile.base_currency)
    )
    return await client.post("/auth/signup/confirm", json={"token": token, "new_password": payload["password"]})


async def _create_user(client):
    """Create the default signed-up user with the route API

    Args:
        client: Async test client

    Returns:
        API response from confirming the user's sign-up
    """
    await _seed_currency()
    return await sign_up_confirmed(client, SIGNUP_PAYLOAD)


async def _seed_reset_token(user_id, raw_token="reset-token-abc", *, expires_in_seconds=600, used=False, age_seconds=None):  # noqa: S107
    """Insert a reset token row with a known raw value so the consume route can be exercised

    The optional age backdates created_at so throttle and pruning windows can be exercised
    """
    token_hash = hash_token(raw_token)
    async with TestSession() as session:
        token = PasswordResetToken(
            user_id=user_id,
            token_hash=token_hash,
            expires_at=datetime.now(UTC) + timedelta(seconds=expires_in_seconds),
            used_at=datetime.now(UTC) if used else None,
        )
        if age_seconds is not None:
            token.created_at = datetime.now(UTC) - timedelta(seconds=age_seconds)
        session.add(token)
        await session.commit()
    return raw_token


async def _link_sign_in_providers(user_id, count: int, *, first_index: int = 0) -> None:
    """Link the user to a subject at each of as many sign-in providers as asked, and mark the account as provider-linked

    A second user's providers take a later first index, since provider slugs are unique
    """
    async with TestSession() as session:
        for index in range(first_index, first_index + count):
            provider = OidcProvider(
                slug=f"linked-idp-{index}",
                display_name=f"Linked IdP {index}",
                issuer=f"https://linked-idp-{index}.test",
                client_id="client-123",
                client_secret_encrypted=encrypt("secret-abc"),
                scopes="openid email profile",
                enabled=True,
            )
            session.add(provider)

            # Without a mapped relationship the unit of work cannot order the inserts, so the provider lands first
            await session.flush()
            session.add(OidcIdentity(user_id=user_id, provider_id=provider.id, subject=f"subject-{index}", email=SIGNUP_PAYLOAD["email"]))
        session.add(AuthIdentity(user_id=user_id, auth_provider=AuthProvider.OIDC, email_verified=True))
        await session.commit()


async def _count_sign_in_provider_links(user_id) -> tuple[int, int]:
    """Return how many provider identities and provider auth identities the user still has"""
    async with TestSession() as session:
        identities = await session.scalar(select(func.count()).select_from(OidcIdentity).where(OidcIdentity.user_id == user_id))
        auth_identities = await session.scalar(
            select(func.count())
            .select_from(AuthIdentity)
            .where(AuthIdentity.user_id == user_id, AuthIdentity.auth_provider == AuthProvider.OIDC)
        )
    return identities, auth_identities


def _get_auth_header(resp):
    """Return a Bearer Authorization header from an auth response

    Args:
        resp: API response containing an access token

    Returns:
        Authorization header for authenticated route calls
    """
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _saved_copy_key(resp) -> tuple[str, int]:
    """Return the saved copy key and key number a browser sign-in or renewal response carries"""
    body = resp.json()
    return body["saved_copy_key"], body["saved_copy_key_version"]


async def _enroll(client):
    """Sign up a user and complete TOTP enrolment, returning the auth header, secret, and codes

    Adding the first factor steps up with the password alone, since there is no factor to present yet
    """
    auth = _get_auth_header(await _create_user(client))
    step_up = {"password": SIGNUP_PAYLOAD["password"]}
    secret = (await client.post("/auth/2fa/setup", headers=auth, json={"step_up": step_up})).json()["secret"]
    confirm = await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)
    return auth, secret, confirm.json()["recovery_codes"]


async def _sign_in_again(client, email: str = SIGNUP_PAYLOAD["email"]) -> tuple[dict, str]:
    """Sign a password user in on another device, returning that session's auth header and refresh cookie

    A user with a second factor on is challenged at sign-in, so a test opens its second session before
    turning one on
    """
    login = await client.post("/auth/login", json={"email": email, "password": SIGNUP_PAYLOAD["password"]})
    assert login.status_code == 200, login.text
    return _get_auth_header(login), login.cookies["refresh_token"]


async def _refresh_session(client, refresh_cookie: str):
    """Renew a session from its refresh cookie, the way that device's browser does"""
    client.cookies.clear()
    client.cookies.set("refresh_token", refresh_cookie)
    return await client.post("/auth/refresh")


async def _assert_session_works(client, session: tuple[dict, str]) -> None:
    """Assert a session's access token is accepted, which a test uses to check the state it starts from"""
    assert (await client.get("/auth/2fa/status", headers=session[0])).status_code == 200


async def _assert_other_sessions_ended(client, caller: tuple[dict, str], other: tuple[dict, str]) -> None:
    """Assert another device is signed out at both its access token and refresh, and the caller's is not

    The caller's refresh comes last, since renewing a session retires its old access token
    """
    assert (await client.get("/auth/2fa/status", headers=other[0])).status_code == 401, "the other device's access token is refused"
    assert (await _refresh_session(client, other[1])).status_code == 401, "the other device cannot refresh"
    assert (await client.get("/auth/2fa/status", headers=caller[0])).status_code == 200, "the caller's access token still works"
    assert (await _refresh_session(client, caller[1])).status_code == 200, "the caller can still refresh"


async def _assert_other_sessions_kept(client, caller: tuple[dict, str], other: tuple[dict, str]) -> None:
    """Assert both devices still work at their access tokens and refresh"""
    for device in (other, caller):
        assert (await client.get("/auth/2fa/status", headers=device[0])).status_code == 200
        assert (await _refresh_session(client, device[1])).status_code == 200


def _clears_cookie(resp, key: str) -> bool:
    """Return whether a response tells the browser to remove a cookie

    The test client's cookie jar drops a removed cookie without a trace, so this reads the raw
    Set-Cookie headers instead

    Args:
        resp: API response to inspect
        key: Name of the cookie expected to be removed

    Returns:
        True when one of the response's Set-Cookie headers expires that cookie
    """
    return any(header.startswith(f'{key}=""') and "Max-Age=0" in header for header in resp.headers.get_list("set-cookie"))
