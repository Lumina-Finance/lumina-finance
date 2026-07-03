"""Recovery code service concurrency tests"""

import asyncio
import uuid

from sqlalchemy import select

from app.models.auth import RecoveryCode
from app.models.currency import Currency
from app.models.user import User
from app.services.auth.recovery_codes import consume_recovery_code, generate_recovery_codes
from tests.conftest import TestSession


async def _create_user_with_recovery_codes() -> tuple[uuid.UUID, list[str]]:
    """Create a user with one active recovery batch and return the id and plaintext codes"""
    async with TestSession() as db:
        currency = Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2)
        user = User(
            email="recovery-service@example.com",
            first_name="Recovery",
            last_name="User",
            tz="America/Toronto",
            base_currency=currency.id,
        )
        db.add(currency)
        db.add(user)
        await db.flush()
        codes = await generate_recovery_codes(db, user.id)
        await db.commit()
        return user.id, codes


async def test_concurrent_redemption_of_one_recovery_code_claims_it_once():
    """Two redemptions of the same code at once resolve to one success and one clean reject, never both"""
    user_id, codes = await _create_user_with_recovery_codes()
    code = codes[0]

    async with TestSession() as first, TestSession() as second:
        # The first claim deletes the row and holds its lock, still uncommitted
        first_result = await consume_recovery_code(first, user_id, code)

        # The second races the same code, so its conditional delete blocks on the lock until the first
        # commits, then matches no row rather than raising on a stale delete
        second_task = asyncio.create_task(consume_recovery_code(second, user_id, code))
        await asyncio.sleep(0.2)
        await first.commit()
        second_result = await asyncio.wait_for(second_task, timeout=10)
        await second.commit()

    assert first_result is True
    assert second_result is False

    # Exactly one code of the batch is spent, so the redeemed row is gone and a later replay finds nothing
    async with TestSession() as check:
        remaining = await check.execute(select(RecoveryCode).where(RecoveryCode.user_id == user_id))
        assert len(remaining.scalars().all()) == len(codes) - 1
        assert await consume_recovery_code(check, user_id, code) is False
