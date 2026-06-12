"""Auth session service helpers"""

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func as sa_func

from app.models.auth_session import AuthSession


async def delete_expired_auth_sessions(db: AsyncSession) -> None:
    """Delete expired auth session allowlist rows

    Args:
        db: Active database session

    Returns:
        None
    """
    expired_session_delete_query = delete(AuthSession).where(AuthSession.expires_at < sa_func.now())

    # Keep the active-session allowlist bounded to sessions that can still authorize requests
    await db.execute(expired_session_delete_query)
