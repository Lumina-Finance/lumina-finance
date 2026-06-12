"""Auth session service tests"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.models.auth_session import AuthSession
from app.models.currency import Currency
from app.models.user import User
from app.services.auth.sessions import delete_expired_auth_sessions


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
