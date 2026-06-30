"""Two-factor enrolment and management flows spanning TOTP and recovery codes"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.auth.recovery_codes import (
    activate_pending_recovery_codes,
    consume_recovery_code,
    delete_recovery_codes,
    generate_recovery_codes,
    has_active_recovery_codes,
    has_pending_recovery_codes,
)
from app.services.auth.sessions import delete_all_user_auth_sessions
from app.services.auth.step_up import verify_step_up
from app.services.auth.totp import (
    disable_totp,
    is_pending_totp_code_valid,
    is_totp_enabled,
    is_user_totp_code_valid,
    mark_totp_confirmed,
)
from app.services.auth.webauthn import revoke_all_passkeys

# Shared message so disabling and regenerating reject identically when 2FA is off
_NOT_ENABLED_DETAIL = "Two-factor authentication is not enabled"


async def verify_login_second_factor(db: AsyncSession, user_id: uuid.UUID, code: str) -> None:
    """Verify the second factor presented at login

    A valid TOTP code passes login unchanged. A recovery code instead is treated as lost
    authenticators: it is consumed, every factor is wiped, all existing sessions are revoked, and
    re-enrolment is required, so the recovery path grants only a fresh restricted session and nothing
    it can ride. The remaining codes stay valid, so an abandoned re-enrol is not a lockout. The caller
    commits, since the wipe and the flag belong to its transaction

    Args:
        db: Active database session
        user_id: User completing the second factor
        code: Submitted TOTP code or recovery code

    Raises:
        HTTPException: Neither a TOTP code nor a recovery code verifies
    """
    if await is_user_totp_code_valid(db, user_id, code):
        return

    if await consume_recovery_code(db, user_id, code):
        await disable_totp(db, user_id)
        await revoke_all_passkeys(db, user_id)
        await delete_all_user_auth_sessions(db, user_id)
        user = await db.get(User, user_id)
        user.second_factor_reenrollment_required = True
        return

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid code")


async def _enable_totp(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Mark the pending TOTP credential confirmed and lift any re-enrolment restriction

    The caller commits, so enabling and unlocking happen together with its other changes

    Raises:
        HTTPException: There is no pending setup to finish
    """
    if not await mark_totp_confirmed(db, user_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No pending two-factor setup to finish")

    user = await db.get(User, user_id)
    user.second_factor_reenrollment_required = False


async def confirm_totp_enrollment(db: AsyncSession, user_id: uuid.UUID, code: str) -> list[str]:
    """Verify the first code, reusing the account's recovery codes or issuing a fresh batch

    Recovery codes are account-level and issued once, so a routine second factor added when a batch
    already exists reuses it and turns the authenticator on now with nothing to acknowledge. A forced
    re-enrol is excluded so it mints a fresh batch, while the first second factor stages a batch and
    leaves two-factor off until the user acknowledges it through complete_totp_enrollment, which keeps
    the account from being half protected

    Args:
        db: Active database session
        user_id: User confirming enrolment
        code: Code from the authenticator app

    Returns:
        The plaintext recovery codes to show once, or an empty list when an existing batch is reused

    Raises:
        HTTPException: No pending setup exists or the code is invalid
    """
    if not await is_pending_totp_code_valid(db, user_id, code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired code")

    user = await db.get(User, user_id)

    # Reuse the account's batch only for a routine second factor, never during a forced re-enrol, which
    # must mint a fresh batch
    if await has_active_recovery_codes(db, user_id) and not user.second_factor_reenrollment_required:
        await _enable_totp(db, user_id)
        await db.commit()
        return []

    # Stage the first batch so any current set of codes stays usable until the user acknowledges these
    codes = await generate_recovery_codes(db, user_id, pending=True)
    await db.commit()
    return codes


async def complete_totp_enrollment(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Turn on two-factor once the user has acknowledged their staged recovery code batch

    The staged codes are promoted and any re-enrolment restriction lifted in the same commit as
    enabling, never leaving it half on. When this finishes a forced re-enrol it also signs out every
    session, so the recovery path ends in a fresh login rather than promoting its restricted session. A
    staged batch only exists after a confirmed code, so requiring it keeps two-factor from being enabled
    around an unverified secret

    Args:
        db: Active database session
        user_id: User finishing enrolment

    Raises:
        HTTPException: Enrolment was not confirmed first, or there is no pending setup
    """
    if not await has_pending_recovery_codes(db, user_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Confirm an authenticator code first")

    user = await db.get(User, user_id)
    was_forced_reenrollment = user.second_factor_reenrollment_required

    await _enable_totp(db, user_id)
    await activate_pending_recovery_codes(db, user_id)

    # A forced re-enrol grants only a re-enrol session, so completing it signs out everywhere and sends
    # the user back to a fresh login with the new factor
    if was_forced_reenrollment:
        await delete_all_user_auth_sessions(db, user_id)

    await db.commit()


async def disable_two_factor(db: AsyncSession, user: User, password: str, code: str) -> None:
    """Disable TOTP and clear the recovery codes after step-up reauthentication

    Args:
        db: Active database session
        user: Authenticated user disabling two-factor
        password: Account password
        code: A current TOTP code

    Raises:
        HTTPException: Two-factor is not enabled, or the step-up check fails
    """
    if not await is_totp_enabled(db, user.id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_NOT_ENABLED_DETAIL)

    await verify_step_up(db, user, password, code)
    await disable_totp(db, user.id)
    await delete_recovery_codes(db, user.id)
    await db.commit()


async def regenerate_recovery_codes(db: AsyncSession, user: User, password: str, code: str) -> list[str]:
    """Stage a fresh recovery code batch after step-up reauthentication

    The batch is staged, so the current codes keep working until the user acknowledges the new ones
    through confirm_recovery_codes. Abandoning the screen therefore never strands the account

    Args:
        db: Active database session
        user: Authenticated user regenerating codes
        password: Account password
        code: A current TOTP code

    Returns:
        The fresh plaintext recovery codes to show once

    Raises:
        HTTPException: Two-factor is not enabled, or the step-up check fails
    """
    if not await is_totp_enabled(db, user.id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_NOT_ENABLED_DETAIL)

    await verify_step_up(db, user, password, code)
    codes = await generate_recovery_codes(db, user.id, pending=True)
    await db.commit()
    return codes


async def confirm_recovery_codes(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Activate a staged recovery code batch once the user acknowledges it

    Promotes the pending batch and discards the superseded active codes. A staged batch only exists
    after a step-up regeneration, so requiring it keeps this from wiping the active codes

    Args:
        db: Active database session
        user_id: User confirming the new codes

    Raises:
        HTTPException: There is no staged batch to confirm
    """
    if not await has_pending_recovery_codes(db, user_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No pending recovery codes to confirm")

    await activate_pending_recovery_codes(db, user_id)
    await db.commit()
