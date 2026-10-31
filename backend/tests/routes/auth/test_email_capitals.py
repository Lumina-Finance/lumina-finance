"""Sign-in and password reset find an account whatever capitals the email is typed in"""

import uuid

from sqlalchemy import select

from app.models.auth import PasswordResetToken
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _get_login_lockout, _seed_currency, sign_up_confirmed
from tests.routes.support.mailbox import mailbox

_STORED_EMAIL = "Alice@example.com"
_TYPED_EMAIL = "alice@example.com"
_SHOUTED_EMAIL = "ALICE@example.com"
_PASSWORD = SIGNUP_PAYLOAD["password"]
_ATTEMPTS_BEFORE_LOCK = 5


async def _create_alice(client) -> dict:
    """Sign up the account whose address is stored with a capital A and return the confirmation body"""
    await _seed_currency()
    signup = await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": _STORED_EMAIL})
    assert signup.status_code == 201
    return signup.json()


async def test_login_with_other_capitals_signs_in_the_account(client):
    """The owner who types their address in lower case at sign-in is not told the credentials are wrong"""
    body = await _create_alice(client)

    resp = await client.post("/auth/login", json={"email": _TYPED_EMAIL, "password": _PASSWORD})

    assert resp.status_code == 200
    assert resp.json()["user"]["id"] == body["user"]["id"]
    assert resp.json()["user"]["email"] == _STORED_EMAIL


async def test_failed_logins_in_different_capitals_lock_the_address_together(client):
    """Spelling an address differently cannot restart the count of failed sign-ins"""
    await _create_alice(client)
    spellings = [_STORED_EMAIL, _TYPED_EMAIL, _SHOUTED_EMAIL, _STORED_EMAIL, _TYPED_EMAIL]
    for spelling in spellings:
        resp = await client.post("/auth/login", json={"email": spelling, "password": "wrong-password"})
        assert resp.status_code == 401

    lockout = await _get_login_lockout(_STORED_EMAIL)
    assert lockout is not None
    assert lockout.failed_attempt_count == _ATTEMPTS_BEFORE_LOCK
    assert lockout.locked_until is not None


async def test_password_reset_with_other_capitals_sends_the_account_its_link(client):
    """Asking for a reset in capitals other than the sign-up's still starts one for the account"""
    body = await _create_alice(client)
    mailbox.sent.clear()

    resp = await client.post("/auth/password/forgot", json={"email": _SHOUTED_EMAIL})

    assert resp.status_code == 204
    query = select(PasswordResetToken).where(PasswordResetToken.user_id == uuid.UUID(body["user"]["id"]))
    async with TestSession() as session:
        tokens = (await session.execute(query)).scalars().all()
    assert len(tokens) == 1
    assert len(mailbox.sent_to(_STORED_EMAIL)) == 1
