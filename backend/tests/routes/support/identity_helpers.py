"""Running test code as a user, under row-level security"""

from contextlib import asynccontextmanager

from sqlalchemy import func, select

from app.database import current_user_id_ctx
from app.models.currency import Currency
from app.models.user import User
from tests.conftest import ScopedSession, TestSession
from tests.routes.support.bank_sync_helpers import _build_user


@asynccontextmanager
async def _act_as(user_id):
    """Yield a scoped session whose statements run as the given user

    The identity is set on the same context variable the app uses, so the session's
    begin listener stamps it for the policies, mirroring a real request. Nothing is
    committed here, so a write inside the block is discarded unless the test commits it
    deliberately, and the per-test truncation clears whatever a test does commit. With
    no user, the session runs as the bank sync worker does
    """
    token = current_user_id_ctx.set(user_id)
    try:
        async with ScopedSession() as session:
            yield session
    finally:
        current_user_id_ctx.reset(token)


async def _seed_users(*emails: str) -> list[User]:
    """Save a user for each email, and the currency their rows are in"""
    users = [_build_user(email) for email in emails]
    async with TestSession() as session:
        session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
        session.add_all(users)
        await session.commit()
    return users


async def _count_visible(session, model) -> int:
    """Return how many rows of a model the session's user can see"""
    return await session.scalar(select(func.count()).select_from(model))
