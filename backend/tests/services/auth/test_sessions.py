"""Auth session service tests"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select

from app.models.auth_session import AuthSession
from app.models.auth_token import AuthToken
from app.models.base import AuthTokenKind
from app.models.currency import Currency
from app.models.user import User
from app.services.auth.sessions import delete_expired_auth_sessions, delete_expired_auth_tokens


async def test_delete_expired_auth_sessions_keeps_active_allowlist_rows(db):
    """Expired sessions are deleted while active sessions stay allowlisted"""
    user = await _create_user(db)
    expired_session = AuthSession(
        user_id=user.id,
        expires_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    active_session = AuthSession(
        user_id=user.id,
        expires_at=datetime.now(UTC) + timedelta(days=1),
    )
    db.add(expired_session)
    db.add(active_session)
    await db.flush()

    await delete_expired_auth_sessions(db)

    auth_session_query = select(AuthSession.id)

    # Fetch remaining allowlisted sessions so cleanup cannot silently keep expired rows
    result = await db.execute(auth_session_query)
    remaining_session_ids = set(result.scalars().all())

    assert expired_session.id not in remaining_session_ids
    assert active_session.id in remaining_session_ids


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
