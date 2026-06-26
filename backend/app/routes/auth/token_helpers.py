"""Auth token route helpers"""
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from cryptography.hazmat.primitives.serialization import load_pem_private_key
from fastapi import Request, Response
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func as sa_func

from app.config import (
    JWT_ACCESS_PRIVATE_KEY,
    JWT_ALGORITHM,
    JWT_ISSUER,
    JWT_REFRESH_PRIVATE_KEY,
    JWT_REFRESH_ROTATION_GRACE_SECONDS,
)
from app.models.auth_session import AuthSession
from app.models.auth_token import AuthToken
from app.models.base import AuthTokenKind
from app.models.user import User
from app.routes.auth.cookie_helpers import set_refresh_cookie
from app.schemas.auth import AuthResponse, UserInfo
from app.services.auth.sessions import (
    create_auth_session,
    create_auth_token,
    delete_expired_auth_sessions,
    delete_expired_auth_tokens,
    rotate_auth_session_tokens,
)
from app.services.auth.tokens import MFA_CHALLENGE_TOKEN_USE, create_access_token, create_refresh_token

_refresh_public_key = load_pem_private_key(JWT_REFRESH_PRIVATE_KEY.encode(), password=None).public_key()
_access_public_key = load_pem_private_key(JWT_ACCESS_PRIVATE_KEY.encode(), password=None).public_key()


def get_refresh_public_key():
    """Return the public key used to verify refresh tokens

    Returns:
        Refresh JWT public key
    """
    return _refresh_public_key


def get_access_public_key():
    """Return the public key used to verify access tokens

    Returns:
        Access JWT public key
    """
    return _access_public_key


def decode_refresh_token(refresh_token: str) -> dict[str, Any]:
    """Return decoded refresh token claims

    Args:
        refresh_token: Encoded refresh JWT string

    Returns:
        Decoded refresh token claims

    Raises:
        PyJWTError: Refresh token cannot be decoded or verified
    """
    payload = jwt.decode(refresh_token, _refresh_public_key, algorithms=[JWT_ALGORITHM], issuer=JWT_ISSUER)
    _raise_for_token_use(payload, "refresh")
    return payload


def decode_access_token(access_token: str) -> dict[str, Any]:
    """Return decoded access token claims

    Args:
        access_token: Encoded access JWT string

    Returns:
        Decoded access token claims

    Raises:
        PyJWTError: Access token cannot be decoded or verified
    """
    payload = jwt.decode(access_token, _access_public_key, algorithms=[JWT_ALGORITHM], issuer=JWT_ISSUER)
    _raise_for_token_use(payload, "access")
    return payload


def decode_mfa_challenge_token(challenge_token: str) -> dict[str, Any]:
    """Return decoded challenge token claims

    Args:
        challenge_token: Encoded challenge JWT string

    Returns:
        Decoded challenge token claims

    Raises:
        PyJWTError: Challenge token cannot be decoded or verified
    """
    payload = jwt.decode(challenge_token, _access_public_key, algorithms=[JWT_ALGORITHM], issuer=JWT_ISSUER)
    _raise_for_token_use(payload, MFA_CHALLENGE_TOKEN_USE)
    return payload


def _raise_for_token_use(payload: dict[str, Any], expected_token_use: str) -> None:
    """Raise when a decoded token has the wrong use claim

    Args:
        payload: Decoded JWT claims
        expected_token_use: Token use required by the caller

    Raises:
        InvalidTokenError: Token use claim is missing or mismatched
    """
    if payload.get("token_use") != expected_token_use:
        raise jwt.InvalidTokenError("Invalid token use")


async def get_active_token_by_jti(
    db: AsyncSession,
    token_jti: uuid.UUID,
    user_id: uuid.UUID,
    token_kind: AuthTokenKind,
) -> AuthToken | None:
    """Return an active token allowlist row by JWT identifier

    Args:
        db: Active database session
        token_jti: JWT identifier from token claims
        user_id: User the verified token claims to belong to
        token_kind: Expected token kind for this auth path

    Returns:
        Active token row when the JWT identifier is allowlisted and unexpired
    """
    # Scope by user as well as the signature-bound jti so a token can never resolve
    # against another user's allowlist row
    active_token_query = select(AuthToken).where(
        AuthToken.jti == token_jti,
        AuthToken.user_id == user_id,
        AuthToken.token_kind == token_kind,
        AuthToken.expires_at > sa_func.now(),
    )
    if token_kind == AuthTokenKind.REFRESH:
        active_token_query = active_token_query.where(
            or_(
                AuthToken.refresh_grace_expires_at.is_(None),
                AuthToken.refresh_grace_expires_at > sa_func.now(),
            ),
        )

    # Fetch the token allowlist row so only currently valid credentials authorize
    result = await db.execute(active_token_query)
    active_token = result.scalar_one_or_none()
    return active_token


async def get_token_by_jti(
    db: AsyncSession,
    token_jti: uuid.UUID,
    user_id: uuid.UUID,
    token_kind: AuthTokenKind,
) -> AuthToken | None:
    """Return a token allowlist row by JWT identifier without active-window checks

    Args:
        db: Active database session
        token_jti: JWT identifier from token claims
        user_id: User the verified token claims to belong to
        token_kind: Expected token kind for this auth path

    Returns:
        Token row when the JWT identifier is still present in the allowlist table
    """
    # Scope by user as well as the signature-bound jti so a token can never resolve
    # against another user's allowlist row
    token_query = select(AuthToken).where(
        AuthToken.jti == token_jti,
        AuthToken.user_id == user_id,
        AuthToken.token_kind == token_kind,
    )

    # Fetch the raw allowlist row so refresh can distinguish expired grace from rotated-away tokens
    result = await db.execute(token_query)
    token = result.scalar_one_or_none()
    return token


async def get_active_session_by_id(
    db: AsyncSession,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    lock_for_update: bool = False,
) -> AuthSession | None:
    """Return an active auth session by identifier

    Args:
        db: Active database session
        session_id: Session identifier from token claims
        user_id: User identifier from token claims
        lock_for_update: Whether to lock the session row for rotation-sensitive checks

    Returns:
        Auth session row when it is allowlisted and unexpired
    """
    active_session_query = select(AuthSession).where(
        AuthSession.id == session_id,
        AuthSession.user_id == user_id,
        AuthSession.expires_at > sa_func.now(),
    )
    if lock_for_update:
        active_session_query = active_session_query.with_for_update()

    # Fetch the session allowlist row so tokens cannot authorize after logout or expiry
    result = await db.execute(active_session_query)
    active_session = result.scalar_one_or_none()
    return active_session


async def get_user_by_id(db: AsyncSession, user_id: str) -> User | None:
    """Return a user row by identifier

    Args:
        db: Active database session
        user_id: User identifier from token claims

    Returns:
        User row when the token subject still exists
    """
    user_query = select(User).where(User.id == user_id)

    # Fetch the token subject so refresh fails if the user no longer exists
    result = await db.execute(user_query)
    user = result.scalar_one_or_none()
    return user


async def issue_and_store_tokens(
    db: AsyncSession,
    request: Request,
    response: Response,
    user: User,
    session_id: uuid.UUID | None = None,
) -> AuthResponse:
    """Create a token pair, store it, and set the refresh cookie

    Args:
        db: Active database session
        request: FastAPI request object
        response: FastAPI response object for setting the refresh cookie
        user: Authenticated user receiving the tokens
        session_id: Existing session identifier reused during refresh

    Returns:
        Auth response with user info and access token
    """
    await delete_expired_auth_tokens(db)
    await delete_expired_auth_sessions(db)

    is_new_session = session_id is None
    if session_id is None:
        session_id = uuid.uuid4()

    access_token, access_jti, access_exp = create_access_token(user.id, session_id)
    refresh_token, refresh_jti, refresh_exp = create_refresh_token(user.id, session_id)

    if is_new_session:
        db.add(create_auth_session(user.id, session_id, refresh_exp))
    else:
        auth_session = await get_active_session_by_id(db, session_id, user.id)
        if auth_session is None:
            raise RuntimeError("Cannot issue tokens for a missing auth session")
        auth_session.expires_at = refresh_exp
        refresh_grace_expires_at = _get_refresh_grace_expiry()
        await rotate_auth_session_tokens(db, session_id, refresh_grace_expires_at)

    db.add(create_auth_token(user.id, session_id, access_jti, AuthTokenKind.ACCESS, access_exp))
    db.add(create_auth_token(user.id, session_id, refresh_jti, AuthTokenKind.REFRESH, refresh_exp))
    await db.commit()

    set_refresh_cookie(request, response, refresh_token)
    auth_response = AuthResponse(user=UserInfo.model_validate(user), access_token=access_token)
    return auth_response


def _get_refresh_grace_expiry() -> datetime:
    """Return when the previous refresh token should stop working

    Returns:
        UTC timestamp for the refresh rotation grace deadline
    """
    grace_expires_at = datetime.now(UTC) + timedelta(seconds=JWT_REFRESH_ROTATION_GRACE_SECONDS)
    return grace_expires_at
