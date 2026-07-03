"""Account lockout concurrency tests"""

import asyncio
import uuid

from app.models.auth import PasswordCredential
from app.models.currency import Currency
from app.models.user import User
from app.services.auth.account_lockout import _MAX_FAILED_ATTEMPTS, get_password_credential, record_failed_attempt
from tests.conftest import TestSession


async def _create_user_with_password_credential() -> uuid.UUID:
    """Create a user with a password credential whose lockout counter starts at zero"""
    async with TestSession() as db:
        currency = Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2)
        user = User(
            email="lockout-service@example.com",
            first_name="Lockout",
            last_name="User",
            tz="America/Toronto",
            base_currency=currency.id,
        )
        db.add(currency)
        db.add(user)
        await db.flush()
        db.add(PasswordCredential(user_id=user.id, password_hash="unused-hash", password_algo="argon2id"))
        await db.commit()
        return user.id


async def test_concurrent_failed_attempts_each_advance_the_counter():
    """A burst of simultaneous failures each counts once, so it cannot slip past the shared lock"""
    user_id = await _create_user_with_password_credential()

    async def record_one_failure():
        """Load the credential in its own session and record a single failed attempt"""
        async with TestSession() as db:
            credential = await get_password_credential(db, user_id)
            await record_failed_attempt(db, credential)

    # Fire the whole allowance at once, so a lost-update race would leave the counter well below the limit
    await asyncio.gather(*[record_one_failure() for _ in range(_MAX_FAILED_ATTEMPTS)])

    async with TestSession() as check:
        credential = await get_password_credential(check, user_id)
        assert credential.failed_attempt_count == _MAX_FAILED_ATTEMPTS
        assert credential.locked_until is not None
