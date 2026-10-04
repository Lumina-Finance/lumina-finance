"""Running test code as a user, under row-level security"""

from contextlib import asynccontextmanager

from app.database import current_user_id_ctx
from tests.conftest import ScopedSession


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
