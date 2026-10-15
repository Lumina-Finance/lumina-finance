"""Native app handoff: a web sign-in in the app's system sheet handing its session to the app"""

import base64
import hashlib
import hmac
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func as sa_func

from app.models.auth import MfaChallenge
from app.models.auth_session import AuthSession
from app.models.user import User
from app.services.auth.mfa_challenge import consume_mfa_challenge, delete_expired_mfa_challenges
from app.services.auth.sessions import delete_auth_session
from app.services.auth.tokens import create_native_handoff_token

# The handoff's single use rides on the challenge table, under a purpose no other flow accepts
NATIVE_HANDOFF_PURPOSE = "native_handoff"

# How long after a sign-in its page may hand the session over, so a long-open tab can't. A sign-up
# hands off only once its second factor and recovery codes are set up, which takes a few minutes
HANDOFF_WINDOW = timedelta(minutes=10)


async def issue_native_handoff_code(
    db: AsyncSession, user_id: uuid.UUID, session_id: uuid.UUID, code_challenge: str
) -> str | None:
    """Return a single-use code that hands a fresh web session to the app holding the challenge's verifier

    Args:
        db: Active database session
        user_id: The signed-in user
        session_id: The web session the page signed in with
        code_challenge: The app's PKCE challenge, which the code is bound to

    Returns:
        The code, or None when the session didn't begin within the handoff window
    """
    signed_in_at = await db.scalar(
        select(AuthSession.created_at).where(AuthSession.id == session_id, AuthSession.user_id == user_id)
    )
    if signed_in_at is None or datetime.now(UTC) - signed_in_at > HANDOFF_WINDOW:
        return None

    await delete_expired_mfa_challenges(db)
    code, jti, expires_at = create_native_handoff_token(user_id, session_id, code_challenge)
    db.add(MfaChallenge(jti=jti, user_id=user_id, purpose=NATIVE_HANDOFF_PURPOSE, expires_at=expires_at))
    await db.commit()
    return code


async def redeem_native_handoff_code(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    jti: uuid.UUID,
    code_challenge: str,
    code_verifier: str,
) -> User | None:
    """Spend a handed-off code and end the web session it came from, for the app to start its own

    Args:
        db: Active database session
        user_id: The code's user
        session_id: The web session the code hands over
        jti: The code's single-use identifier
        code_challenge: The PKCE challenge the code is bound to
        code_verifier: The verifier the app presents

    Returns:
        The user to start the app's session for, or None when the code is spent, expired or wrong,
        or its web session has ended
    """
    # Locking the web session first means two codes for one session queue here, and the second
    # finds the session already gone once the first has replaced it
    web_session = await db.scalar(
        select(AuthSession)
        .where(AuthSession.id == session_id, AuthSession.user_id == user_id, AuthSession.expires_at > sa_func.now())
        .with_for_update()
    )
    if web_session is None:
        return None

    # Spent before the verifier is checked, so a wrong guess burns the code rather than allowing another
    if not await consume_mfa_challenge(db, jti, user_id, NATIVE_HANDOFF_PURPOSE):
        return None
    if not hmac.compare_digest(_s256_challenge(code_verifier), code_challenge):
        await db.commit()
        return None

    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None:
        return None

    # The web session only existed to carry the sign-in to the app, so it ends as the app's begins
    await delete_auth_session(db, session_id)
    return user


def _s256_challenge(code_verifier: str) -> str:
    """Return the base64url SHA-256 challenge a PKCE verifier answers"""
    digest = hashlib.sha256(code_verifier.encode("ascii", errors="replace")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
