"""Sign-up check tests: an installed check decides who is emailed, and a refusal looks like any other sign-up"""

import asyncio
import logging

import pytest
from sqlalchemy import func as sa_func
from sqlalchemy import select

from app import signup_check_hook
from app.models.auth import SignupEmailSend
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _seed_currency, sign_up_confirmed

_PROFILE = {key: value for key, value in SIGNUP_PAYLOAD.items() if key != "password"}
_NEW_EMAIL = "new-person@example.com"


@pytest.fixture
def install_check(monkeypatch):
    """Return a function installing a check for this test alone, and the addresses each check was asked about"""
    asked: list[str] = []

    def install(answer):
        """Install a check that records the address and returns what answer(email) gives"""

        async def check(attempt: signup_check_hook.SignupAttempt):
            asked.append(attempt.email)
            return await answer(attempt.email)

        monkeypatch.setattr(signup_check_hook, "_check", check)
        return asked

    return install


async def _allow(email: str) -> bool:
    return True


async def _refuse(email: str) -> bool:
    return False


async def _send_record_count() -> int:
    """Return how many sign-up sends count against any address"""
    async with TestSession() as session:
        return await session.scalar(select(sa_func.count()).select_from(SignupEmailSend))


async def test_sign_up_with_no_check_installed_sends_the_confirmation_email(client, captured_email):
    """With no check installed, everyone can sign up as before"""
    await _seed_currency()

    resp = await client.post("/auth/signup", json=_PROFILE)

    assert resp.status_code == 204
    assert len(captured_email.sent_to(_PROFILE["email"])) == 1


async def test_sign_up_the_check_refuses_answers_as_usual_and_sends_nothing(client, captured_email, install_check):
    """A refused sign-up gets the usual answer and no email, and the check was asked about the address"""
    await _seed_currency()
    asked = install_check(_refuse)

    resp = await client.post("/auth/signup", json=_PROFILE)

    assert resp.status_code == 204
    assert captured_email.sent == []
    assert asked == [_PROFILE["email"]]


async def test_sign_up_the_check_allows_sends_the_confirmation_email(client, captured_email, install_check):
    """The check's answer decides, not whether one is installed"""
    await _seed_currency()
    install_check(_allow)

    resp = await client.post("/auth/signup", json=_PROFILE)

    assert resp.status_code == 204
    assert len(captured_email.sent_to(_PROFILE["email"])) == 1


async def _answer_text(email: str):
    return "yes"


async def _answer_none(email: str):
    return None


async def _take_too_long(email: str) -> bool:
    await asyncio.sleep(1)
    return True


@pytest.mark.parametrize(
    ("answer", "logged"),
    [(_answer_text, "answered a str"), (_answer_none, "answered a NoneType"), (_take_too_long, "TimeoutError")],
    ids=["text", "none", "too-slow"],
)
async def test_sign_up_the_check_does_not_clearly_allow_sends_nothing(
    client, captured_email, install_check, monkeypatch, caplog, answer, logged
):
    """Only a plain True allows, a check slower than its time limit refuses, and each refusal says why in the log"""
    await _seed_currency()
    monkeypatch.setattr(signup_check_hook, "SIGNUP_CHECK_TIMEOUT_SECONDS", 0.05)
    install_check(answer)

    with caplog.at_level(logging.WARNING, logger=signup_check_hook.__name__):
        resp = await client.post("/auth/signup", json=_PROFILE)

    assert resp.status_code == 204
    assert captured_email.sent == []
    assert logged in caplog.text


async def test_sign_up_the_check_fails_on_sends_nothing_and_logs_no_address(client, captured_email, install_check, caplog):
    """A failing check refuses rather than letting everyone in, and its error text never reaches the log"""
    await _seed_currency()

    async def fail(email: str) -> bool:
        raise RuntimeError(f"lookup failed for {email}")

    install_check(fail)

    with caplog.at_level(logging.WARNING, logger=signup_check_hook.__name__):
        resp = await client.post("/auth/signup", json=_PROFILE)

    assert resp.status_code == 204
    assert captured_email.sent == []
    assert "RuntimeError" in caplog.text
    assert _PROFILE["email"] not in caplog.text


async def test_refused_sign_ups_take_the_same_path_for_registered_and_new_addresses(client, captured_email, install_check):
    """The check is asked about every address, and each refused sign-up leaves one send record as a registered one does"""
    await _seed_currency()
    await sign_up_confirmed(client, SIGNUP_PAYLOAD)
    captured_email.sent.clear()
    asked = install_check(_refuse)
    records_before = await _send_record_count()

    registered = await client.post("/auth/signup", json=_PROFILE)
    new = await client.post("/auth/signup", json={**_PROFILE, "email": _NEW_EMAIL})

    assert (registered.status_code, new.status_code) == (204, 204)
    assert asked == [_PROFILE["email"], _NEW_EMAIL], "the check must be asked whether or not the address has an account"
    assert await _send_record_count() == records_before + 2, "a refused sign-up must do the work an allowed one does"
    assert captured_email.sent == []
