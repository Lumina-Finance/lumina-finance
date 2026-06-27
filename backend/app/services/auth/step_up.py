"""Step-up reauthentication for sensitive two-factor changes"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import PasswordCredential
from app.models.user import User
from app.services.auth.password_helpers import is_password_valid
from app.services.auth.recovery_codes import consume_recovery_code
from app.services.auth.totp import is_user_totp_code_valid


async def verify_step_up(db: AsyncSession, user: User, password: str, code: str) -> None:
    """Authorize a sensitive two-factor change with the password and a current second factor

    The second factor is a TOTP code or a recovery code, and a redeemed recovery code is
    consumed. The caller commits, since that consumption belongs to its transaction

    Args:
        db: Active database session
        user: Authenticated user performing the change
        password: Account password
        code: A current TOTP code or a recovery code

    Raises:
        HTTPException: The password is wrong or the second factor does not verify
    """
    credential_query = select(PasswordCredential).where(PasswordCredential.user_id == user.id)

    # Scope the lookup to the caller since password credentials carry no row-level policy
    credential = (await db.execute(credential_query)).scalar_one_or_none()
    if credential is None or not is_password_valid(password, credential.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # Try the TOTP code first since it has no side effect, then fall back to consuming a recovery code
    if await is_user_totp_code_valid(db, user.id, code):
        return
    if await consume_recovery_code(db, user.id, code):
        return

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid two-factor code")
