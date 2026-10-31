"""Sign-in and password reset find an account whatever capitals the email is typed in"""

import uuid

import pytest
from sqlalchemy import select, text

from app.config.registration import SIGNUP_DAILY_EMAIL_LIMIT
from app.models.auth import PasswordResetToken
from app.services.auth.user_lookup import fold_email
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _get_auth_header, _get_login_lockout, _seed_currency, sign_up_confirmed
from tests.routes.support.mailbox import mailbox

_STORED_EMAIL = "Alice@example.com"
_TYPED_EMAIL = "alice@example.com"
_SHOUTED_EMAIL = "ALICE@example.com"
_ASCII_EMAIL = "info@example.com"
_DOTTED_I_EMAIL = "İnfo@example.com"
_PASSWORD = SIGNUP_PAYLOAD["password"]
_ATTEMPTS_BEFORE_LOCK = 5


async def _create_account(client, email: str):
    """Sign up an account with the address and return its confirmation response"""
    await _seed_currency()
    signup = await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": email})
    assert signup.status_code == 201
    return signup


async def _create_alice(client) -> dict:
    """Sign up the account whose address is stored with a capital A and return the confirmation body"""
    return (await _create_account(client, _STORED_EMAIL)).json()


@pytest.mark.parametrize(
    "email", ["ALICE@Example.COM", "İnfo@example.com", "Émile@example.com", "\u212aelvin@example.com", "STRAßE@example.com"]
)
async def test_python_and_the_database_fold_an_address_alike(email):
    """A fold that differs from the lookup's would give one account two lockout counts"""
    async with TestSession() as session:
        folded = await session.scalar(text('SELECT lower(CAST(:email AS text) COLLATE "C")'), {"email": email})

    assert fold_email(email) == folded


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

    # The recipient is compared exactly, since the link belongs to the stored mailbox, not the typed one
    assert [email.recipient for email in mailbox.sent] == [_STORED_EMAIL]


async def test_password_reset_for_a_dotted_capital_i_spelling_sends_no_link(client):
    """İnfo@ is another mailbox from info@, so asking for it never mails that account's live link there"""
    await _create_account(client, _ASCII_EMAIL)
    mailbox.sent.clear()

    resp = await client.post("/auth/password/forgot", json={"email": _DOTTED_I_EMAIL})

    assert resp.status_code == 204
    assert mailbox.sent == []
    async with TestSession() as session:
        tokens = (await session.execute(select(PasswordResetToken).where(PasswordResetToken.user_id.is_not(None)))).scalars().all()
    assert tokens == []


async def test_a_locked_account_cannot_be_reached_through_a_dotted_capital_i_spelling(client):
    """A spelling with its own counter must not reach the account, or the lockout gives no limit on guesses"""
    await _create_account(client, _ASCII_EMAIL)
    for _ in range(_ATTEMPTS_BEFORE_LOCK):
        resp = await client.post("/auth/login", json={"email": _ASCII_EMAIL, "password": "wrong-password"})
        assert resp.status_code == 401
    assert (await client.post("/auth/login", json={"email": _ASCII_EMAIL, "password": _PASSWORD})).status_code == 423

    resp = await client.post("/auth/login", json={"email": _DOTTED_I_EMAIL, "password": _PASSWORD})

    assert resp.status_code == 401


async def test_failures_on_a_dotted_capital_i_spelling_leave_the_account_signed_in(client):
    """Locking out an address that isn't the account's must not revoke that account's sessions"""
    signup = await _create_account(client, _ASCII_EMAIL)
    auth = _get_auth_header(signup)
    for _ in range(_ATTEMPTS_BEFORE_LOCK):
        await client.post("/auth/login", json={"email": _DOTTED_I_EMAIL, "password": "wrong-password"})
    assert (await _get_login_lockout(_DOTTED_I_EMAIL)).locked_until is not None

    assert (await client.get("/test/me", headers=auth)).status_code == 200
    assert await _get_login_lockout(_ASCII_EMAIL) is None


async def test_the_sign_up_email_cap_counts_capitals_beyond_a_to_z_apart(client):
    """Émile@ and émile@ can be two accounts, so filling the cap on one leaves the other able to sign up"""
    await _seed_currency()
    for _ in range(SIGNUP_DAILY_EMAIL_LIMIT):
        await client.post("/auth/signup", json={**SIGNUP_PAYLOAD, "email": "Émile@example.com"})
    mailbox.sent.clear()

    await client.post("/auth/signup", json={**SIGNUP_PAYLOAD, "email": "émile@example.com"})

    assert [email.recipient for email in mailbox.sent] == ["émile@example.com"]


async def test_letters_beyond_a_to_z_keep_their_capitals_distinct(client):
    """Émile@ and émile@ are two addresses, so the second can have its own account and neither signs in as the other"""
    first = await _create_account(client, "Émile@example.com")

    refused = await client.post("/auth/login", json={"email": "émile@example.com", "password": _PASSWORD})
    second = await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "émile@example.com"})

    assert refused.status_code == 401
    assert second.status_code == 201
    assert second.json()["user"]["id"] != first.json()["user"]["id"]
