"""Second-factor challenge issue and consume service"""

import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func as sa_func

from app.models.auth import MfaChallenge
from app.services.auth.tokens import create_mfa_challenge_token

# A challenge only verifies within the flow that issued it, so a reset challenge can never
# complete a login and vice versa
MFA_PURPOSE_LOGIN = "login"
MFA_PURPOSE_PASSWORD_RESET = "password_reset"  # noqa: S105


async def delete_expired_mfa_challenges(db: AsyncSession) -> None:
    """Delete challenges whose expiry has passed

    Args:
        db: Active database session
    """
    expired_delete_query = delete(MfaChallenge).where(MfaChallenge.expires_at < sa_func.now())

    # Unconsumed challenges are never cleaned up otherwise, so prune them opportunistically
    await db.execute(expired_delete_query)


async def issue_mfa_challenge(db: AsyncSession, user_id: uuid.UUID, purpose: str) -> str:
    """Issue a single-use challenge token after a verified first step

    Args:
        db: Active database session
        user_id: User who passed the first step
        purpose: Flow the challenge is scoped to

    Returns:
        Encoded challenge JWT for the second-factor step
    """
    await delete_expired_mfa_challenges(db)

    challenge_token, jti, expires_at = create_mfa_challenge_token(user_id)
    db.add(MfaChallenge(jti=jti, user_id=user_id, purpose=purpose, expires_at=expires_at))
    await db.commit()
    return challenge_token


async def is_mfa_challenge_active(db: AsyncSession, jti: uuid.UUID, user_id: uuid.UUID, purpose: str) -> bool:
    """Return whether an unexpired challenge still exists without consuming it

    A passkey second-factor ceremony issues its options before the challenge is spent, so this checks
    the challenge is still live without claiming it

    Args:
        db: Active database session
        jti: Challenge identifier from the verified token claims
        user_id: User the verified token claims to belong to
        purpose: Flow the challenge must be scoped to

    Returns:
        Whether a matching unexpired challenge exists
    """
    active_query = select(MfaChallenge.jti).where(
        MfaChallenge.jti == jti,
        MfaChallenge.user_id == user_id,
        MfaChallenge.purpose == purpose,
        MfaChallenge.expires_at > sa_func.now(),
    )
    result = await db.execute(active_query)
    return result.first() is not None


async def consume_mfa_challenge(db: AsyncSession, jti: uuid.UUID, user_id: uuid.UUID, purpose: str) -> bool:
    """Claim a challenge so it authorizes exactly one second-factor verification

    The delete is conditional so a replay or a concurrent request finds the row already gone or
    expired. The caller commits the surrounding transaction

    Args:
        db: Active database session
        jti: Challenge identifier from the verified token claims
        user_id: User the verified token claims to belong to
        purpose: Flow the challenge must be scoped to

    Returns:
        Whether an unexpired challenge was claimed
    """
    claim_query = delete(MfaChallenge).where(
        MfaChallenge.jti == jti,
        MfaChallenge.user_id == user_id,
        MfaChallenge.purpose == purpose,
        MfaChallenge.expires_at > sa_func.now(),
    )

    # Delete the row in one statement so single use holds under concurrent verifies
    result = await db.execute(claim_query)
    return result.rowcount == 1
