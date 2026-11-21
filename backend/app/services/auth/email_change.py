"""Email change service: a signed-in user asks for a new address, and the link emailed to it confirms the change"""

import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func as sa_func

from app.config.email_change import EMAIL_CHANGE_TOKEN_EXPIRE_SECONDS
from app.config.runtime import APP_URL
from app.database import current_user_id_ctx
from app.email_change_hook import EmailChange, notify_email_change
from app.models.auth import EmailChangeRequest, PasswordResetToken
from app.models.user import User
from app.services.auth.account_lockout import reset_failed_attempts
from app.services.auth.password_reset import hold_reset_issuance
from app.services.auth.sessions import delete_all_user_auth_sessions
from app.services.auth.signup import INVALID_LINK_DETAIL
from app.services.auth.token_hashing import hash_token
from app.services.auth.user_lookup import find_user_id_by_email
from app.services.email import get_email_sender, render_email_change_email, render_email_change_notice_email

logger = logging.getLogger(__name__)

# 32 random bytes give a 256-bit token, infeasible to guess so a fast hash resists leaks
_TOKEN_BYTES = 32
_CONFIRM_PATH = "/confirm-new-email"

# Shown under the Email field as the server sends it
_UNCHANGED_EMAIL_DETAIL = "This is already your email address. Please enter a different one"


def reject_unchanged_email(user: User, new_email: str) -> None:
    """Refuse the address the account already has, spelled exactly as it is stored

    Runs before the step-up, so a request that changes nothing spends neither a proof nor a password
    attempt. Only the same spelling is refused, after validation has lower-cased the domain. The same address
    with other capitals before the @ is a change

    Args:
        user: Account asking for the change
        new_email: Address the account asks for

    Raises:
        HTTPException: The address is the account's current one
    """
    if new_email == user.email:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_UNCHANGED_EMAIL_DETAIL)


async def request_email_change(db: AsyncSession, user: User, new_email: str, background_tasks: BackgroundTasks) -> None:
    """Store the account's request for a new address and email its confirmation link once the response is out

    The account has one pending request, so a new one replaces the old one and its link stops working.
    Every request runs the same statements and stores a row, whether or not another account uses the
    address, and only the send differs. It runs after the response. An address another account uses
    is sent nothing, so the endpoint never reveals which addresses are registered. The same address in
    other capitals as the account's own is free, since it is the account that holds it

    Args:
        db: Active database session
        user: Account asking for the change
        new_email: Address the account asks for
        background_tasks: Runs the send once the response is out
    """
    user_id = user.id
    raw_token = secrets.token_urlsafe(_TOKEN_BYTES)
    holder_id = await find_user_id_by_email(db, new_email)

    stored = insert(EmailChangeRequest).values(
        id=uuid.uuid4(),
        user_id=user_id,
        new_email=new_email,
        token_hash=hash_token(raw_token),
        expires_at=datetime.now(UTC) + timedelta(seconds=EMAIL_CHANGE_TOKEN_EXPIRE_SECONDS),
    )
    await db.execute(
        stored.on_conflict_do_update(
            index_elements=[EmailChangeRequest.user_id],
            set_={
                "new_email": stored.excluded.new_email,
                "token_hash": stored.excluded.token_hash,
                "expires_at": stored.excluded.expires_at,
                "created_at": sa_func.now(),
            },
        )
    )
    await db.commit()

    if holder_id is None or holder_id == user_id:
        background_tasks.add_task(_send_confirmation_email, new_email, raw_token)


async def _send_confirmation_email(recipient: str, raw_token: str) -> None:
    """Email the confirmation link to the new address, keeping the stored request when the send fails"""
    try:
        # The raw token only ever leaves the server inside the emailed link
        confirm_link = f"{APP_URL}{_CONFIRM_PATH}?token={raw_token}"
        message = render_email_change_email(confirm_link, EMAIL_CHANGE_TOKEN_EXPIRE_SECONDS // 60)
        await get_email_sender().send(recipient, message)
    except Exception as error:
        # Best-effort after the response. Only the class is logged, since the mail library's error text can
        # quote the address. The request stays stored, because a taken address is sent nothing and keeps
        # its row, so dropping the row here would make a free address's stored state differ from a taken one's
        logger.warning("Email change confirmation failed to send: %s", type(error).__name__)


async def confirm_email_change(db: AsyncSession, token: str, background_tasks: BackgroundTasks) -> str:
    """Change the account's address to the one its emailed link was sent to, and end every session

    The link works once, and opening it needs no session, since the person opening it may be signed out.
    Confirming proves control of the new mailbox. The change then ends every session of the account,
    marks its unused password reset links used and clears the sign-in lockout counts for both addresses,
    so nothing started under the old address outlives it. The old address is told afterwards

    Args:
        db: Active database session
        token: Raw token from the emailed link
        background_tasks: Runs the notice to the old address once the response is out

    Returns:
        The address the account has now

    Raises:
        HTTPException: The link is unknown, expired, replaced or already used, or another account has
            taken the address since the request
    """
    request_query = select(EmailChangeRequest.id, EmailChangeRequest.user_id).where(
        EmailChangeRequest.token_hash == hash_token(token),
        EmailChangeRequest.expires_at > sa_func.now(),
    )
    live = (await db.execute(request_query)).first()
    if live is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_LINK_DETAIL)

    # The lookup ran before any identity existed, so close that transaction and adopt the account's, since
    # the transaction that follows is stamped with it for the self-only users policy
    current_user_id_ctx.set(live.user_id)
    await db.commit()

    # The claim is a single conditional delete, so of two simultaneous confirmations only one gets the row
    claim_query = (
        delete(EmailChangeRequest)
        .where(
            EmailChangeRequest.id == live.id,
            EmailChangeRequest.token_hash == hash_token(token),
            EmailChangeRequest.expires_at > sa_func.now(),
        )
        .returning(EmailChangeRequest.user_id, EmailChangeRequest.new_email)
    )
    claimed = (await db.execute(claim_query)).first()
    if claimed is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_LINK_DETAIL)

    user_id, new_email = claimed
    old_email = await db.scalar(select(User.email).where(User.id == user_id))

    # Held to the commit, so a reset request for the old address either commits its link before this
    # change marks the account's links used below, or waits and then finds no account under that address.
    # Taken before any write to the account's row, so this wait never holds a row lock a reset request
    # could queue behind
    await hold_reset_issuance(db, old_email)

    # Another account can take the address between the request and now, and the unique index turns that
    # race into the same refusal as any other failed link
    try:
        await db.execute(update(User).where(User.id == user_id).values(email=new_email))
    except IntegrityError as error:
        await db.rollback()
        await _drop_request(db, token)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_LINK_DETAIL) from error

    await reset_failed_attempts(db, old_email)
    await reset_failed_attempts(db, new_email)

    # A reset link is tied to the account rather than the address, so one sent to the old mailbox would
    # still sign someone in after the change. The lock above means every link issued for the old address
    # has committed by now, so this reaches them all
    await db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == user_id, PasswordResetToken.used_at.is_(None))
        .values(used_at=datetime.now(UTC))
    )
    await delete_all_user_auth_sessions(db, user_id)
    await db.commit()

    background_tasks.add_task(_send_change_notice, old_email, new_email)
    notify_email_change(EmailChange(user_id=user_id, old_email=old_email, new_email=new_email))
    return new_email


async def _drop_request(db: AsyncSession, token: str) -> None:
    """Delete the request the token names in a unit of work of its own, so a refused link cannot be tried again"""
    await db.execute(delete(EmailChangeRequest).where(EmailChangeRequest.token_hash == hash_token(token)))
    await db.commit()


async def _send_change_notice(recipient: str, new_email: str) -> None:
    """Tell the old address the account's email has changed, with no link to act on"""
    try:
        await get_email_sender().send(recipient, render_email_change_notice_email(new_email))
    except Exception as error:
        # Best-effort after the response, and the change is already saved. Only the class is logged, since
        # the mail library's error text can quote an address
        logger.warning("Email change notice failed to send: %s", type(error).__name__)


async def delete_expired_email_change_requests(db: AsyncSession) -> None:
    """Delete email change requests whose link has expired, so a typed address is stored only until the next cleanup after its expiry

    Args:
        db: Active database session
    """
    await db.execute(delete(EmailChangeRequest).where(EmailChangeRequest.expires_at < datetime.now(UTC)))
