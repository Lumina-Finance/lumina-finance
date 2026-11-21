"""Changing the account's email: asked for while signed in, confirmed from the new address"""

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import aiosmtplib
import pytest
from sqlalchemy import delete, func, select, update

from app.config.email_change import EMAIL_CHANGE_TOKEN_EXPIRE_SECONDS
from app.email_change_hook import EmailChange
from app.models.auth import EmailChangeRequest, PasswordCredential, PasswordResetToken
from app.services.auth import email_change
from app.services.auth.mfa_challenge import issue_reauth_stepup_proof
from tests.conftest import TestSession
from tests.routes.support import (
    SIGNUP_PAYLOAD,
    _assert_session_works,
    _count_sign_in_provider_links,
    _create_user,
    _get_auth_header,
    _get_login_lockout,
    _link_sign_in_providers,
    _seed_reset_token,
    _sign_in_again,
    sign_up_confirmed,
)
from tests.routes.support.auth_helpers import _refresh_session
from tests.routes.support.lock_helpers import _cancel_unfinished, _wait_until_waiting_on
from tests.routes.support.mailbox import mailbox

_CHANGE = "/auth/email/change"
_CONFIRM = "/auth/email/change/confirm"
_OLD_EMAIL = SIGNUP_PAYLOAD["email"]
_NEW_EMAIL = "new.address@example.com"
_PASSWORD = SIGNUP_PAYLOAD["password"]
_INVALID_LINK = "Invalid or expired confirmation link"


async def _request_change(client, auth, new_email: str = _NEW_EMAIL, *, password: str = _PASSWORD):
    """Ask for the new address, stepping up with the account's password"""
    return await client.post(_CHANGE, headers=auth, json={"new_email": new_email, "step_up": {"password": password}})


async def _confirm(client, token: str):
    """Open the emailed link, as a person does with or without a session"""
    return await client.post(_CONFIRM, json={"token": token})


async def _sign_in(client, email: str, password: str = _PASSWORD):
    """Try to sign in with the address"""
    return await client.post("/auth/login", json={"email": email, "password": password})


async def _signed_up_and_requested(client) -> tuple[dict, str, str]:
    """Sign the default user up and ask for the new address, returning their auth header, user id and the emailed token"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    assert (await _request_change(client, auth)).status_code == 204
    return auth, signup.json()["user"]["id"], mailbox.confirmation_token(_NEW_EMAIL)


async def _stored_requests() -> list[EmailChangeRequest]:
    """Return every pending email change request"""
    async with TestSession() as session:
        return list((await session.scalars(select(EmailChangeRequest))).all())


async def _drop_password(user_id: str) -> None:
    """Make the account passwordless, as one created through a sign-in provider is"""
    async with TestSession() as session:
        await session.execute(delete(PasswordCredential).where(PasswordCredential.user_id == uuid.UUID(user_id)))
        await session.commit()


async def _fresh_provider_proof(user_id: str) -> str:
    """Return the proof a fresh provider reauthentication gives the account"""
    async with TestSession() as session:
        return await issue_reauth_stepup_proof(session, uuid.UUID(user_id))


async def _live_reset_tokens(user_id: str) -> list[PasswordResetToken]:
    """Return the account's reset links that would still be accepted"""
    async with TestSession() as session:
        live = select(PasswordResetToken).where(
            PasswordResetToken.user_id == uuid.UUID(user_id),
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > func.now(),
        )
        return list((await session.scalars(live)).all())


@dataclass
class _HeldConfirmation:
    """The first confirmation, paused once its writes are made and before its commit, until released"""

    held: asyncio.Event = field(default_factory=asyncio.Event)
    release: asyncio.Event = field(default_factory=asyncio.Event)
    pid: int | None = None


def _hold_first_confirmation(monkeypatch) -> _HeldConfirmation:
    """Pause the first confirmation as it ends the account's sessions, its last step before the commit

    By then it holds every lock it takes, so a request that must wait for the change queues behind it
    """
    hold = _HeldConfirmation()
    end_sessions = email_change.delete_all_user_auth_sessions

    async def pause_then_end_sessions(db, user_id):
        if hold.pid is None:
            hold.pid = await db.scalar(select(func.pg_backend_pid()))
            hold.held.set()
            await hold.release.wait()
        await end_sessions(db, user_id)

    monkeypatch.setattr(email_change, "delete_all_user_auth_sessions", pause_then_end_sessions)
    return hold


async def _confirm_while_queueing(client, hold: _HeldConfirmation, token: str, queued):
    """Confirm the link, start the queued request once the confirmation is held, and release it once that request waits on it

    Returns:
        The confirmation's response and the queued request's response
    """
    confirming = asyncio.create_task(_confirm(client, token))
    requests = [confirming]
    try:
        async with asyncio.timeout(10):
            await hold.held.wait()
            waiting = asyncio.create_task(queued())
            requests.append(waiting)
            await _wait_until_waiting_on(hold.pid, waiting)
            hold.release.set()
            return await confirming, await waiting
    finally:
        hold.release.set()
        await _cancel_unfinished(requests)


async def test_following_the_emailed_link_shows_the_new_address_after_logging_in(client):
    """The link goes to the new address only, and once confirmed the account signs in with it and shows it"""
    _, _, token = await _signed_up_and_requested(client)
    assert mailbox.sent_to(_OLD_EMAIL) == [], "nothing goes to the old address until the change is confirmed"

    confirmed = await _confirm(client, token)

    assert confirmed.status_code == 200
    assert confirmed.json() == {"email": _NEW_EMAIL}
    login = await _sign_in(client, _NEW_EMAIL)
    assert login.status_code == 200
    me = await client.get("/me", headers=_get_auth_header(login))
    assert me.json()["email"] == _NEW_EMAIL


async def test_a_request_never_confirmed_leaves_the_old_address_and_sign_in_unchanged(client):
    """Asking is not changing: the account keeps its address and signs in as before until the link is opened"""
    await _signed_up_and_requested(client)

    old = await _sign_in(client, _OLD_EMAIL)
    new = await _sign_in(client, _NEW_EMAIL)

    assert old.status_code == 200
    assert (await client.get("/me", headers=_get_auth_header(old))).json()["email"] == _OLD_EMAIL
    assert new.status_code == 401


async def test_after_confirmation_the_old_address_no_longer_signs_in(client):
    """The account has one address, so the old one is refused like any address with no account"""
    _, _, token = await _signed_up_and_requested(client)
    await _confirm(client, token)

    old = await _sign_in(client, _OLD_EMAIL)

    assert old.status_code == 401
    assert old.json()["detail"] == "Invalid credentials"


@pytest.mark.parametrize("taken_spelling", ["taken@example.com", "TAKEN@example.com"])
async def test_an_address_another_account_uses_gets_the_same_answer_and_no_email(client, taken_spelling):
    """A free address and a taken one, in any capitals, answer alike, so the endpoint never says which addresses have accounts"""
    auth = _get_auth_header(await _create_user(client))
    await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "taken@example.com"})
    free = await _request_change(client, auth, "free@example.com")
    assert len(mailbox.sent_to("free@example.com")) == 1
    mailbox.sent.clear()

    taken = await _request_change(client, auth, taken_spelling)

    assert (taken.status_code, taken.content) == (free.status_code, free.content)
    assert set(taken.headers) == set(free.headers)
    assert mailbox.sent == [], "nothing is sent to an address another account uses"
    assert [row.new_email for row in await _stored_requests()] == [taken_spelling], "the request stores the same row either way"


async def test_changing_only_the_capitals_of_the_address_is_a_change(client):
    """The address belongs to the account itself in other capitals, so it is free and the link is sent"""
    auth = _get_auth_header(await _create_user(client))
    shouted = "TEST@example.com"

    assert (await _request_change(client, auth, shouted)).status_code == 204
    confirmed = await _confirm(client, mailbox.confirmation_token(shouted))

    assert confirmed.json() == {"email": shouted}
    login = await _sign_in(client, shouted)
    assert (await client.get("/me", headers=_get_auth_header(login))).json()["email"] == shouted


async def test_the_address_the_account_already_has_is_refused_before_the_step_up_is_spent(client):
    """The same spelling changes nothing, so it is refused without counting a wrong password toward the lockout"""
    auth = _get_auth_header(await _create_user(client))

    resp = await _request_change(client, auth, _OLD_EMAIL, password="WrongPassword123!")

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Enter a different email address"
    assert await _get_login_lockout(_OLD_EMAIL) is None
    assert mailbox.sent == []


@pytest.mark.parametrize(
    ("step_up", "detail"),
    [(None, "Reauthentication required"), ({"password": "WrongPassword123!"}, "Invalid credentials")],
    ids=["missing", "wrong password"],
)
async def test_without_the_step_up_nothing_is_stored_or_sent(client, step_up, detail):
    """A signed-in session alone cannot redirect the account's recovery mail"""
    auth = _get_auth_header(await _create_user(client))

    resp = await client.post(_CHANGE, headers=auth, json={"new_email": _NEW_EMAIL, "step_up": step_up})

    assert resp.status_code == 401
    assert resp.json()["detail"] == detail
    assert mailbox.sent == []
    assert await _stored_requests() == []


async def test_asking_without_a_session_is_refused(client):
    """Only a signed-in account can ask"""
    await _create_user(client)

    resp = await client.post(_CHANGE, json={"new_email": _NEW_EMAIL, "step_up": {"password": _PASSWORD}})

    assert resp.status_code == 401


async def test_a_passwordless_account_asks_with_a_fresh_provider_proof_that_works_once(client):
    """With no password to send, the proof of a fresh provider sign-in authorizes one request"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    user_id = signup.json()["user"]["id"]
    await _link_sign_in_providers(uuid.UUID(user_id), 1)
    await _drop_password(user_id)
    body = {"new_email": _NEW_EMAIL}

    refused = await client.post(_CHANGE, headers=auth, json=body)
    assert refused.status_code == 401
    assert refused.json()["detail"] == "Reauthentication required"
    assert mailbox.sent == []

    proof = await _fresh_provider_proof(user_id)
    client.cookies.set("oidc_reauth_stepup", proof)
    accepted = await client.post(_CHANGE, headers=auth, json=body)
    assert accepted.status_code == 204
    assert len(mailbox.sent_to(_NEW_EMAIL)) == 1

    client.cookies.set("oidc_reauth_stepup", proof)
    replayed = await client.post(_CHANGE, headers=auth, json=body)
    assert replayed.status_code == 401


async def test_the_link_works_once(client):
    """A second use of the same link is refused, and so is a guess"""
    _, _, token = await _signed_up_and_requested(client)
    assert (await _confirm(client, token)).status_code == 200

    reused = await _confirm(client, token)
    guessed = await _confirm(client, "not-a-token")

    for refused in (reused, guessed):
        assert refused.status_code == 400
        assert refused.json()["detail"] == _INVALID_LINK


async def test_two_simultaneous_confirmations_change_the_address_once(client):
    """Of two people opening the same link at once, one gets the change and the other the refusal"""
    _, _, token = await _signed_up_and_requested(client)

    responses = await asyncio.gather(_confirm(client, token), _confirm(client, token))

    assert sorted(response.status_code for response in responses) == [200, 400]
    assert {response.json().get("detail") for response in responses if response.status_code == 400} == {_INVALID_LINK}
    assert (await _sign_in(client, _NEW_EMAIL)).status_code == 200


@pytest.mark.parametrize(("seconds_left", "status_code"), [(-1, 400), (60, 200)])
async def test_the_link_stops_working_when_it_expires(client, seconds_left, status_code):
    """A link a minute from its end still works, and one past it is refused like any other bad link"""
    _, _, token = await _signed_up_and_requested(client)
    async with TestSession() as session:
        await session.execute(update(EmailChangeRequest).values(expires_at=datetime.now(UTC) + timedelta(seconds=seconds_left)))
        await session.commit()

    resp = await _confirm(client, token)

    assert resp.status_code == status_code
    if status_code == 400:
        assert resp.json()["detail"] == _INVALID_LINK
        assert (await _sign_in(client, _OLD_EMAIL)).status_code == 200


async def test_a_new_request_replaces_the_pending_one(client):
    """The account has one pending request, so the link of an earlier one is dead"""
    auth, _, first_token = await _signed_up_and_requested(client)
    assert (await _request_change(client, auth, "second.choice@example.com")).status_code == 204
    second_token = mailbox.confirmation_token("second.choice@example.com")

    assert len(await _stored_requests()) == 1
    stale = await _confirm(client, first_token)
    assert stale.status_code == 400
    assert stale.json()["detail"] == _INVALID_LINK
    assert (await _confirm(client, second_token)).json() == {"email": "second.choice@example.com"}


async def test_an_address_taken_between_the_request_and_the_link_is_refused_and_changes_nothing(client):
    """Another account can register the address while the link waits, and the refusal looks like any other bad link"""
    auth, user_id, token = await _signed_up_and_requested(client)
    reset_token = await _seed_reset_token(uuid.UUID(user_id))
    await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "New.Address@example.com"})

    resp = await _confirm(client, token)

    assert resp.status_code == 400
    assert resp.json()["detail"] == _INVALID_LINK
    assert await _stored_requests() == [], "the refused link is spent"
    assert (await client.get("/me", headers=auth)).json()["email"] == _OLD_EMAIL
    await _assert_session_works(client, (auth, ""))
    assert (await client.post("/auth/password/reset/check", json={"token": reset_token})).status_code == 200, "a refused change ends nothing"


async def test_confirming_ends_every_session_of_the_account_and_no_other_users(client):
    """Whoever opens the link, every device of the account is signed out, the requester's included"""
    signup = await _create_user(client)
    requester = (_get_auth_header(signup), signup.cookies["refresh_token"])
    other_device = await _sign_in_again(client)
    bystander_signup = await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "bystander@example.com"})
    bystander = (_get_auth_header(bystander_signup), bystander_signup.cookies["refresh_token"])
    assert (await _request_change(client, requester[0])).status_code == 204

    assert (await _confirm(client, mailbox.confirmation_token(_NEW_EMAIL))).status_code == 200

    for ended in (requester, other_device):
        assert (await client.get("/auth/2fa/status", headers=ended[0])).status_code == 401, "the access token is refused"
        assert (await _refresh_session(client, ended[1])).status_code == 401, "the session cannot refresh"
    await _assert_session_works(client, bystander)
    assert (await _refresh_session(client, bystander[1])).status_code == 200


async def test_confirming_ends_the_unused_password_reset_links_of_the_account_only(client):
    """A reset link emailed to the old address must not sign anyone in once the address has moved on"""
    _, user_id, token = await _signed_up_and_requested(client)
    old_mailbox_link = await _seed_reset_token(uuid.UUID(user_id))
    bystander = await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "bystander@example.com"})
    bystander_link = await _seed_reset_token(uuid.UUID(bystander.json()["user"]["id"]), "bystander-reset-token")

    await _confirm(client, token)

    dead = await client.post("/auth/password/reset/check", json={"token": old_mailbox_link})
    assert dead.status_code == 400
    assert dead.json()["detail"] == "Invalid or expired reset token"
    assert (await client.post("/auth/password/reset/check", json={"token": bystander_link})).status_code == 200


async def test_confirm_with_a_reset_request_for_the_old_address_at_once_sends_it_no_working_link(client, monkeypatch):
    """A reset request for the old address arriving mid-change waits for the change, then finds no account to send a link for"""
    _, user_id, token = await _signed_up_and_requested(client)
    hold = _hold_first_confirmation(monkeypatch)

    async def request_reset_for_old_address():
        return await client.post("/auth/password/forgot", json={"email": _OLD_EMAIL})

    confirmed, reset = await _confirm_while_queueing(client, hold, token, request_reset_for_old_address)

    assert (confirmed.status_code, reset.status_code) == (200, 204)
    reset_mails = [sent for sent in mailbox.sent_to(_OLD_EMAIL) if "/reset-password?token=" in sent.message.text_body]
    assert reset_mails == [], "the old mailbox is sent no reset link once the change commits"
    assert await _live_reset_tokens(user_id) == [], "the account has no reset link that would still be accepted"


async def test_confirming_clears_the_sign_in_lockout_of_both_addresses(client):
    """Failures counted against either address before the change do not lock the account out of the new one"""
    _, _, token = await _signed_up_and_requested(client)
    await _sign_in(client, _OLD_EMAIL, "WrongPassword123!")
    await _sign_in(client, _NEW_EMAIL, "WrongPassword123!")
    assert await _get_login_lockout(_OLD_EMAIL) is not None
    assert await _get_login_lockout(_NEW_EMAIL) is not None

    await _confirm(client, token)

    assert await _get_login_lockout(_OLD_EMAIL) is None
    assert await _get_login_lockout(_NEW_EMAIL) is None


async def test_confirming_keeps_the_accounts_linked_sign_in_providers(client):
    """A provider identity is keyed by its subject, so it keeps signing the account in under the new address"""
    _, user_id, token = await _signed_up_and_requested(client)
    await _link_sign_in_providers(uuid.UUID(user_id), 1)

    await _confirm(client, token)

    assert await _count_sign_in_provider_links(uuid.UUID(user_id)) == (1, 1)


async def test_the_emails_say_only_what_each_recipient_needs(client):
    """The new address gets the link and how long it works, and the old address learns of the change afterwards with no link"""
    _, _, token = await _signed_up_and_requested(client)
    (confirmation,) = mailbox.sent_to(_NEW_EMAIL)
    assert confirmation.message.subject == "Confirm your new email"
    assert f"/confirm-new-email?token={token}" in confirmation.message.text_body
    assert f"{EMAIL_CHANGE_TOKEN_EXPIRE_SECONDS // 60} minutes" in confirmation.message.text_body
    assert _OLD_EMAIL not in confirmation.message.text_body + (confirmation.message.html_body or "")
    (stored,) = await _stored_requests()
    assert (
        timedelta(seconds=EMAIL_CHANGE_TOKEN_EXPIRE_SECONDS - 60)
        < stored.expires_at - datetime.now(UTC)
        <= timedelta(seconds=EMAIL_CHANGE_TOKEN_EXPIRE_SECONDS)
    )

    await _confirm(client, token)

    (notice,) = mailbox.sent_to(_OLD_EMAIL)
    assert notice.message.subject == "Your email was changed"
    for body in (notice.message.text_body, notice.message.html_body or ""):
        assert _NEW_EMAIL in body
        assert "http" not in body, "the notice has no link to act on"


async def test_observers_hear_of_the_confirmed_change_and_only_then(client, email_changes):
    """Code outside the app is told once the change is saved, with both addresses and the account"""
    _, user_id, token = await _signed_up_and_requested(client)
    assert email_changes == []

    await _confirm(client, token)
    await _confirm(client, token)

    assert email_changes == [EmailChange(user_id=uuid.UUID(user_id), old_email=_OLD_EMAIL, new_email=_NEW_EMAIL)]


async def test_a_failed_confirmation_send_is_logged_by_class_and_keeps_the_request(client, caplog, monkeypatch):
    """The mail library's error quotes the address, so only its class is logged, and the answer is the one a working send gives"""
    auth = _get_auth_header(await _create_user(client))
    error = aiosmtplib.SMTPRecipientsRefused([aiosmtplib.SMTPRecipientRefused(550, "Mailbox unavailable", _NEW_EMAIL)])
    assert _NEW_EMAIL in str(error), "the error carries the address, so only the log decides whether it leaks"

    async def refuse(recipient, message):
        raise error

    monkeypatch.setattr(mailbox, "send", refuse)
    with caplog.at_level(logging.DEBUG):
        resp = await _request_change(client, auth)

    assert resp.status_code == 204
    assert "SMTPRecipientsRefused" in caplog.text
    assert _NEW_EMAIL not in caplog.text
    assert len(await _stored_requests()) == 1, "a failed send must not change what a repeated request shows"


async def test_a_failed_notice_is_logged_by_class_and_the_change_still_stands(client, caplog, monkeypatch):
    """The old mailbox may be gone, and that must not undo the change or put either address in the log"""
    _, _, token = await _signed_up_and_requested(client)
    error = aiosmtplib.SMTPRecipientsRefused([aiosmtplib.SMTPRecipientRefused(550, "Mailbox unavailable", _OLD_EMAIL)])

    async def refuse(recipient, message):
        raise error

    monkeypatch.setattr(mailbox, "send", refuse)
    with caplog.at_level(logging.DEBUG):
        resp = await _confirm(client, token)

    assert resp.status_code == 200
    assert "SMTPRecipientsRefused" in caplog.text
    for address in (_OLD_EMAIL, _NEW_EMAIL):
        assert address not in caplog.text
    assert (await _sign_in(client, _NEW_EMAIL)).status_code == 200
