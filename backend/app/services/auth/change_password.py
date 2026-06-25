"""Change-password service"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import PasswordCredential
from app.models.user import User
from app.schemas.auth import ChangePasswordRequest
from app.services.auth.password_helpers import hash_password, is_password_valid


async def change_password(db: AsyncSession, user: User, data: ChangePasswordRequest) -> None:
    """Replace an authenticated user's password after verifying the current one

    Args:
        db: Active database session
        user: Authenticated user changing their password
        data: Current and new password payload

    Raises:
        HTTPException: The current password is missing or incorrect
    """
    credential_query = select(PasswordCredential).where(PasswordCredential.user_id == user.id)

    # Scope the lookup to the caller since password credentials carry no row-level policy
    result = await db.execute(credential_query)
    credential = result.scalar_one_or_none()
    if not credential or not is_password_valid(data.current_password, credential.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # A verified change clears any login lockout since the caller has proven the current password
    credential.password_hash = hash_password(data.new_password)
    credential.password_algo = "argon2id"  # noqa: S105
    credential.failed_attempt_count = 0
    credential.locked_until = None
    await db.commit()
