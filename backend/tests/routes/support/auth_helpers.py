"""Shared auth route test helpers"""

import hashlib
import time
from datetime import UTC, datetime, timedelta

import pyotp

from app.models.auth import PasswordResetToken
from app.models.currency import Currency
from tests.conftest import TestSession


def _fresh_totp_code(secret: str) -> str:
    """Return a TOTP code one step past the enrolment code, inside the window verification accepts

    Enrolment records the confirming code as used, so exercising TOTP as a live second factor needs a
    later step's code rather than the one that confirmed setup
    """
    totp = pyotp.TOTP(secret)
    return totp.at(int(time.time()) + totp.interval)

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


async def _create_user(client):
    """Create the default signed-up user with the route API

    Args:
        client: Async test client

    Returns:
        API response from signing up the user
    """
    await _seed_currency()
    return await client.post("/auth/signup", json=SIGNUP_PAYLOAD)


async def _seed_reset_token(user_id, raw_token="reset-token-abc", *, expires_in_seconds=600, used=False):  # noqa: S107
    """Insert a reset token row with a known raw value so the consume route can be exercised"""
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    async with TestSession() as session:
        session.add(PasswordResetToken(
            user_id=user_id,
            token_hash=token_hash,
            expires_at=datetime.now(UTC) + timedelta(seconds=expires_in_seconds),
            used_at=datetime.now(UTC) if used else None,
        ))
        await session.commit()
    return raw_token


def _get_auth_header(resp):
    """Return a Bearer Authorization header from an auth response

    Args:
        resp: API response containing an access token

    Returns:
        Authorization header for authenticated route calls
    """
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
