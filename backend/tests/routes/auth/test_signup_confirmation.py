"""Sign-up confirmation route tests: the same answer for every address, accounts only once confirmed"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from sqlalchemy import select

from app.config.jwt import JWT_ACCESS_PRIVATE_KEY, JWT_ALGORITHM, JWT_ISSUER
from app.models.auth import AuthIdentity, PasswordCredential
from app.models.user import User
from app.services.auth import registration
from app.services.auth.tokens import (
    SIGNUP_CONFIRMATION_TOKEN_USE,
    SignupConfirmationClaims,
    create_signup_confirmation_token,
)
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _seed_currency, sign_up_confirmed
from tests.routes.support.mailbox import mailbox

_PROFILE = {key: value for key, value in SIGNUP_PAYLOAD.items() if key != "password"}
_NEW_PASSWORD = "AnotherPassword456!"


def _link_token(email: str = SIGNUP_PAYLOAD["email"], *, minutes_to_expiry: int = 60, token_use: str = SIGNUP_CONFIRMATION_TOKEN_USE) -> str:
    """Return a signed confirmation token with an explicit lifetime and audience for edge-case tests"""
    issued_at = datetime.now(UTC)
    payload = {
        "email": email,
        "first_name": "Test",
        "last_name": None,
        "tz": "America/Toronto",
        "base_currency": "CAD",
        "token_use": token_use,
        "aud": token_use,
        "iat": issued_at,
        "exp": issued_at + timedelta(minutes=minutes_to_expiry),
        "iss": JWT_ISSUER,
    }
    return jwt.encode(payload, JWT_ACCESS_PRIVATE_KEY, algorithm=JWT_ALGORITHM)


async def _users() -> list[User]:
    """Return every user row"""
    async with TestSession() as session:
        return list((await session.execute(select(User))).scalars())


async def test_new_address_gets_a_confirmation_link_and_no_account(client):
    """A new address is emailed a confirmation link, and nothing works until the link is used"""
    await _seed_currency()
    resp = await client.post("/auth/signup", json=_PROFILE)

    assert resp.status_code == 204
    emails = mailbox.sent_to(_PROFILE["email"])
    assert len(emails) == 1
    assert "/confirm-email?token=" in emails[0].message.text_body
    assert await _users() == []

    login = await client.post("/auth/login", json={"email": _PROFILE["email"], "password": SIGNUP_PAYLOAD["password"]})
    assert login.status_code == 401


async def test_registered_address_gets_the_same_response_and_no_email(client):
    """A registered address answers exactly as a new one does, and nothing is sent to it"""
    await _seed_currency()
    new_address = await client.post("/auth/signup", json={**_PROFILE, "email": "new@example.com"})
    await sign_up_confirmed(client, SIGNUP_PAYLOAD)
    mailbox.sent.clear()

    registered = await client.post("/auth/signup", json=_PROFILE)

    assert (registered.status_code, registered.content) == (new_address.status_code, new_address.content)
    assert set(registered.headers) == set(new_address.headers)
    assert mailbox.sent == []

    # Nothing about the account changes: still one user, still signing in with the original password
    assert len(await _users()) == 1
    login = await client.post("/auth/login", json={"email": _PROFILE["email"], "password": SIGNUP_PAYLOAD["password"]})
    assert login.status_code == 200


async def test_an_email_that_fails_to_send_does_not_change_the_response(client, caplog, monkeypatch):
    """A broken mail server is logged, not shown, so it cannot tell addresses apart"""
    await _seed_currency()

    async def refuse(recipient, message):
        raise ConnectionError("mail server unreachable")

    monkeypatch.setattr(mailbox, "send", refuse)
    with caplog.at_level(logging.WARNING):
        resp = await client.post("/auth/signup", json=_PROFILE)

    assert resp.status_code == 204
    assert "Sign-up email failed to send" in caplog.text


async def test_confirming_creates_a_verified_account_with_the_password_chosen_at_confirmation(client):
    """Whoever opens the link chooses the password, so a password sent with the sign-up is ignored"""
    await _seed_currency()
    await client.post("/auth/signup", json={**_PROFILE, "password": "AttackerChosen123!"})
    token = mailbox.confirmation_token(_PROFILE["email"])

    resp = await client.post("/auth/signup/confirm", json={"token": token, "new_password": _NEW_PASSWORD})

    assert resp.status_code == 201
    assert resp.json()["user"]["email"] == _PROFILE["email"]
    assert resp.json()["access_token"]

    async with TestSession() as session:
        identity = (await session.execute(select(AuthIdentity))).scalar_one()
        assert identity.email_verified is True
        assert identity.email_verified_at is not None
        assert (await session.execute(select(PasswordCredential))).scalar_one()

    chosen = await client.post("/auth/login", json={"email": _PROFILE["email"], "password": _NEW_PASSWORD})
    sent_with_signup = await client.post("/auth/login", json={"email": _PROFILE["email"], "password": "AttackerChosen123!"})
    assert chosen.status_code == 200
    assert sent_with_signup.status_code == 401


async def test_a_link_works_once(client):
    """Using a link again answers like an invalid one, and the account keeps the first password"""
    await _seed_currency()
    await client.post("/auth/signup", json=_PROFILE)
    token = mailbox.confirmation_token(_PROFILE["email"])
    first = await client.post("/auth/signup/confirm", json={"token": token, "new_password": _NEW_PASSWORD})

    second = await client.post("/auth/signup/confirm", json={"token": token, "new_password": "ThirdPassword789!"})

    assert first.status_code == 201
    assert second.status_code == 400
    assert second.json()["detail"] == "Invalid or expired confirmation link"
    assert len(await _users()) == 1
    login = await client.post("/auth/login", json={"email": _PROFILE["email"], "password": _NEW_PASSWORD})
    assert login.status_code == 200


async def test_two_confirmations_of_one_link_create_one_account(client):
    """Concurrent uses of a link create one account, and the other answers like an invalid link"""
    await _seed_currency()
    await client.post("/auth/signup", json=_PROFILE)
    token = mailbox.confirmation_token(_PROFILE["email"])

    responses = await asyncio.gather(
        client.post("/auth/signup/confirm", json={"token": token, "new_password": _NEW_PASSWORD}),
        client.post("/auth/signup/confirm", json={"token": token, "new_password": "ThirdPassword789!"}),
    )

    assert sorted(response.status_code for response in responses) == [201, 400]
    assert len(await _users()) == 1


@pytest.mark.parametrize(
    "token",
    [
        pytest.param(_link_token(minutes_to_expiry=-1), id="expired"),
        pytest.param(_link_token(token_use="access"), id="another kind of token"),
        pytest.param("not-a-token", id="garbage"),
    ],
)
async def test_confirming_refuses_a_link_that_does_not_verify(client, token):
    """An expired, foreign or garbled link creates no account and gives the one generic message"""
    await _seed_currency()

    resp = await client.post("/auth/signup/confirm", json={"token": token, "new_password": _NEW_PASSWORD})

    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid or expired confirmation link"
    assert await _users() == []


async def test_confirming_for_an_address_registered_meanwhile_gives_the_invalid_link_answer(client):
    """A link for an address that gained an account since is refused, never touching the account"""
    await _seed_currency()
    await client.post("/auth/signup", json=_PROFILE)
    token = mailbox.confirmation_token(_PROFILE["email"])
    await sign_up_confirmed(client, SIGNUP_PAYLOAD)

    resp = await client.post("/auth/signup/confirm", json={"token": token, "new_password": _NEW_PASSWORD})

    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid or expired confirmation link"
    login = await client.post("/auth/login", json={"email": _PROFILE["email"], "password": SIGNUP_PAYLOAD["password"]})
    assert login.status_code == 200


async def test_confirming_after_registration_closes_creates_no_account(client, monkeypatch):
    """A link sent while registration was open is refused once it closes"""
    await _seed_currency()
    await client.post("/auth/signup", json=_PROFILE)
    token = mailbox.confirmation_token(_PROFILE["email"])
    monkeypatch.setattr(registration, "REGISTRATION_ENABLED", False)

    resp = await client.post("/auth/signup/confirm", json={"token": token, "new_password": _NEW_PASSWORD})

    assert resp.status_code == 403
    assert await _users() == []


def test_the_link_token_holds_only_the_profile_typed_at_signup():
    """The signed token carries the profile and no password, so nothing secret rides in the emailed URL"""
    token = create_signup_confirmation_token(SignupConfirmationClaims("a@example.com", "Ada", None, "America/Toronto", "CAD"))
    claims = jwt.decode(token, options={"verify_signature": False})

    assert {key for key in claims} == {"email", "first_name", "last_name", "tz", "base_currency", "token_use", "aud", "iat", "exp", "iss"}
