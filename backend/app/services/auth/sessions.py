"""Auth session service helpers"""

import uuid
from datetime import datetime

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func as sa_func

from app.models.auth_session import AuthSession
from app.models.auth_token import AuthToken
from app.models.base import AuthTokenKind


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


async def delete_expired_auth_tokens(db: AsyncSession) -> None:
    """Delete expired auth token allowlist rows

    Args:
        db: Active database session

    Returns:
        None
    """
    expired_token_delete_query = delete(AuthToken).where(AuthToken.expires_at < sa_func.now())

    # Keep the token allowlist bounded to credentials that can still authorize requests
    await db.execute(expired_token_delete_query)


async def delete_auth_session(db: AsyncSession, session_id: uuid.UUID) -> None:
    """Delete one auth session and its allowlisted tokens

    Args:
        db: Active database session
        session_id: Session identifier to remove from the allowlist

    Returns:
        None
    """
    session_delete_query = delete(AuthSession).where(AuthSession.id == session_id)

    # Removing the session cascades to its token allowlist rows
    await db.execute(session_delete_query)


async def delete_auth_session_tokens(db: AsyncSession, session_id: uuid.UUID) -> None:
    """Delete every allowlisted token for a session

    Args:
        db: Active database session
        session_id: Session whose token rows should be removed

    Returns:
        None
    """
    token_delete_query = delete(AuthToken).where(AuthToken.session_id == session_id)

    # Refresh rotation replaces both token rows so stale access and refresh tokens stop authorizing
    await db.execute(token_delete_query)


def create_auth_session(user_id: uuid.UUID, session_id: uuid.UUID, expires_at: datetime) -> AuthSession:
    """Return a new auth session allowlist row

    Args:
        user_id: User that owns the login session
        session_id: Session identifier embedded in issued tokens
        expires_at: Timestamp when the session expires

    Returns:
        Unsaved auth session model
    """
    auth_session = AuthSession(id=session_id, user_id=user_id, expires_at=expires_at)
    return auth_session


def create_auth_token(
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    token_id: uuid.UUID,
    token_kind: AuthTokenKind,
    expires_at: datetime,
) -> AuthToken:
    """Return a new auth token allowlist row

    Args:
        user_id: User that owns the token
        session_id: Session identifier embedded in the token
        token_id: JWT identifier embedded in the token
        token_kind: Whether the token is an access or refresh token
        expires_at: Timestamp when the token expires

    Returns:
        Unsaved auth token model
    """
    auth_token = AuthToken(
        jti=token_id,
        user_id=user_id,
        session_id=session_id,
        token_kind=token_kind,
        expires_at=expires_at,
    )
    return auth_token
