"""Signup service"""

import hashlib
import logging
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy import func as sa_func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.concurrency import run_in_threadpool

from app.config.registration import SIGNUP_CONFIRMATION_TOKEN_EXPIRE_SECONDS, SIGNUP_DAILY_EMAIL_LIMIT
from app.config.runtime import APP_URL
from app.database import current_user_id_ctx
from app.models.auth import AuthIdentity, PasswordCredential, SignupEmailSend
from app.models.base import AuthProvider
from app.models.currency import Currency
from app.models.user import User
from app.schemas.auth import SignupRequest
from app.services.auth.password_helpers import hash_password
from app.services.auth.registration import reject_closed_registration
from app.services.auth.signup_email_hash import seal_signup_email
from app.services.auth.tokens import (
    SignupConfirmationClaims,
    create_signup_confirmation_token,
    decode_signup_confirmation_token,
)
from app.services.auth.user_lookup import find_user_id_by_email
from app.services.email import get_email_sender, render_signup_confirmation_email

logger = logging.getLogger(__name__)

_CONFIRM_PATH = "/confirm-email"

# One message for every way a confirmation link can fail, so a response never reveals whether the
# address has an account
_INVALID_LINK_DETAIL = "Invalid or expired confirmation link"

# The cap counts over a rolling day, so records older than that are of no use
_SEND_LOG_RETENTION = timedelta(hours=24)

# Namespaces the advisory lock that serializes sends to one address
_SEND_LOCK_NAMESPACE = b"lumina:signup-email-send:"


async def delete_stale_signup_email_sends(db: AsyncSession) -> None:
    """Delete sign-up email records older than the rolling day the send cap counts over

    Args:
        db: Active database session
    """
    await db.execute(delete(SignupEmailSend).where(SignupEmailSend.created_at < datetime.now(UTC) - _SEND_LOG_RETENTION))


async def request_signup(
    db: AsyncSession,
    data: SignupRequest,
    background_tasks: BackgroundTasks,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """Email a new address its confirmation link, creating no account, and send a registered address nothing

    The caller answers the same way either way, so the endpoint never reveals whether an email is
    registered. A registered address has nothing to act on, so no email goes to it. Both paths do the
    same work before answering, the cap record included, and the rendering and the send wait until
    after the answer, since the time they take would otherwise tell a registered address apart. The
    profile rides inside the link's signed token and no password is chosen yet, so a link sent to
    someone else's address only ever lets its opener choose their own password. At most the
    configured number of emails go out per address per rolling day, so an unauthenticated requester
    cannot drain the operator's mail quota

    Args:
        db: Active database session
        data: Sign-up payload with the email and profile
        background_tasks: Runs the send once the response is out
        session_factory: Opens the session that releases the cap after a failed send

    Raises:
        HTTPException: Registration is closed or the base currency is invalid
    """
    reject_closed_registration()
    await reject_missing_base_currency(db, data.base_currency)

    # Signed on both paths, so the registered path does the same work as the new one
    claims = SignupConfirmationClaims(data.email, data.first_name, data.last_name, data.tz, data.base_currency)
    token = create_signup_confirmation_token(claims)
    registered = await find_user_id_by_email(db, data.email) is not None
    send_id = await _reserve_send(db, data.email)
    if send_id is not None and not registered:
        background_tasks.add_task(_send_confirmation_email, data.email, token, send_id, session_factory)


async def _reserve_send(db: AsyncSession, email: str) -> uuid.UUID | None:
    """Record one more email to the address unless it already reached the daily cap

    Args:
        db: Active database session
        email: Address the email would go to

    Returns:
        The record's id, or None when the cap is reached and nothing is due
    """
    digest = seal_signup_email(email)
    await delete_stale_signup_email_sends(db)

    # Hold this address's allowance until the new record commits, including when none exist yet
    lock_digest = hashlib.blake2b(_SEND_LOCK_NAMESPACE + digest.encode(), digest_size=8).digest()
    await db.execute(select(sa_func.pg_advisory_xact_lock(int.from_bytes(lock_digest, byteorder="big", signed=True))))

    recent = await db.scalar(select(sa_func.count()).select_from(SignupEmailSend).where(SignupEmailSend.email_hash == digest))
    if (recent or 0) >= SIGNUP_DAILY_EMAIL_LIMIT:
        await db.commit()
        return None

    send = SignupEmailSend(email_hash=digest)
    db.add(send)
    await db.commit()
    return send.id


async def _send_confirmation_email(
    recipient: str,
    token: str,
    send_id: uuid.UUID,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """Email the confirmation link after the response, releasing its cap record when the send fails

    A send the server could not make does not count against the address, so a retry still goes out
    """
    try:
        message = render_signup_confirmation_email(
            f"{APP_URL}{_CONFIRM_PATH}?token={token}",
            SIGNUP_CONFIRMATION_TOKEN_EXPIRE_SECONDS // 3600,
        )
        await get_email_sender().send(recipient, message)
    except Exception:
        async with session_factory() as db:
            await db.execute(delete(SignupEmailSend).where(SignupEmailSend.id == send_id))
            await db.commit()
        logger.warning("Sign-up email failed to send", exc_info=True)


async def confirm_signup(db: AsyncSession, confirmation_token: str, password: str) -> User:
    """Create the account a confirmation link was sent for, with the password its holder chose

    Opening the link proves control of the mailbox, and the holder chooses the password, so the
    account's address is confirmed. A link works once, since the address is registered afterwards

    Args:
        db: Active database session
        confirmation_token: Signed token from the emailed link
        password: New password already validated against the policy

    Returns:
        The newly created user

    Raises:
        HTTPException: The link is invalid, expired or already used, registration is closed, or the
            base currency is invalid
    """
    try:
        claims = decode_signup_confirmation_token(confirmation_token)
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_LINK_DETAIL) from None

    # A link sent while registration was open outlives a change of setting
    reject_closed_registration()

    user_id = uuid.uuid4()

    # Stamp the new user as the current identity before any query so their own row
    # passes the self-only users policy when it is inserted and read back
    current_user_id_ctx.set(user_id)

    if await find_user_id_by_email(db, claims.email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_LINK_DETAIL)
    await reject_missing_base_currency(db, claims.base_currency)

    user = User(
        id=user_id,
        email=claims.email,
        first_name=claims.first_name,
        last_name=claims.last_name,
        tz=claims.tz,
        base_currency=claims.base_currency,
    )
    db.add(user)

    # A parallel use of the same link can claim the email first, so the unique index turns that
    # race into the same refusal as a link used twice. The user is flushed first so its row exists
    # before the identity rows that reference it
    try:
        await db.flush()
        db.add(
            AuthIdentity(
                user_id=user.id,
                auth_provider=AuthProvider.PASSWORD,
                email_verified=True,
                email_verified_at=datetime.now(UTC),
            )
        )
        db.add(
            PasswordCredential(
                user_id=user.id,
                password_hash=await run_in_threadpool(hash_password, password),
                password_algo="argon2id",  # noqa: S106
            )
        )
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_LINK_DETAIL) from error

    await db.refresh(user)
    return user


async def reject_registered_email(db: AsyncSession, email: str) -> None:
    """Raise a conflict response when an email is already registered

    Args:
        db: Active database session
        email: Email address requested for signup

    Raises:
        HTTPException: Email is already registered
    """
    # Check for an existing user before creating a new password identity, through the
    # helper since the email lookup runs before any request identity exists
    if await find_user_id_by_email(db, email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")


async def reject_missing_base_currency(db: AsyncSession, base_currency: str) -> None:
    """Raise an invalid-currency response when the base currency is missing

    Args:
        db: Active database session
        base_currency: Requested user base currency

    Raises:
        HTTPException: Base currency does not exist
    """
    currency_query = select(Currency).where(Currency.id == base_currency)

    # Check the requested base currency before assigning it to the new user
    result = await db.execute(currency_query)
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")
