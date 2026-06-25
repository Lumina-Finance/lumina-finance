"""Auth session service helpers"""

import uuid
from datetime import datetime

from sqlalchemy import delete, or_, update
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
    expired_token_delete_query = delete(AuthToken).where(
        or_(
            AuthToken.expires_at < sa_func.now(),
            AuthToken.refresh_grace_expires_at < sa_func.now(),
        ),
    )

    # Keep the token allowlist bounded to credentials that can still authorize requests or grace refreshes
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


async def delete_other_user_auth_sessions(
    db: AsyncSession,
    user_id: uuid.UUID,
    keep_session_id: uuid.UUID,
) -> None:
    """Delete a user's auth sessions except the one to keep

    Args:
        db: Active database session
        user_id: User whose other sessions are revoked
        keep_session_id: Session that stays active, normally the caller's own

    Returns:
        None
    """
    other_sessions_delete_query = delete(AuthSession).where(
        AuthSession.user_id == user_id,
        AuthSession.id != keep_session_id,
    )

    # Removing the sessions cascades to their token allowlist rows
    await db.execute(other_sessions_delete_query)


async def rotate_auth_session_tokens(
    db: AsyncSession,
    session_id: uuid.UUID,
    refresh_grace_expires_at: datetime,
) -> None:
    """Prepare a session for refresh token rotation

    Args:
        db: Active database session
        session_id: Session whose token rows should be rotated
        refresh_grace_expires_at: Grace expiry for the previous refresh token

    Returns:
        None
    """
    access_token_delete_query = delete(AuthToken).where(
        AuthToken.session_id == session_id,
        AuthToken.token_kind == AuthTokenKind.ACCESS,
    )

    # A new refresh invalidates the old access token immediately
    await db.execute(access_token_delete_query)

    previous_refresh_delete_query = delete(AuthToken).where(
        AuthToken.session_id == session_id,
        AuthToken.token_kind == AuthTokenKind.REFRESH,
        AuthToken.refresh_grace_expires_at.is_not(None),
    )

    # Only one previous refresh token is kept so reload races cannot accumulate token rows
    await db.execute(previous_refresh_delete_query)

    current_refresh_update_query = (
        update(AuthToken)
        .where(
            AuthToken.session_id == session_id,
            AuthToken.token_kind == AuthTokenKind.REFRESH,
            AuthToken.refresh_grace_expires_at.is_(None),
        )
        .values(refresh_grace_expires_at=refresh_grace_expires_at)
    )

    # The current refresh token remains usable only for the short rotation grace window
    await db.execute(current_refresh_update_query)


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
    refresh_grace_expires_at: datetime | None = None,
) -> AuthToken:
    """Return a new auth token allowlist row

    Args:
        user_id: User that owns the token
        session_id: Session identifier embedded in the token
        token_id: JWT identifier embedded in the token
        token_kind: Whether the token is an access or refresh token
        expires_at: Timestamp when the token expires
        refresh_grace_expires_at: Timestamp when previous-refresh grace expires

    Returns:
        Unsaved auth token model
    """
    auth_token = AuthToken(
        jti=token_id,
        user_id=user_id,
        session_id=session_id,
        token_kind=token_kind,
        expires_at=expires_at,
        refresh_grace_expires_at=refresh_grace_expires_at,
    )
    return auth_token
