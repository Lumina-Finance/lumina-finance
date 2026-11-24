"""Auth session service helpers"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import ColumnElement, and_, delete, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func as sa_func

from app.config.jwt import SESSION_MAX_AGE_SECONDS
from app.db.rls.functions import ROTATE_SAVED_COPY_KEY
from app.models.auth_session import AuthSession
from app.models.auth_token import AuthToken
from app.models.base import AuthTokenKind
from app.models.user import User

# The most rotated refresh tokens one token issue removes, so a backlog never slows a sign-in. Each
# refresh leaves one and every refresh issues tokens, so ordinary traffic clears them all as they end
GRACE_ENDED_TOKEN_DELETE_LIMIT = 100

# The most live sessions one person holds: twice a typical person's phone, tablet and browsers, with
# room for private windows, so repeated sign-ins can't pile up sessions and normal use never signs a
# device out
MAX_LIVE_SESSIONS_PER_USER = 10


def is_session_live() -> ColumnElement[bool]:
    """Return the condition a session row meets while it can still authorize requests and refreshes

    It is read from the row, never only stored in its expiry, so a session older than the maximum age
    stops working at once, including one that was already signed in when the limit began

    Returns:
        SQL condition for a session that has neither expired nor outlived the maximum age
    """
    return and_(
        AuthSession.expires_at > sa_func.now(),
        AuthSession.created_at > sa_func.now() - timedelta(seconds=SESSION_MAX_AGE_SECONDS),
    )


async def lock_user_for_session_changes(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Hold the user's row until the transaction ends, before touching any of their session rows

    Every flow that adds a session, or ends sessions other than the caller's own, takes this row first,
    here or through the saved copy key rotation's update, so two such flows wait for each other rather
    than deadlock. A sign-out ending only its own session needs no order, since it never waits on a
    lock a sign-in holds. The row is visible only once the request has adopted the user's identity, so
    a missing one fails loudly

    Args:
        db: Active database session
        user_id: User whose sessions are about to change
    """
    (await db.execute(select(User.id).where(User.id == user_id).with_for_update(key_share=True))).scalar_one()


async def end_sessions_past_limit(db: AsyncSession, user_id: uuid.UUID) -> None:
    """End the sessions renewed longest ago, leaving room for one more within the limit

    Each refresh moves a session's expiry on, so the earliest expiry is the session renewed or signed
    in longest ago. Sessions no longer live aren't counted, and the scheduled cleanup removes them.
    Ending one doesn't move the saved copy key on, just as a sign-out doesn't

    Args:
        db: Active database session
        user_id: User about to start a new session
    """
    await lock_user_for_session_changes(db, user_id)
    surplus_session_ids = (
        await db.scalars(
            select(AuthSession.id)
            .where(AuthSession.user_id == user_id, is_session_live())
            .order_by(AuthSession.expires_at.desc(), AuthSession.created_at.desc(), AuthSession.id)
            .offset(MAX_LIVE_SESSIONS_PER_USER - 1)
        )
    ).all()
    if surplus_session_ids:
        # Removing the sessions cascades to their token allowlist rows
        await db.execute(delete(AuthSession).where(AuthSession.id.in_(surplus_session_ids)))


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


async def delete_grace_ended_refresh_tokens(db: AsyncSession) -> None:
    """Delete the oldest rotated refresh tokens whose grace has ended, up to a cap

    Only these rows change an answer: while one exists a late refresh with its token signs the user
    out, and once it is gone the refresh gets a conflict instead, so the newer cookie another tab holds
    keeps working. Tokens past their lifetime are left to the scheduled cleanup, since a token's own
    expiry already refuses it before its row is looked up

    Args:
        db: Active database session
    """
    # Chosen first and deleted by key, since a delete that selects its own rows with a limit and a
    # skip of locked ones can run its selection again and remove more than the cap
    grace_ended_jtis = (
        await db.scalars(
            select(AuthToken.jti)
            .where(AuthToken.refresh_grace_expires_at < sa_func.now())
            .order_by(AuthToken.refresh_grace_expires_at)
            .limit(GRACE_ENDED_TOKEN_DELETE_LIMIT)
            .with_for_update(skip_locked=True)
        )
    ).all()
    if grace_ended_jtis:
        await db.execute(delete(AuthToken).where(AuthToken.jti.in_(grace_ended_jtis)))


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


async def _rotate_saved_copy_key(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Raise the user's saved copy key number in the unit of work that ends their sessions

    Every browser holding the old key then loses its saved copy. The key number is read again for
    a user already loaded in this unit of work, so the response of the rotating request carries
    the new key. An account locked out before sign-in has no loaded user, since the users policy
    hides the row until an identity is set

    Args:
        db: Active database session
        user_id: User whose saved copies stop being readable
    """
    await db.execute(text(f"SELECT {ROTATE_SAVED_COPY_KEY}(:user_id)"), {"user_id": user_id})
    user = await db.get(User, user_id)
    if user is not None:
        await db.refresh(user, ["saved_copy_key_version"])


async def delete_other_user_auth_sessions(
    db: AsyncSession,
    user_id: uuid.UUID,
    keep_session_id: uuid.UUID,
) -> None:
    """Delete a user's auth sessions except the one to keep, and rotate their saved copy key

    Args:
        db: Active database session
        user_id: User whose other sessions are revoked
        keep_session_id: Session that stays active, normally the caller's own

    Returns:
        None
    """
    # The rotation's update takes the user's row before any session row, in the order
    # lock_user_for_session_changes describes
    await _rotate_saved_copy_key(db, user_id)

    other_sessions_delete_query = delete(AuthSession).where(
        AuthSession.user_id == user_id,
        AuthSession.id != keep_session_id,
    )

    # Removing the sessions cascades to their token allowlist rows
    await db.execute(other_sessions_delete_query)


async def end_other_sessions(db: AsyncSession, user_id: uuid.UUID, current_session_id: uuid.UUID) -> None:
    """Sign a user out of every device but the one asking, as its own unit of work

    The caller authorizes the request first

    Args:
        db: Active database session
        user_id: User whose other sessions end
        current_session_id: Session that made the request and stays signed in
    """
    await delete_other_user_auth_sessions(db, user_id, current_session_id)
    await db.commit()


async def delete_all_user_auth_sessions(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Delete every auth session for a user, and rotate their saved copy key

    Args:
        db: Active database session
        user_id: User whose sessions are all revoked

    Returns:
        None
    """
    # The rotation's update takes the user's row before any session row, in the order
    # lock_user_for_session_changes describes. It also works before sign-in, when the
    # request has no identity yet and the row is hidden from a plain lock
    await _rotate_saved_copy_key(db, user_id)

    sessions_delete_query = delete(AuthSession).where(AuthSession.user_id == user_id)

    # Removing the sessions cascades to their token allowlist rows
    await db.execute(sessions_delete_query)


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
