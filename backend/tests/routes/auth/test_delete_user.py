"""Deleting a user from code built on the app, through the routine a person's own Delete profile runs"""

import uuid

from sqlalchemy import select

from app.models.user import User
from app.services.profile_deletion import delete_marked_profiles, delete_user, removal
from app.services.profile_deletion.request import request_profile_deletion
from tests.conftest import ScopedSession, TestSession
from tests.routes.support import (
    SIGNUP_PAYLOAD,
    _get_auth_header,
    _link_sign_in_providers,
    _seed_currency,
    _sign_in_again,
    sign_up_confirmed,
)
from tests.routes.support.authorization_helpers import OLD_ACCESS, _commit_rejected_connection
from tests.routes.support.bank_sync_helpers import _build_account
from tests.routes.support.deletion_helpers import _row_counts, _user_exists

_PASSWORD = SIGNUP_PAYLOAD["password"]


async def _marked_at(user_id: uuid.UUID):
    """When the user was marked for deletion, or None, failing when the user row is gone"""
    async with TestSession() as session:
        return (await session.execute(select(User.deletion_requested_at).where(User.id == user_id))).scalar_one()


async def _sign_up_with_everything(client) -> uuid.UUID:
    """Sign the default user up with a password, a second device, a linked provider, an account and a bank connection"""
    signup = await sign_up_confirmed(client, SIGNUP_PAYLOAD)
    assert signup.status_code == 201, signup.text
    user_id = uuid.UUID(signup.json()["user"]["id"])
    await _sign_in_again(client)
    await _link_sign_in_providers(user_id, 1)
    await _commit_rejected_connection(user_id, rejected=False)
    async with TestSession() as session:
        session.add(_build_account(user_id))
        await session.commit()
    return user_id


async def test_deleting_a_user_leaves_the_database_as_it_was_without_them_and_frees_the_address(
    client, authorizing_provider, profile_deletions
):
    """Every table holds just the bystander's rows again, the bank access goes back, observers hear once, and the address can sign up"""
    await _seed_currency()
    bystander = await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": "bystander@example.com"})
    assert bystander.status_code == 201, bystander.text
    without_user = await _row_counts()
    user_id = await _sign_up_with_everything(client)

    assert await delete_user(user_id, session_factory=ScopedSession) is True

    # The sign-in provider the user was linked to is the install's, so it stays
    expected = {**without_user, "oidc_providers": without_user["oidc_providers"] + 1}
    assert await _row_counts() == expected, "every row the user held is gone, sign-in methods and sessions included"
    assert authorizing_provider.released == [OLD_ACCESS]
    assert [deletion.user_id for deletion in profile_deletions] == [user_id]
    assert (await client.get("/auth/2fa/status", headers=_get_auth_header(bystander))).status_code == 200
    again = await sign_up_confirmed(client, SIGNUP_PAYLOAD)
    assert again.status_code == 201, again.text
    assert uuid.UUID(again.json()["user"]["id"]) != user_id


async def test_deleting_a_user_whose_own_deletion_is_under_way_finishes_it_once(client, profile_deletions):
    """A deletion its owner asked for, data not yet gone, is finished by the call, observers hear once, and a second call finds no one"""
    await _seed_currency()
    user_id = await _sign_up_with_everything(client)
    async with TestSession() as session:
        user = await session.get(User, user_id)

        class _NoBackground:
            def add_task(self, *_args) -> None:
                """Leave the removal for the call under test"""

        await request_profile_deletion(session, user, _NoBackground(), ScopedSession)
    assert await _marked_at(user_id) is not None

    assert await delete_user(user_id, session_factory=ScopedSession) is True
    assert await delete_user(user_id, session_factory=ScopedSession) is True

    assert not await _user_exists(user_id)
    assert [deletion.user_id for deletion in profile_deletions] == [user_id]


async def test_a_deletion_cut_short_answers_false_and_the_next_cleanup_pass_finishes_it(client, profile_deletions, monkeypatch):
    """The user stays marked, so they can't sign in, and the cleanup deletes them later as it does for Delete profile"""
    await _seed_currency()
    user_id = await _sign_up_with_everything(client)
    finish = removal._delete_user_row

    async def fail(*_args):
        raise RuntimeError("the database went away")

    monkeypatch.setattr(removal, "_delete_user_row", fail)
    assert await delete_user(user_id, session_factory=ScopedSession) is False
    assert await _marked_at(user_id) is not None
    sign_in = await client.post("/auth/login", json={"email": SIGNUP_PAYLOAD["email"], "password": _PASSWORD})
    assert sign_in.status_code == 401
    assert profile_deletions == []

    monkeypatch.setattr(removal, "_delete_user_row", finish)
    await delete_marked_profiles(ScopedSession)

    assert not await _user_exists(user_id)
    assert [deletion.user_id for deletion in profile_deletions] == [user_id]
