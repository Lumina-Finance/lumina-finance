"""Auth session service tests"""

import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import select, text

from app.models.auth_session import AuthSession
from app.models.auth_token import AuthToken
from app.models.base import AuthTokenKind
from app.models.currency import Currency
from app.models.user import User
from app.services.auth.sessions import GRACE_ENDED_TOKEN_DELETE_LIMIT, delete_expired_auth_tokens, delete_grace_ended_refresh_tokens
from tests.conftest import ScopedSession, TestSession
from tests.routes.support.identity_helpers import _seed_users
from tests.routes.support.query_cost_helpers import SLACK, _avoid_full_scans, _rows_read


async def test_delete_expired_auth_tokens_keeps_active_allowlist_rows(db):
    """Expired tokens are deleted while active tokens stay allowlisted"""
    user = await _create_user(db)
    auth_session = AuthSession(
        user_id=user.id,
        expires_at=datetime.now(UTC) + timedelta(days=1),
    )
    db.add(auth_session)
    await db.flush()

    expired_token = AuthToken(
        jti=uuid4(),
        user_id=user.id,
        session_id=auth_session.id,
        token_kind=AuthTokenKind.ACCESS,
        expires_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    active_token = AuthToken(
        jti=uuid4(),
        user_id=user.id,
        session_id=auth_session.id,
        token_kind=AuthTokenKind.REFRESH,
        expires_at=datetime.now(UTC) + timedelta(days=1),
    )
    expired_grace_token = AuthToken(
        jti=uuid4(),
        user_id=user.id,
        session_id=auth_session.id,
        token_kind=AuthTokenKind.REFRESH,
        expires_at=datetime.now(UTC) + timedelta(days=1),
        refresh_grace_expires_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    db.add(expired_token)
    db.add(active_token)
    db.add(expired_grace_token)
    await db.flush()

    await delete_expired_auth_tokens(db)

    auth_token_query = select(AuthToken.jti)

    # Fetch remaining allowlisted tokens so cleanup cannot silently keep expired rows
    result = await db.execute(auth_token_query)
    remaining_token_ids = set(result.scalars().all())

    assert expired_token.jti not in remaining_token_ids
    assert expired_grace_token.jti not in remaining_token_ids
    assert active_token.jti in remaining_token_ids


async def _create_user(db) -> User:
    """Create a user for auth session service tests"""
    currency = Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2)
    user = User(
        email="session-service@example.com",
        first_name="Session",
        last_name="User",
        tz="America/Toronto",
        base_currency=currency.id,
    )
    db.add(currency)
    db.add(user)
    await db.flush()
    return user


async def _seed_tokens(grace_ended_count: int) -> tuple[list[UUID], dict[str, UUID]]:
    """Save rotated refresh tokens whose grace ended, and one token of each kind the cleanup must keep

    Each token has a session of its own, since a session holds one previous refresh token. The ended
    ones are stored newest first, so the order they were saved in is the opposite of the order they ended in

    Returns:
        The ended tokens' ids, oldest ended first, and the kept tokens' ids by what each is
    """
    (user,) = await _seed_users("rotation@example.com")
    now = datetime.now(UTC)
    future = now + timedelta(days=1)
    async with TestSession() as session:
        sessions = [AuthSession(user_id=user.id, expires_at=future) for _ in range(grace_ended_count + 3)]
        session.add_all(sessions)
        await session.flush()

        def token(index: int, kind: AuthTokenKind, expires_at: datetime, grace: datetime | None = None) -> AuthToken:
            return AuthToken(
                jti=uuid4(),
                user_id=user.id,
                session_id=sessions[index].id,
                token_kind=kind,
                expires_at=expires_at,
                refresh_grace_expires_at=grace,
            )

        ended = [token(index, AuthTokenKind.REFRESH, future, now - timedelta(minutes=1, seconds=index)) for index in range(grace_ended_count)]
        kept = {
            "still in grace": token(grace_ended_count, AuthTokenKind.REFRESH, future, now + timedelta(seconds=30)),
            "past its lifetime": token(grace_ended_count + 1, AuthTokenKind.ACCESS, now - timedelta(minutes=1)),
            "current": token(grace_ended_count + 2, AuthTokenKind.REFRESH, future),
        }
        session.add_all([*ended, *kept.values()])
        await session.commit()
        await session.execute(text("ANALYZE"))
        await session.commit()
    return [row.jti for row in reversed(ended)], {name: row.jti for name, row in kept.items()}


async def _remaining_jtis(session) -> set[UUID]:
    """Return every stored token's id as this session sees it"""
    return set(await session.scalars(select(AuthToken.jti)))


async def test_token_issue_deletes_the_oldest_hundred_of_many_ended_grace_tokens_and_nothing_else():
    """Exactly the cap goes, the ones that ended longest ago, while live and past-lifetime tokens stay"""
    ended, kept = await _seed_tokens(1000)

    async with ScopedSession() as session:
        await delete_grace_ended_refresh_tokens(session)
        remaining = await _remaining_jtis(session)

    deleted = set(ended) - remaining
    assert deleted == set(ended[:GRACE_ENDED_TOKEN_DELETE_LIMIT]), "the 100 that ended longest ago go, and no more"
    assert set(kept.values()) <= remaining, "tokens still in grace, past their lifetime or current stay"


async def test_token_issue_deletes_every_ended_grace_token_when_fewer_than_the_cap():
    """Under the cap all go at once, and only those"""
    _ended, kept = await _seed_tokens(40)

    async with ScopedSession() as session:
        await delete_grace_ended_refresh_tokens(session)
        remaining = await _remaining_jtis(session)

    assert remaining == set(kept.values())


async def test_token_issue_reads_about_the_cap_of_tokens_among_many_ended():
    """The oldest few are found through the index, not by reading every ended grace token"""
    await _seed_tokens(1000)

    async with ScopedSession() as session:
        await _avoid_full_scans(session)
        await delete_grace_ended_refresh_tokens(session)
        rows_read = await _rows_read(session, "auth_tokens")

    # Each of the cap's tokens is read once to choose it and once to delete it by key
    assert rows_read < 2 * GRACE_ENDED_TOKEN_DELETE_LIMIT + SLACK


async def test_token_issue_passes_over_an_ended_grace_token_another_request_holds():
    """A token a rotation is still working on is left for it, and token issue neither waits nor stops short"""
    ended, _kept = await _seed_tokens(GRACE_ENDED_TOKEN_DELETE_LIMIT + 50)
    held = ended[0]

    # Bounded so that waiting on the held row fails this test rather than hanging it
    async with TestSession() as holder:
        await holder.execute(text("SELECT jti FROM auth_tokens WHERE jti = :jti FOR UPDATE"), {"jti": held})
        async with asyncio.timeout(5), ScopedSession() as session:
            await delete_grace_ended_refresh_tokens(session)
            await session.commit()
        await holder.rollback()

    async with TestSession() as session:
        remaining = await _remaining_jtis(session)
    assert held in remaining
    assert len(set(ended) - remaining) == GRACE_ENDED_TOKEN_DELETE_LIMIT, "the next ones took its place in the cap"
