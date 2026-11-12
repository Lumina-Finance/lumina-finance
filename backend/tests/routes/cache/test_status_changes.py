"""Cache status when a change to what pages show, such as a bank sync's progress, and a data change interleave

Pages refresh for whichever came later, and treat the change as already shown only when their own
session made a data change and nothing changed after it, so a page neither misses a sync's progress
after its own edit nor refreshes again for its own edit made after the sync
"""

import uuid
from datetime import datetime

from app.models.cache_state import UserCacheState
from app.services.cache_state import mark_user_status_changed
from tests.conftest import TestSession
from tests.routes.support import _create_account, _create_user, _get_auth_header


async def _sign_up(client):
    """Sign up the default user, returning their auth headers and id"""
    signup = await _create_user(client)
    return _get_auth_header(signup), uuid.UUID(signup.json()["user"]["id"])


async def _change_status(user_id: uuid.UUID) -> None:
    """Record a change to what the user's pages show, as the bank sync worker does outside any request"""
    async with TestSession() as session:
        await mark_user_status_changed(session, user_id)
        await session.commit()


async def _read_marks(user_id: uuid.UUID) -> tuple[datetime, datetime | None]:
    """Return when the user's data last changed and when what their pages show last changed"""
    async with TestSession() as session:
        state = await session.get_one(UserCacheState, user_id)
        return state.changed_at, state.status_changed_at


async def _personal_status(client, headers) -> tuple[datetime, bool]:
    """Return the personal scope's change time and whether this session made it, as the cache status reports them"""
    resp = await client.get("/me/cache-status", headers=headers)
    assert resp.status_code == 200, resp.text
    personal = resp.json()["personal"]
    return datetime.fromisoformat(personal["changed_at"].replace("Z", "+00:00")), personal["last_change_from_current_session"]


async def test_an_edit_after_a_status_change_is_reported_as_this_sessions(client):
    """A sync's progress is recorded, then the user creates an account, so their page has already shown the latest change"""
    headers, user_id = await _sign_up(client)
    await _change_status(user_id)
    created = await _create_account(client, headers)
    assert created.status_code == 201, created.text

    reported = await _personal_status(client, headers)

    changed_at, status_changed_at = await _read_marks(user_id)
    assert status_changed_at < changed_at
    assert reported == (changed_at, True)


async def test_a_status_change_after_an_edit_is_reported_as_another_sessions(client):
    """The user creates an account, then a sync's progress is recorded, so their page still has to show it"""
    headers, user_id = await _sign_up(client)
    created = await _create_account(client, headers)
    assert created.status_code == 201, created.text
    await _change_status(user_id)

    reported = await _personal_status(client, headers)

    changed_at, status_changed_at = await _read_marks(user_id)
    assert changed_at < status_changed_at
    assert reported == (status_changed_at, False)
