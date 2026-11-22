"""Account lockout counting tests

Guards that simultaneous attempts are each counted once, and that the buckets of one email count, lock,
release apart, and that a reset of every bucket clears them all, so one sender's failures never lock another's
"""

import asyncio
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select, update

from app.models.auth import LoginLockout
from app.services.auth.account_lockout import (
    _MAX_FAILED_ATTEMPTS,
    claim_attempt,
    is_email_locked,
    release_attempt,
    reset_all_failed_attempts,
)
from app.services.auth.known_browser import SHARED_BUCKET
from app.services.auth.login_email_hash import seal_login_email
from tests.conftest import TestSession

_EMAIL = "lockout-service@example.com"
_BROWSER_BUCKET = "b" * 64
_SESSION_BUCKET = "c" * 64


async def _claim_in_own_session(bucket: str = SHARED_BUCKET) -> int | None:
    """Claim one attempt in its own session, returning the attempts left or None when the bucket is locked"""
    async with TestSession() as db:
        try:
            return await claim_attempt(db, _EMAIL, bucket)
        except HTTPException:
            return None


async def _stored_lockout(bucket: str = SHARED_BUCKET) -> LoginLockout | None:
    """Return the stored lockout row for the test email in a bucket"""
    async with TestSession() as check:
        return await check.get(LoginLockout, (seal_login_email(_EMAIL), bucket))


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
    """Once the bucket is locked, a further attempt is refused with the count and the lock left as they were"""
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
        await release_attempt(db, _EMAIL, SHARED_BUCKET)
    lockout = await _stored_lockout()
    assert (lockout.failed_attempt_count, lockout.locked_until) == (_MAX_FAILED_ATTEMPTS - 1, None)

    for _ in range(_MAX_FAILED_ATTEMPTS + 2):
        async with TestSession() as db:
            await release_attempt(db, _EMAIL, SHARED_BUCKET)
    assert (await _stored_lockout()).failed_attempt_count == 0


async def test_buckets_of_one_email_count_lock_and_release_apart():
    """A lock or a release in one bucket leaves the email's other buckets as they were"""
    await asyncio.gather(*[_claim_in_own_session(_BROWSER_BUCKET) for _ in range(_MAX_FAILED_ATTEMPTS)])

    async with TestSession() as db:
        assert await is_email_locked(db, _EMAIL, _BROWSER_BUCKET), "five failures lock the browser's bucket"
        assert not await is_email_locked(db, _EMAIL, SHARED_BUCKET), "the shared bucket is not locked by the browser's failures"
        assert not await is_email_locked(db, _EMAIL, _SESSION_BUCKET), "a session's bucket is not locked by the browser's failures"
    assert await _claim_in_own_session(SHARED_BUCKET) == _MAX_FAILED_ATTEMPTS - 1, "the shared bucket still has its full allowance"
    assert await _claim_in_own_session(_BROWSER_BUCKET) is None, "the locked bucket refuses a claim"

    async with TestSession() as db:
        await release_attempt(db, _EMAIL, SHARED_BUCKET)
    assert (await _stored_lockout(SHARED_BUCKET)).failed_attempt_count == 0, "a release gives the place back in its own bucket"
    assert (await _stored_lockout(_BROWSER_BUCKET)).locked_until is not None, "a release elsewhere leaves the browser's lock set"


async def test_reset_of_every_bucket_clears_them_all_and_only_that_email():
    """A reset for the whole address forgets each bucket's failures but not another address's"""
    other_email = "someone-else@example.com"
    for bucket in (SHARED_BUCKET, _BROWSER_BUCKET, _SESSION_BUCKET):
        await _claim_in_own_session(bucket)
    async with TestSession() as db:
        await claim_attempt(db, other_email, SHARED_BUCKET)

    async with TestSession() as db:
        await reset_all_failed_attempts(db, _EMAIL)
        await db.commit()

    async with TestSession() as check:
        remaining_emails = set((await check.execute(select(LoginLockout.email_hash))).scalars())
    assert remaining_emails == {seal_login_email(other_email)}, "only the other address's row is left"
