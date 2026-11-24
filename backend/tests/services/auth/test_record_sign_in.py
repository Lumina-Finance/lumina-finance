"""Recording a renewal's time while signing out of other devices runs, which must never deadlock the two"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text

from app.models.auth_session import AuthSession
from app.models.user import UserLastSignIn
from app.services.auth.sessions import delete_other_user_auth_sessions, record_sign_in
from tests.conftest import TestSession
from tests.routes.support.identity_helpers import _act_as, _seed_users
from tests.routes.support.lock_helpers import _cancel_unfinished, _wait_until_waiting_on


async def test_a_renewal_holding_its_session_records_its_time_while_other_devices_are_signed_out():
    """A renewal records its time while signing out other devices holds the user row and waits for the renewal's session

    Both finish: the renewal's time is stored and its session is gone. A time kept on the user row would
    make each wait for the other
    """
    (user,) = await _seed_users("renewing@example.com")
    renewing_id, asking_id = uuid.uuid4(), uuid.uuid4()
    expires_at = datetime.now(UTC) + timedelta(days=1)
    async with TestSession() as session:
        session.add_all([AuthSession(id=session_id, user_id=user.id, expires_at=expires_at) for session_id in (renewing_id, asking_id)])
        await session.commit()

    async def sign_out_other_devices() -> None:
        async with _act_as(user.id) as asking:
            await delete_other_user_auth_sessions(asking, user.id, asking_id)
            await asking.commit()

    async with _act_as(user.id) as renewal:
        await renewal.execute(select(AuthSession.id).where(AuthSession.id == renewing_id).with_for_update())
        renewal_pid = await renewal.scalar(text("SELECT pg_backend_pid()"))
        signing_out = asyncio.create_task(sign_out_other_devices())
        try:
            await _wait_until_waiting_on(renewal_pid, signing_out)
            await record_sign_in(renewal, user.id)
            await renewal.commit()
            async with asyncio.timeout(5):
                await signing_out
        finally:
            await _cancel_unfinished([signing_out])

    async with TestSession() as session:
        assert await session.scalar(select(UserLastSignIn.last_signed_in_at).where(UserLastSignIn.user_id == user.id)) is not None
        assert list(await session.scalars(select(AuthSession.id).where(AuthSession.user_id == user.id))) == [asking_id]
