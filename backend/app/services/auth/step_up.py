"""Step-up reauthentication for sensitive two-factor changes"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import PasswordCredential
from app.models.user import User
from app.services.auth.password_helpers import is_password_valid
from app.services.auth.totp import is_user_totp_code_valid


async def verify_step_up(db: AsyncSession, user: User, password: str, code: str) -> None:
    """Authorize a sensitive two-factor change with the password and a current authenticator code

    Step-up accepts only a primary factor, a TOTP code, never a recovery code. A recovery code is a
    break-glass key for login that forces re-enrolment, so allowing it here would let it rotate or
    disable two-factor in session and renew itself indefinitely. The caller commits

    Args:
        db: Active database session
        user: Authenticated user performing the change
        password: Account password
        code: A current TOTP code

    Raises:
        HTTPException: The password is wrong or the authenticator code does not verify
    """
    credential_query = select(PasswordCredential).where(PasswordCredential.user_id == user.id)

    # Scope the lookup to the caller since password credentials carry no row-level policy
    credential = (await db.execute(credential_query)).scalar_one_or_none()
    if credential is None or not is_password_valid(password, credential.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not await is_user_totp_code_valid(db, user.id, code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid two-factor code")
