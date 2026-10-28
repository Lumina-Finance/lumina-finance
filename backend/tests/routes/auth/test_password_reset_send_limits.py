"""Limits on password reset sends while the mail server fails or hangs"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import PasswordResetToken
from app.services.auth import password_reset, reset_send_limit
from tests.conftest import TestSession
from tests.routes.support import SIGNUP_PAYLOAD, _create_user, sign_up_confirmed

_FORGOT = "/auth/password/forgot"


async def _create_users(client, count):
    """Sign up count users, returning their emails and ids, the default user first"""
    emails = [SIGNUP_PAYLOAD["email"]] + [f"user{index}@example.com" for index in range(1, count)]
    user_ids = [uuid.UUID((await _create_user(client)).json()["user"]["id"])]
    for email in emails[1:]:
        signup = await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": email})
        user_ids.append(uuid.UUID(signup.json()["user"]["id"]))
    return emails, user_ids


async def _token_count(user_id):
    """Return how many reset token rows a user has"""
    async with TestSession() as session:
        result = await session.execute(select(PasswordResetToken).where(PasswordResetToken.user_id == user_id))
        return len(result.scalars().all())


def _use_mailer(monkeypatch, send):
    """Make send the mail server for the test"""
    monkeypatch.setattr(password_reset, "get_email_sender", lambda: SimpleNamespace(send=send))


async def _failing_send(*_args):
    """Simulate an unavailable mail server"""
    raise RuntimeError("smtp is down")


async def test_nonstop_requests_start_one_send_while_mail_is_down(client, monkeypatch):
    """A flood of requests for one address while the mail server fails starts a single send"""
    emails, user_ids = await _create_users(client, 1)
    attempts = []

    async def failing_send(email, _message):
        attempts.append(email)
        await _failing_send()

    _use_mailer(monkeypatch, failing_send)

    responses = [await client.post(_FORGOT, json={"email": emails[0]}) for _ in range(10)]

    assert [(response.status_code, response.content) for response in responses] == [(204, b"")] * 10
    assert attempts == emails
    assert await _token_count(user_ids[0]) == 0


async def test_the_wait_doubles_after_each_failed_send(client, monkeypatch, reset_clock):
    """Each retry of a failing address must wait twice as long, and is refused a second before that"""
    emails, _ = await _create_users(client, 1)
    attempts = []

    async def failing_send(email, _message):
        attempts.append(email)
        await _failing_send()

    _use_mailer(monkeypatch, failing_send)

    for expected_wait, expected_attempts in [(60, 1), (120, 2), (240, 3)]:
        await client.post(_FORGOT, json={"email": emails[0]})
        assert len(attempts) == expected_attempts
        reset_clock(expected_wait - 1)
        await client.post(_FORGOT, json={"email": emails[0]})
        assert len(attempts) == expected_attempts
        reset_clock(1)


async def test_requests_refused_while_an_account_waits_do_not_use_up_its_daily_allowance(client, monkeypatch, reset_clock):
    """Refused requests store stand-in rows, and three of them must not stop the account sending once the wait ends"""
    emails, _ = await _create_users(client, 1)
    attempts = []

    async def failing_send(email, _message):
        attempts.append(email)
        await _failing_send()

    _use_mailer(monkeypatch, failing_send)
    await client.post(_FORGOT, json={"email": emails[0]})
    for _ in range(3):
        await client.post(_FORGOT, json={"email": emails[0]})
    assert len(attempts) == 1

    reset_clock(reset_send_limit.FIRST_FAILURE_WAIT_SECONDS)
    await client.post(_FORGOT, json={"email": emails[0]})
    assert len(attempts) == 2


@pytest.mark.parametrize(
    ("failures", "wait"),
    [(1, 60), (2, 120), (3, 240), (4, 480), (5, 960), (6, 1920), (7, 3600), (8, 3600)],
)
def test_the_wait_after_failures_stops_growing_at_the_ceiling(reset_clock, failures, wait):
    """The wait doubles from a minute and never passes the ceiling"""
    user_id = uuid.uuid4()
    for _ in range(failures):
        reset_send_limit.record_send_failed(user_id)

    reset_clock(wait - 1)
    assert reset_send_limit.try_start_send(user_id) is None
    reset_clock(1)
    assert reset_send_limit.try_start_send(user_id) is not None


def test_the_failures_of_a_quiet_account_are_forgotten(reset_clock):
    """After a stretch as long as the longest wait with no failure, the next failure waits a minute again"""
    user_id = uuid.uuid4()
    for _ in range(3):
        reset_send_limit.record_send_failed(user_id)
    reset_clock(4 * reset_send_limit.FIRST_FAILURE_WAIT_SECONDS + reset_send_limit.MAX_FAILURE_WAIT_SECONDS)
    reset_send_limit.end_send(reset_send_limit.try_start_send(user_id))

    reset_send_limit.record_send_failed(user_id)

    reset_clock(reset_send_limit.FIRST_FAILURE_WAIT_SECONDS)
    assert reset_send_limit.try_start_send(user_id) is not None


async def test_the_wait_starts_over_after_a_send_works(client, monkeypatch, reset_clock):
    """A send that works clears the failures, so the next failure waits a minute rather than doubling on"""
    emails, user_ids = await _create_users(client, 1)
    outcomes = ["fail", "fail", "work", "fail", "fail"]
    attempts = []

    async def scripted_send(email, _message):
        attempts.append(email)
        if outcomes[len(attempts) - 1] == "fail":
            await _failing_send()

    _use_mailer(monkeypatch, scripted_send)

    await client.post(_FORGOT, json={"email": emails[0]})
    reset_clock(60)
    await client.post(_FORGOT, json={"email": emails[0]})
    reset_clock(120)
    await client.post(_FORGOT, json={"email": emails[0]})
    assert len(attempts) == 3

    async with TestSession() as session:
        await session.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user_ids[0]))
        await session.commit()
    await client.post(_FORGOT, json={"email": emails[0]})
    assert len(attempts) == 4

    reset_clock(60)
    await client.post(_FORGOT, json={"email": emails[0]})
    assert len(attempts) == 5


async def test_a_failure_is_recorded_before_its_token_is_dropped(client, monkeypatch, reset_clock):
    """A drop that fails must not lose the failure, so the account still waits"""
    emails, user_ids = await _create_users(client, 1)

    async def broken_drop(_token_id, _session_factory):
        raise RuntimeError("database is down")

    _use_mailer(monkeypatch, _failing_send)
    monkeypatch.setattr(password_reset, "_drop_token_by_id", broken_drop)

    with pytest.raises(RuntimeError, match="database is down"):
        await client.post(_FORGOT, json={"email": emails[0]})

    # The link is still stored, so only the recorded wait holds the account back
    reset_clock(reset_send_limit.FIRST_FAILURE_WAIT_SECONDS - 1)
    assert reset_send_limit.try_start_send(user_ids[0]) is None
    reset_clock(1)
    assert reset_send_limit.try_start_send(user_ids[0]) is not None


async def test_twenty_simultaneous_requests_all_send_three_at_a_time(client, monkeypatch):
    """Requests past the running limit wait their turn and still send, never more than three at once"""
    emails, _ = await _create_users(client, 20)
    sent = []
    running = 0
    most_running = 0
    three_running = asyncio.Event()
    release = asyncio.Event()

    async def held_send(email, _message):
        nonlocal running, most_running
        running += 1
        most_running = max(most_running, running)
        if running == 3:
            three_running.set()
        await release.wait()
        sent.append(email)
        running -= 1

    _use_mailer(monkeypatch, held_send)
    requests = asyncio.gather(*(client.post(_FORGOT, json={"email": email}) for email in emails))
    try:
        async with asyncio.timeout(10):
            await three_running.wait()

            # Every request has reached its turn in the queue by now, and the fourth send still waits
            await asyncio.sleep(0.2)
            assert running == 3
    finally:
        release.set()
    responses = await requests

    assert [(response.status_code, response.content) for response in responses] == [(204, b"")] * 20
    assert sorted(sent) == sorted(emails)
    assert most_running == 3


async def test_a_full_queue_starts_no_send_and_stores_no_token(client, monkeypatch):
    """A request beyond one running and one waiting send answers 204 and leaves nothing behind"""
    monkeypatch.setattr(reset_send_limit, "MAX_CONCURRENT_RESET_SENDS", 1)
    monkeypatch.setattr(reset_send_limit, "MAX_QUEUED_RESET_SENDS", 1)
    emails, user_ids = await _create_users(client, 3)
    started = []
    release = asyncio.Event()

    async def held_send(email, _message):
        started.append(email)
        await release.wait()

    _use_mailer(monkeypatch, held_send)
    waiting = []
    try:
        async with asyncio.timeout(5):
            waiting.append(asyncio.create_task(client.post(_FORGOT, json={"email": emails[0]})))
            while not started:
                await asyncio.sleep(0.01)
            waiting.append(asyncio.create_task(client.post(_FORGOT, json={"email": emails[1]})))
            while await _token_count(user_ids[1]) == 0:
                await asyncio.sleep(0.01)

            refused = await client.post(_FORGOT, json={"email": emails[2]})
    finally:
        release.set()
        await asyncio.gather(*waiting)

    assert (refused.status_code, refused.content) == (204, b"")
    assert await _token_count(user_ids[2]) == 0
    assert started == emails[:2]

    # The refusal left no wait behind, so the same request goes through as soon as there is room
    await client.post(_FORGOT, json={"email": emails[2]})
    assert started == emails


async def test_a_cancelled_queued_send_leaves_no_live_link_and_no_wait(client, monkeypatch):
    """A send cancelled while it waits its turn drops its token, so the same account can ask again at once"""
    monkeypatch.setattr(reset_send_limit, "MAX_CONCURRENT_RESET_SENDS", 1)
    emails, user_ids = await _create_users(client, 2)
    started = []
    release = asyncio.Event()

    async def held_send(email, _message):
        started.append(email)
        await release.wait()

    _use_mailer(monkeypatch, held_send)
    running = asyncio.create_task(client.post(_FORGOT, json={"email": emails[0]}))
    queued = None
    try:
        async with asyncio.timeout(5):
            while not started:
                await asyncio.sleep(0.01)
            queued = asyncio.create_task(client.post(_FORGOT, json={"email": emails[1]}))
            while await _token_count(user_ids[1]) == 0:
                await asyncio.sleep(0.01)

            # The queued send has had time to start waiting for its turn by now
            await asyncio.sleep(0.2)
            queued.cancel()
            await asyncio.gather(queued, return_exceptions=True)
            assert queued.cancelled()
            assert await _token_count(user_ids[1]) == 0
    finally:
        release.set()
        await asyncio.gather(running, return_exceptions=True)

    await client.post(_FORGOT, json={"email": emails[1]})
    assert started == emails


def test_an_admission_that_never_reports_back_gives_up_its_place(reset_clock):
    """A send dropped before it runs frees its place after the lease, and its late end frees nothing newer"""
    user_id = uuid.uuid4()
    old = reset_send_limit.try_start_send(user_id)
    assert reset_send_limit.try_start_send(user_id) is None

    reset_clock(reset_send_limit.ADMISSION_LEASE_SECONDS - 1)
    assert reset_send_limit.try_start_send(user_id) is None

    reset_clock(1)
    new = reset_send_limit.try_start_send(user_id)
    assert new is not None

    reset_send_limit.end_send(old)
    assert reset_send_limit.try_start_send(user_id) is None


async def test_a_request_that_fails_before_handing_on_its_send_frees_its_claim(client, monkeypatch):
    """A failure after the claim leaves no token or place behind, so the next request sends at once"""
    emails, user_ids = await _create_users(client, 1)
    sent = []

    async def record_send(email, _message):
        sent.append(email)

    _use_mailer(monkeypatch, record_send)

    async def broken_commit(_self):
        raise RuntimeError("database went away")

    with monkeypatch.context() as broken:
        broken.setattr(AsyncSession, "commit", broken_commit)
        with pytest.raises(RuntimeError):
            await client.post(_FORGOT, json={"email": emails[0]})

    assert await _token_count(user_ids[0]) == 0
    assert (await client.post(_FORGOT, json={"email": emails[0]})).status_code == 204
    assert sent == emails


async def test_an_email_that_cannot_be_rendered_is_answered_and_leaves_no_link(client, monkeypatch):
    """Rendering waits until after the response, so a broken template drops the token and starts the back-off"""
    emails, user_ids = await _create_users(client, 1)
    sent = []

    async def record_send(email, _message):
        sent.append(email)

    def broken_render(*_args):
        raise RuntimeError("template is broken")

    _use_mailer(monkeypatch, record_send)
    monkeypatch.setattr(password_reset, "render_reset_email", broken_render)

    response = await client.post(_FORGOT, json={"email": emails[0]})

    assert response.status_code == 204
    assert sent == []
    assert await _token_count(user_ids[0]) == 0
    assert user_ids[0] in reset_send_limit._backoffs


async def test_a_send_that_waited_past_its_links_life_is_dropped_without_a_failure(client, monkeypatch):
    """A link that expired in the queue is not sent, its token goes, and the account is not made to wait"""
    monkeypatch.setattr(reset_send_limit, "MAX_CONCURRENT_RESET_SENDS", 1)
    monkeypatch.setattr(password_reset, "PASSWORD_RESET_TOKEN_EXPIRE_SECONDS", 1)
    emails, user_ids = await _create_users(client, 2)
    started = []
    release = asyncio.Event()

    async def held_send(email, _message):
        started.append(email)
        await release.wait()

    _use_mailer(monkeypatch, held_send)
    running = asyncio.create_task(client.post(_FORGOT, json={"email": emails[0]}))
    queued = None
    try:
        async with asyncio.timeout(10):
            while not started:
                await asyncio.sleep(0.01)
            queued = asyncio.create_task(client.post(_FORGOT, json={"email": emails[1]}))
            while await _token_count(user_ids[1]) == 0:
                await asyncio.sleep(0.01)

            # The queued link outlives its one second of life while it waits for the running send
            await asyncio.sleep(1.2)
    finally:
        release.set()
    await asyncio.gather(running, queued)

    assert started == emails[:1]
    assert await _token_count(user_ids[1]) == 0
    assert reset_send_limit.try_start_send(user_ids[1]) is not None


async def test_a_request_cancelled_before_handing_on_its_send_frees_its_claim(client, monkeypatch):
    """A cancellation after the claim is not an Exception, and must still free the account's place"""
    emails, user_ids = await _create_users(client, 1)

    async def cancelled_commit(_self):
        raise asyncio.CancelledError

    with monkeypatch.context() as cancelled:
        cancelled.setattr(AsyncSession, "commit", cancelled_commit)
        with pytest.raises(asyncio.CancelledError):
            async with TestSession() as db:
                await password_reset.request_password_reset(db, emails[0], BackgroundTasks(), TestSession)

    assert await _token_count(user_ids[0]) == 0
    assert reset_send_limit.try_start_send(user_ids[0]) is not None


async def _age_tokens(user_id, seconds):
    """Move the creation time of a user's reset tokens back, as if that long had passed"""
    async with TestSession() as session:
        await session.execute(
            update(PasswordResetToken)
            .where(PasswordResetToken.user_id == user_id)
            .values(created_at=PasswordResetToken.created_at - timedelta(seconds=seconds))
        )
        await session.commit()


async def test_a_link_never_emailed_because_the_process_died_does_not_block_the_next_request(client, monkeypatch):
    """A restart after the link is saved loses the send, and asking again a minute later must send an email"""
    emails, user_ids = await _create_users(client, 1)
    async with TestSession() as db:
        pending = await password_reset._issue_password_reset(db, emails[0], TestSession)
    reset_send_limit.end_send(pending.ticket)
    await _age_tokens(user_ids[0], 60)
    sent = []

    async def send(email, _message):
        sent.append(email)

    _use_mailer(monkeypatch, send)
    await client.post(_FORGOT, json={"email": emails[0]})

    assert sent == emails
    # The stranded row is deleted by the request that found it, leaving only the new link
    assert await _token_count(user_ids[0]) == 1


async def test_a_send_still_waiting_its_turn_past_the_grace_keeps_its_link_and_gets_no_second(client, monkeypatch):
    """A queued send will still email its link, so deleting the row would send a dead link"""
    emails, user_ids = await _create_users(client, 1)
    async with TestSession() as db:
        pending = await password_reset._issue_password_reset(db, emails[0], TestSession)
    await _age_tokens(user_ids[0], 60)
    sent = []

    async def send(email, _message):
        sent.append(email)

    _use_mailer(monkeypatch, send)
    await client.post(_FORGOT, json={"email": emails[0]})

    assert sent == []
    assert await _token_count(user_ids[0]) == 1
    reset_send_limit.end_send(pending.ticket)


async def _seed_unsent_tokens(user_id, count, age_seconds):
    """Store count live reset links for a user that no send ever started, each created age_seconds ago"""
    async with TestSession() as session:
        for _ in range(count):
            now = datetime.now(UTC)
            session.add(
                PasswordResetToken(
                    user_id=user_id,
                    token_hash=uuid.uuid4().hex,
                    expires_at=now + timedelta(minutes=15),
                    created_at=now - timedelta(seconds=age_seconds),
                )
            )
        await session.commit()


def _capture_sends(monkeypatch):
    """Make a mail server that records the address of each email, returning that list"""
    sent = []

    async def send(email, _message):
        sent.append(email)

    _use_mailer(monkeypatch, send)
    return sent


async def test_stranded_links_do_not_count_toward_the_daily_limit(client, monkeypatch):
    """Three links that were never emailed are not sends, so the allowance of three is still whole"""
    emails, user_ids = await _create_users(client, 1)
    await _seed_unsent_tokens(user_ids[0], 3, 60)
    sent = _capture_sends(monkeypatch)

    await client.post(_FORGOT, json={"email": emails[0]})

    assert sent == emails
    assert await _token_count(user_ids[0]) == 1


async def test_a_link_saved_moments_ago_by_another_worker_is_left_alone(client, monkeypatch):
    """A fresh unemailed link may be one a restart just orphaned, so inside the grace it stays and blocks"""
    emails, user_ids = await _create_users(client, 1)
    await _seed_unsent_tokens(user_ids[0], 1, 5)
    sent = _capture_sends(monkeypatch)

    await client.post(_FORGOT, json={"email": emails[0]})

    assert sent == []
    assert await _token_count(user_ids[0]) == 1


async def test_another_accounts_stranded_link_is_not_deleted(client, monkeypatch):
    """Clearing one account's stranded links must not touch the next account's"""
    emails, user_ids = await _create_users(client, 2)
    await _seed_unsent_tokens(user_ids[1], 1, 60)
    sent = _capture_sends(monkeypatch)

    await client.post(_FORGOT, json={"email": emails[0]})

    assert sent == emails[:1]
    assert await _token_count(user_ids[1]) == 1


async def test_a_send_whose_admission_lease_ran_out_no_longer_protects_its_link(client, monkeypatch):
    """A send that never reported back stops holding its account's place, so its stranded link is cleared"""
    emails, user_ids = await _create_users(client, 1)
    async with TestSession() as db:
        await password_reset._issue_password_reset(db, emails[0], TestSession)
    await _age_tokens(user_ids[0], 60)
    monkeypatch.setitem(
        reset_send_limit._admitted,
        user_ids[0],
        reset_send_limit.SendTicket(user_id=user_ids[0], lease_ends=reset_send_limit.monotonic() - 1),
    )
    sent = _capture_sends(monkeypatch)

    await client.post(_FORGOT, json={"email": emails[0]})

    assert sent == emails
    assert await _token_count(user_ids[0]) == 1


async def test_an_emailed_link_keeps_blocking_a_second_request_after_the_grace(client, monkeypatch):
    """A link that was sent stays the one live link, however long ago it was saved"""
    emails, user_ids = await _create_users(client, 1)
    sent = []

    async def send(email, _message):
        sent.append(email)

    _use_mailer(monkeypatch, send)
    await client.post(_FORGOT, json={"email": emails[0]})
    await _age_tokens(user_ids[0], 60)
    await client.post(_FORGOT, json={"email": emails[0]})

    assert sent == emails


async def test_a_request_cut_off_after_its_link_commits_leaves_no_live_link(client, monkeypatch):
    """A cancellation that lands once the link is saved must release it, so the account can ask again at once"""
    emails, user_ids = await _create_users(client, 1)
    real_commit = AsyncSession.commit

    async def commit_then_cancel(self):
        await real_commit(self)
        raise asyncio.CancelledError

    with monkeypatch.context() as cancelled:
        cancelled.setattr(AsyncSession, "commit", commit_then_cancel)
        with pytest.raises(asyncio.CancelledError):
            async with TestSession() as db:
                await password_reset.request_password_reset(db, emails[0], BackgroundTasks(), TestSession)

    assert await _token_count(user_ids[0]) == 0
    assert reset_send_limit.try_start_send(user_ids[0]) is not None
