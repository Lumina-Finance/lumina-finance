"""Set-first-password service for accounts that authenticate only through a provider"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.auth.account_lockout import get_password_credential
from app.services.auth.password_credential import create_first_password_credential
from app.services.auth.sessions import delete_other_user_auth_sessions


async def set_first_password(
    db: AsyncSession, user: User, current_session_id: uuid.UUID, new_password: str
) -> None:
    """Set the first password for an account that had none after a provider reauth authorized it

    Adding a password is treated as a password change, so every other session is signed out while
    the one that made the request stays. The caller has already verified the reauth authorization

    Args:
        db: Active database session
        user: Authenticated user setting their first password
        current_session_id: Session that made the request and stays signed in
        new_password: Password already validated against the policy

    Raises:
        HTTPException: The account already has a password
    """
    # The reauth authorization is not scoped to the absence of a password, so re-check here in
    # case one was set meanwhile, keeping this strictly a first-password path
    if await get_password_credential(db, user.id) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Account already has a password")

    # Adding a standalone credential is a password change, so drop every other session in case one is
    # not the owner's. The delete runs before the credential is added so the credential insert is
    # deferred to the commit, where a parallel set-password is caught as a conflict rather than
    # autoflushing early
    await delete_other_user_auth_sessions(db, user.id, current_session_id)

    create_first_password_credential(db, user.id, new_password)

    # A parallel set-password can insert the credential first, so the primary key turns that race into
    # the same conflict the pre-check raises rather than an unhandled error
    try:
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Account already has a password"
        ) from error
