"""Deleting a profile with a waiting period set: scheduled, signed in to cancel only, cancelled or deleted once due"""

import re
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select, text, update

from app.main import app
from app.models.auth import EmailChangeRequest, PasswordResetToken
from app.models.auth_session import AuthSession
from app.models.bank_connection import BankConnection
from app.models.user import User
from app.services.email import contract as email_contract
from app.services.profile_deletion import delete_marked_profiles, removal
from app.services.profile_deletion import request as request_module
from tests.conftest import ScopedSession, TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _create_user, _get_auth_header, _seed_reset_token, _sign_in_again
from tests.routes.support.authorization_helpers import _commit_rejected_connection
from tests.routes.support.identity_helpers import _act_as
from tests.services.bank_sync.authorizing_provider import AuthorizingProviderAdapter
from tests.services.bank_sync.fake_provider import use_adapter

_PASSWORD = SIGNUP_PAYLOAD["password"]
_EMAIL = SIGNUP_PAYLOAD["email"]
_DELETE = "/auth/profile/delete"
_CANCEL = "/auth/profile/delete/cancel"
_SCHEDULED_DETAIL = "Your profile is scheduled for deletion"
_ALREADY_UNDER_WAY_DETAIL = "Your profile is already being deleted, so the deletion can no longer be cancelled"
_WAIT = timedelta(days=7)


@pytest.fixture
def authorizing_provider(no_bank_provider, monkeypatch) -> AuthorizingProviderAdapter:
    """Install the scripted provider that records each access it is given back, as the only provider"""
    adapter = AuthorizingProviderAdapter()
    use_adapter(monkeypatch, adapter)
    return adapter


async def _stored_user(user_id: uuid.UUID) -> User | None:
    """The user row as stored, or None once it is gone"""
    async with TestSession() as session:
        return await session.get(User, user_id)


async def _set_due(user_id: uuid.UUID, due_at: datetime) -> None:
    """Move the due time of a marked profile, such as to the past once the wait is over"""
    async with TestSession() as session:
        await session.execute(update(User).where(User.id == user_id).values(deletion_due_at=due_at))
        await session.commit()


async def _request_deletion(client) -> tuple[uuid.UUID, dict]:
    """Sign a user up and ask to delete their profile, returning the user and the session the request ended"""
    signup = await _create_user(client)
    headers = _get_auth_header(signup)
    response = await client.post(_DELETE, headers=headers, json={"password": _PASSWORD})
    assert response.status_code == 200, response.text
    return uuid.UUID(signup.json()["user"]["id"]), headers


async def _sign_in_while_waiting(client) -> dict:
    """Sign in the waiting user again and return that session's auth header"""
    login = await client.post("/auth/login", json={"email": _EMAIL, "password": _PASSWORD})
    assert login.status_code == 200, login.text
    return _get_auth_header(login)


async def _due_connection_ids() -> set[uuid.UUID]:
    """The connections the worker's due scan finds, as it reads them with no request identity"""
    async with _act_as(None) as worker:
        due = await worker.execute(text("SELECT connection_id FROM public.list_due_bank_connections(now())"))
        return {row.connection_id for row in due}


async def test_delete_with_a_wait_marks_the_profile_and_keeps_everything_else(
    client, profile_deletion_wait, freeze_now, sent_action_emails, authorizing_provider, profile_deletions
):
    """The request marks the profile with its due time, ends every session and emailed link, keeps connections and data, and emails the date"""
    profile_deletion_wait(_WAIT)
    # 03:00 UTC is still the evening before in Toronto, where the profile is, so the date is told in its zone
    requested_at = datetime(2026, 12, 1, 3, 0, tzinfo=UTC)
    freeze_now(request_module, requested_at)
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    headers = _get_auth_header(signup)
    other_device = await _sign_in_again(client)
    await _seed_reset_token(user_id)
    changed = await client.post(
        "/auth/email/change", headers=headers, json={"new_email": "new.address@example.com", "step_up": {"password": _PASSWORD}}
    )
    assert changed.status_code == 204, changed.text
    connection = await _commit_rejected_connection(user_id, rejected=False)
    sent_action_emails.clear()

    response = await client.post(_DELETE, headers=headers, json={"password": _PASSWORD})

    assert response.status_code == 200, response.text
    assert datetime.fromisoformat(response.json()["deletion_due_at"]) == requested_at + _WAIT, "the answer names the due time"
    assert 'refresh_token=""' in response.headers["set-cookie"], "the refresh cookie is cleared"
    user = await _stored_user(user_id)
    assert user is not None, "the profile is still there"
    assert user.deletion_requested_at == requested_at, "the profile is marked"
    assert user.deletion_due_at == requested_at + _WAIT, "the due time is the wait after the request"
    assert user.deletion_reminder_sent_at is None, "no reminder has gone"
    async with TestSession() as session:
        for model in (AuthSession, PasswordResetToken, EmailChangeRequest):
            assert await session.scalar(select(func.count()).select_from(model).where(model.user_id == user_id)) == 0, model.__name__
        assert await session.get(BankConnection, connection.id) is not None, "the bank connection stays"
    assert authorizing_provider.released == [], "no access is given back"
    for device in (headers, other_device[0]):
        assert (await client.get("/auth/2fa/status", headers=device)).status_code == 401, "every session has ended"
    assert profile_deletions == [], "nothing is deleted yet"
    assert [(recipient, message.subject) for recipient, message in sent_action_emails] == [
        (_EMAIL, "Your profile will be deleted on 7 December 2026")
    ]
    body = sent_action_emails[0][1].text_body
    assert "7 December 2026" in body and "Please sign in and cancel before then." in body


async def test_delete_with_no_wait_deletes_at_once_and_sends_no_email(client, sent_action_emails, profile_deletions):
    """With no wait set the profile goes as it always has, with no due time and no email, and no reminder or done email follows"""
    sent_action_emails.clear()
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])

    response = await client.post(_DELETE, headers=_get_auth_header(signup), json={"password": _PASSWORD})

    assert response.status_code == 200, response.text
    assert response.json() == {"deletion_due_at": None}
    assert await _stored_user(user_id) is None
    assert [deletion.user_id for deletion in profile_deletions] == [user_id]
    assert sent_action_emails == []


async def test_a_waiting_profile_signs_in_and_renews_but_a_route_refuses_it(client, profile_deletion_wait):
    """Sign-in and renewal give a session while the wait lasts, it carries the due date, and a route refuses it as marked"""
    profile_deletion_wait(_WAIT)
    user_id, _ = await _request_deletion(client)

    login = await client.post("/auth/login", json={"email": _EMAIL, "password": _PASSWORD})
    assert login.status_code == 200, login.text
    stored = await _stored_user(user_id)
    assert datetime.fromisoformat(login.json()["user"]["deletion_due_at"]) == stored.deletion_due_at, "the sign-in tells the client the date"
    headers = _get_auth_header(login)

    refused = await client.get("/auth/2fa/status", headers=headers)
    assert refused.status_code == 403
    assert refused.json()["detail"] == _SCHEDULED_DETAIL

    renewal = await client.post("/auth/refresh")
    assert renewal.status_code == 200, "the session renews while the wait lasts"
    assert renewal.json()["user"]["deletion_due_at"] is not None


async def test_every_route_that_authenticates_a_user_refuses_a_marked_profile(client, profile_deletion_wait):
    """No route behind the authenticated-user check answers a marked profile, however it is called, so a session from the wait is read-only"""
    profile_deletion_wait(_WAIT)
    await _request_deletion(client)
    headers = await _sign_in_while_waiting(client)

    # Every operation asking for a bearer token is behind the authenticated-user check. Logout takes the
    # token if there is one and no user, and cancel is the one route a marked profile reaches
    signed_in = [
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method, operation in operations.items()
        if operation.get("security")
    ]
    behind_the_check = [route for route in signed_in if route not in {("POST", "/auth/logout"), ("POST", _CANCEL)}]

    assert len(behind_the_check) > 20, "the routes behind the check were found"
    assert ("POST", _CANCEL) in signed_in, "cancel asks for a token too, so it is left out by name"
    for method, path in behind_the_check:
        response = await client.request(method, re.sub(r"\{[^}]+\}", str(uuid.uuid4()), path), headers=headers)
        assert (response.status_code, response.json().get("detail")) == (403, _SCHEDULED_DETAIL), f"{method} {path}"


async def test_cancel_clears_the_mark_and_sync_resumes_for_the_connections(client, profile_deletion_wait, authorizing_provider):
    """Cancelling answers with the user, clears all three columns, and puts the untouched connections back in the due scan"""
    profile_deletion_wait(_WAIT)
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    connection = await _commit_rejected_connection(user_id, rejected=False)
    async with TestSession() as session:
        await session.execute(
            update(BankConnection)
            .where(BankConnection.id == connection.id)
            .values(next_sync_at=datetime.now(UTC) - timedelta(hours=1), discovered_at=datetime.now(UTC) - timedelta(days=1))
        )
        await session.commit()
    assert connection.id in await _due_connection_ids(), "the connection is due before the request"
    response = await client.post(_DELETE, headers=_get_auth_header(signup), json={"password": _PASSWORD})
    assert response.status_code == 200, response.text
    assert connection.id not in await _due_connection_ids(), "sync pauses while the deletion waits"
    async with TestSession() as session:
        await session.execute(update(User).where(User.id == user_id).values(deletion_reminder_sent_at=datetime.now(UTC)))
        await session.commit()
    headers = await _sign_in_while_waiting(client)

    cancelled = await client.post(_CANCEL, headers=headers)

    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["deletion_due_at"] is None
    assert cancelled.json()["email"] == _EMAIL
    user = await _stored_user(user_id)
    assert (user.deletion_requested_at, user.deletion_due_at, user.deletion_reminder_sent_at) == (None, None, None)
    assert connection.id in await _due_connection_ids(), "sync resumes"
    assert (await client.get("/auth/2fa/status", headers=headers)).status_code == 200, "the session works as any other"


async def test_cancel_after_the_due_time_is_refused_and_the_profile_stays_marked(client, profile_deletion_wait):
    """A session made during the wait is told why a cancel came too late once the due time has passed, and sign-in is refused too"""
    profile_deletion_wait(_WAIT)
    user_id, _ = await _request_deletion(client)
    headers = await _sign_in_while_waiting(client)
    refresh_cookie = client.cookies["refresh_token"]
    await _set_due(user_id, datetime.now(UTC) - timedelta(minutes=1))

    cancelled = await client.post(_CANCEL, headers=headers)
    sign_in = await client.post("/auth/login", json={"email": _EMAIL, "password": _PASSWORD})
    client.cookies.set("refresh_token", refresh_cookie)
    renewal = await client.post("/auth/refresh")

    assert (cancelled.status_code, cancelled.json()["detail"]) == (409, _ALREADY_UNDER_WAY_DETAIL)
    assert (sign_in.status_code, sign_in.json()["detail"]) == (401, "Invalid credentials")
    assert renewal.status_code == 401
    assert (await _stored_user(user_id)).deletion_requested_at is not None


async def test_cancel_for_a_mark_with_no_due_time_is_refused_as_every_other_route_is(client):
    """A profile marked to go at once has nothing to cancel, so the cancel route answers 403 as the rest do"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    headers = _get_auth_header(signup)
    async with TestSession() as session:
        await session.execute(update(User).where(User.id == user_id).values(deletion_requested_at=datetime.now(UTC)))
        await session.commit()

    response = await client.post(_CANCEL, headers=headers)

    assert (response.status_code, response.json()["detail"]) == (403, _SCHEDULED_DETAIL)
    assert (await _stored_user(user_id)).deletion_requested_at is not None


async def test_cancel_works_for_a_user_whose_second_factor_re_enrolment_is_required_and_re_enrolment_follows(client, profile_deletion_wait):
    """A waiting user who signed in with a recovery code can cancel, and the answer still holds them to re-enrolment"""
    profile_deletion_wait(_WAIT)
    user_id, _ = await _request_deletion(client)
    headers = await _sign_in_while_waiting(client)
    async with TestSession() as session:
        await session.execute(update(User).where(User.id == user_id).values(second_factor_reenrollment_required=True))
        await session.commit()

    cancelled = await client.post(_CANCEL, headers=headers)

    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["deletion_due_at"] is None
    assert cancelled.json()["second_factor_reenrollment_required"] is True, "re-enrolment follows the cancel"


async def test_cancel_for_a_profile_that_is_not_marked_answers_with_the_user_and_changes_nothing(client):
    """A second tab cancelling after the first has cancelled finds nothing to cancel and is told so with the user"""
    signup = await _create_user(client)
    user_id = uuid.UUID(signup.json()["user"]["id"])
    headers = _get_auth_header(signup)

    response = await client.post(_CANCEL, headers=headers)

    assert response.status_code == 200, response.text
    assert response.json()["deletion_due_at"] is None
    assert response.json()["email"] == _EMAIL
    after = await _stored_user(user_id)
    assert (after.deletion_requested_at, after.deletion_due_at, after.deletion_reminder_sent_at) == (None, None, None)


async def test_the_run_ends_the_sessions_of_the_wait_before_it_deletes_anything(client, profile_deletion_wait, monkeypatch):
    """Once the due time has passed the run ends a session made during the wait first, so it can't be used while the data goes"""
    profile_deletion_wait(_WAIT)
    user_id, _ = await _request_deletion(client)
    headers = await _sign_in_while_waiting(client)
    await _set_due(user_id, datetime.now(UTC) - timedelta(minutes=1))

    def stops_before_the_first_batch():
        raise RuntimeError("The server restarted")
        yield

    monkeypatch.setattr(removal, "_deletion_steps", stops_before_the_first_batch)
    async with _act_as(None):
        await delete_marked_profiles(ScopedSession)

    async with TestSession() as session:
        assert await session.scalar(select(func.count()).select_from(AuthSession).where(AuthSession.user_id == user_id)) == 0
    assert (await _stored_user(user_id)).deletion_requested_at is not None, "the deletion is only part-way"
    assert (await client.get("/auth/2fa/status", headers=headers)).status_code == 401


async def test_the_status_tells_the_client_the_wait_in_whole_seconds(client, profile_deletion_wait):
    """The settings status reports 0 with no wait and the wait in seconds, never rounded up to a day, once one is set"""
    headers = _get_auth_header(await _create_user(client))
    assert (await client.get("/auth/oidc/identities", headers=headers)).json()["profile_deletion_wait_seconds"] == 0

    profile_deletion_wait(timedelta(days=7))
    assert (await client.get("/auth/oidc/identities", headers=headers)).json()["profile_deletion_wait_seconds"] == 7 * 86400

    profile_deletion_wait(timedelta(hours=36))
    assert (await client.get("/auth/oidc/identities", headers=headers)).json()["profile_deletion_wait_seconds"] == 36 * 3600


@pytest.mark.parametrize(("sender", "logged_class"), [("raises", "ConnectionError"), ("missing", "RuntimeError")])
async def test_a_failing_or_missing_email_sender_never_fails_the_request(
    client, profile_deletion_wait, monkeypatch, caplog, sender, logged_class
):
    """The profile is marked and the request answers as usual when the scheduled email can't be sent, and only the error's class is logged"""
    profile_deletion_wait(_WAIT)

    async def fail(recipient, message):
        raise ConnectionError(f"cannot reach the mail server for {recipient}")

    monkeypatch.setattr(email_contract, "_active_sender", SimpleNamespace(send=fail) if sender == "raises" else None)

    user_id, _ = await _request_deletion(client)

    assert (await _stored_user(user_id)).deletion_due_at is not None
    assert f"scheduled email failed to send: {logged_class}" in caplog.text
    assert _EMAIL not in caplog.text
