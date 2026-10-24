"""Account lockout concurrency tests"""

import asyncio

from app.models.auth import LoginLockout
from app.services.auth.account_lockout import _MAX_FAILED_ATTEMPTS, record_failed_attempt
from app.services.auth.login_email_hash import seal_login_email
from tests.conftest import TestSession

_EMAIL = "lockout-service@example.com"


async def test_concurrent_first_failures_each_advance_the_counter():
    """A burst of simultaneous failures for an email with no record each counts once, so it cannot slip past the lock"""

    async def record_one_failure():
        """Record a single failed attempt in its own session"""
        async with TestSession() as db:
            await record_failed_attempt(db, _EMAIL, None)

    # Fire the whole allowance at once at an email nothing has counted yet, so a lost insert or update
    # would leave the counter well below the limit
    await asyncio.gather(*[record_one_failure() for _ in range(_MAX_FAILED_ATTEMPTS)])

    async with TestSession() as check:
        lockout = await check.get(LoginLockout, seal_login_email(_EMAIL))
        assert lockout.failed_attempt_count == _MAX_FAILED_ATTEMPTS
        assert lockout.locked_until is not None
