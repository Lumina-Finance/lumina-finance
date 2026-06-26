"""JWT token creation helpers"""
import uuid
from datetime import UTC, datetime, timedelta

import jwt

from app.config import (
    JWT_ACCESS_KID,
    JWT_ACCESS_PRIVATE_KEY,
    JWT_ACCESS_TOKEN_EXPIRE_SECONDS,
    JWT_ALGORITHM,
    JWT_ISSUER,
    JWT_REFRESH_KID,
    JWT_REFRESH_PRIVATE_KEY,
    JWT_REFRESH_TOKEN_EXPIRE_SECONDS,
    MFA_CHALLENGE_TOKEN_EXPIRE_SECONDS,
)
from app.models.base import AuthTokenKind

# Token use claim for the step-up challenge
MFA_CHALLENGE_TOKEN_USE = "mfa_challenge"  # noqa: S105 — token use claim, not a secret


def create_access_token(user_id: uuid.UUID, session_id: uuid.UUID) -> tuple[str, uuid.UUID, datetime]:
    """Create a short-lived JWT access token

    Args:
        user_id: User identifier to embed as the token subject
        session_id: Shared session identifier for the access and refresh pair

    Returns:
        Encoded JWT, token identifier, and expiration timestamp
    """
    token = _create_signed_token(
        user_id,
        session_id,
        expires_in_seconds=JWT_ACCESS_TOKEN_EXPIRE_SECONDS,
        private_key=JWT_ACCESS_PRIVATE_KEY,
        key_id=JWT_ACCESS_KID,
        token_use=AuthTokenKind.ACCESS.value,
    )
    return token


def create_refresh_token(user_id: uuid.UUID, session_id: uuid.UUID) -> tuple[str, uuid.UUID, datetime]:
    """Create a longer-lived JWT refresh token

    Args:
        user_id: User identifier to embed as the token subject
        session_id: Shared session identifier for refresh rotation and logout

    Returns:
        Encoded JWT, token identifier, and expiration timestamp
    """
    token = _create_signed_token(
        user_id,
        session_id,
        expires_in_seconds=JWT_REFRESH_TOKEN_EXPIRE_SECONDS,
        private_key=JWT_REFRESH_PRIVATE_KEY,
        key_id=JWT_REFRESH_KID,
        token_use=AuthTokenKind.REFRESH.value,
    )
    return token


def create_mfa_challenge_token(user_id: uuid.UUID) -> tuple[str, uuid.UUID, datetime]:
    """Create a short-lived second-factor challenge token signed with the access RSA private key

    Args:
        user_id: User identifier to embed as the token subject

    Returns:
        Encoded JWT, token identifier, and expiration timestamp
    """
    token = _create_signed_token(
        user_id,
        expires_in_seconds=MFA_CHALLENGE_TOKEN_EXPIRE_SECONDS,
        private_key=JWT_ACCESS_PRIVATE_KEY,
        key_id=JWT_ACCESS_KID,
        token_use=MFA_CHALLENGE_TOKEN_USE,
    )
    return token


def _create_signed_token(
    user_id: uuid.UUID,
    session_id: uuid.UUID | None = None,
    *,
    expires_in_seconds: int,
    private_key: str,
    key_id: str,
    token_use: str,
) -> tuple[str, uuid.UUID, datetime]:
    """Create a signed JWT token with shared auth claims

    Args:
        user_id: User identifier to embed as the token subject
        session_id: Shared session identifier for token-pair operations, omitted for the pre-session challenge
        expires_in_seconds: Number of seconds until the token expires
        private_key: Private key used to sign the token
        key_id: Key identifier added to the JWT headers
        token_use: Token use claim that separates access, refresh, and challenge tokens

    Returns:
        Encoded JWT, token identifier, and expiration timestamp
    """
    issued_at = datetime.now(UTC)
    token_id = uuid.uuid4()
    expires_at = issued_at + timedelta(seconds=expires_in_seconds)
    payload = {
        "sub": str(user_id),
        "jti": str(token_id),
        "token_use": token_use,
        "iat": issued_at,
        "exp": expires_at,
        "iss": JWT_ISSUER,
    }

    # The challenge token is issued before a session exists, so it carries no sid
    if session_id is not None:
        payload["sid"] = str(session_id)

    encoded_token = jwt.encode(payload, private_key, algorithm=JWT_ALGORITHM, headers={"kid": key_id})
    token = (encoded_token, token_id, expires_at)
    return token
