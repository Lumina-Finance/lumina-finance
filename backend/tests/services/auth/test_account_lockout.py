"""Account lockout counting tests"""

import asyncio
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import update

from app.models.auth import LoginLockout
from app.services.auth.account_lockout import _MAX_FAILED_ATTEMPTS, claim_attempt, release_attempt
from app.services.auth.login_email_hash import seal_login_email
from tests.conftest import TestSession

_EMAIL = "lockout-service@example.com"


async def _claim_in_own_session() -> int | None:
    """Claim one attempt in its own session, returning the attempts left or None when the email is locked"""
    async with TestSession() as db:
        try:
            return await claim_attempt(db, _EMAIL)
        except HTTPException:
            return None


async def _stored_lockout() -> LoginLockout:
    """Return the stored lockout row for the test email"""
    async with TestSession() as check:
        return await check.get(LoginLockout, seal_login_email(_EMAIL))


async def test_concurrent_first_claims_each_advance_the_counter():
    """A burst of simultaneous attempts for an email with no record each counts once, so it cannot slip past the lock"""
    # Fire the whole allowance at once at an email nothing has counted yet, so a lost insert or update
    # would leave the counter well below the limit
    remaining = await asyncio.gather(*[_claim_in_own_session() for _ in range(_MAX_FAILED_ATTEMPTS)])

    assert sorted(remaining) == list(range(_MAX_FAILED_ATTEMPTS))
    lockout = await _stored_lockout()
    assert lockout.failed_attempt_count == _MAX_FAILED_ATTEMPTS
    assert lockout.locked_until is not None


async def test_claims_past_the_limit_are_refused_and_change_nothing():
    """Once the email is locked, a further attempt is refused with the count and the lock left as they were"""
    await asyncio.gather(*[_claim_in_own_session() for _ in range(_MAX_FAILED_ATTEMPTS)])
    locked = await _stored_lockout()

    refused = await asyncio.gather(*[_claim_in_own_session() for _ in range(3)])

    assert refused == [None, None, None]
    after = await _stored_lockout()
    assert (after.failed_attempt_count, after.locked_until, after.last_failed_at) == (
        locked.failed_attempt_count,
        locked.locked_until,
        locked.last_failed_at,
    )


async def test_claim_after_the_lock_has_expired_restarts_the_count():
    """Waiting out the lock restores the full allowance"""
    await asyncio.gather(*[_claim_in_own_session() for _ in range(_MAX_FAILED_ATTEMPTS)])
    async with TestSession() as db:
        await db.execute(update(LoginLockout).values(locked_until=datetime.now(UTC) - timedelta(seconds=1)))
        await db.commit()

    assert await _claim_in_own_session() == _MAX_FAILED_ATTEMPTS - 1

    lockout = await _stored_lockout()
    assert (lockout.failed_attempt_count, lockout.locked_until) == (1, None)


async def test_release_gives_a_place_back_and_lifts_a_lock_it_unlocks():
    """Releasing the claim that reached the limit lifts the lock, and a release never takes the count below zero"""
    await asyncio.gather(*[_claim_in_own_session() for _ in range(_MAX_FAILED_ATTEMPTS)])

    async with TestSession() as db:
        await release_attempt(db, _EMAIL)
    lockout = await _stored_lockout()
    assert (lockout.failed_attempt_count, lockout.locked_until) == (_MAX_FAILED_ATTEMPTS - 1, None)

    for _ in range(_MAX_FAILED_ATTEMPTS + 2):
        async with TestSession() as db:
            await release_attempt(db, _EMAIL)
    assert (await _stored_lockout()).failed_attempt_count == 0
