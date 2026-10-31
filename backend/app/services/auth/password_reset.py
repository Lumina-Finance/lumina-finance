"""Password reset request and token service"""

import asyncio
import hashlib
import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.sql import func as sa_func
from starlette.concurrency import run_in_threadpool

from app.config.password_reset import PASSWORD_RESET_DAILY_EMAIL_LIMIT, PASSWORD_RESET_TOKEN_EXPIRE_SECONDS
from app.config.runtime import APP_URL
from app.database import current_user_id_ctx
from app.models.auth import PasswordCredential, PasswordResetToken
from app.models.user import User
from app.services.auth.account_lockout import reset_failed_attempts
from app.services.auth.mfa_challenge import MFA_PURPOSE_PASSWORD_RESET, issue_mfa_challenge
from app.services.auth.password_credential import create_first_password_credential
from app.services.auth.password_helpers import hash_password
from app.services.auth.reset_send_limit import (
    SendTicket,
    end_send,
    has_send_under_way,
    record_send_failed,
    record_send_succeeded,
    try_start_send,
    wait_for_send_turn,
)
from app.services.auth.sessions import delete_all_user_auth_sessions
from app.services.auth.token_hashing import hash_token
from app.services.auth.totp import is_totp_enabled
from app.services.auth.user_lookup import find_user_id_by_email
from app.services.auth.webauthn import is_passkey_registered
from app.services.email import get_email_sender, render_reset_email

logger = logging.getLogger(__name__)

# 32 random bytes give a 256-bit token, infeasible to guess so a fast hash resists leaks
_TOKEN_BYTES = 32
_RESET_PATH = "/reset-password"

# Dead token rows double as the send log for the daily email limit, so they are kept for the
# full rolling day the limit counts over
_SEND_LOG_RETENTION = timedelta(hours=24)

# How long a stored link may wait for its email before the next request treats it as never sent
_UNSENT_LINK_GRACE = timedelta(seconds=30)

# Keep reset issuance separate from other advisory-lock protocols
_ISSUANCE_LOCK_NAMESPACE = b"lumina:password-reset-issuance:"

# Owner of the send read for an email with no account. No counted row has it, so the read finds nothing
_NO_USER_ID = uuid.UUID(int=0)

# One message for every token failure so responses do not reveal which check rejected it
_INVALID_TOKEN_DETAIL = "Invalid or expired reset token"  # noqa: S105


@dataclass(frozen=True)
class ResetSecondFactorRequired:
    """Challenge issued because the account has an active second factor"""

    mfa_token: str
    totp_enabled: bool
    passkey_available: bool


async def delete_stale_password_reset_tokens(db: AsyncSession) -> None:
    """Delete reset tokens older than the rolling day the email limit counts over

    Expired and redeemed rows stay until then because they are the record of recent sends,
    validity never depends on a row's presence alone

    Args:
        db: Active database session
    """
    stale_delete_query = delete(PasswordResetToken).where(PasswordResetToken.created_at < datetime.now(UTC) - _SEND_LOG_RETENTION)

    # The scheduled cleanup prunes these too. A reset request still prunes first, since the email
    # limit counts the rows left
    await db.execute(stale_delete_query)


@dataclass(frozen=True)
class PendingResetEmail:
    """A reset link stored and waiting to be emailed"""

    recipient: str
    token_id: uuid.UUID
    raw_token: str
    expires_at: datetime
    ticket: SendTicket


async def request_password_reset(
    db: AsyncSession,
    email: str,
    background_tasks: BackgroundTasks,
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """Issue a single-use reset token for the email and send its link once the response is out

    The caller always reports success so the endpoint never reveals whether an email is
    registered or was throttled, and the rendering and the send wait until after the answer, since
    the time they take would otherwise tell a registered address apart

    Args:
        db: Active database session
        email: Email address requesting the reset
        background_tasks: Runs the send once the response is out
        session_factory: Opens the session the send uses after the response
    """
    pending = await _issue_password_reset(db, email, session_factory)
    if pending is not None:
        background_tasks.add_task(send_password_reset_email, pending, session_factory)


async def _issue_password_reset(db: AsyncSession, email: str, session_factory: async_sessionmaker[AsyncSession]) -> PendingResetEmail | None:
    """Store a reset token for the email and return the pending email carrying its link

    No email is due while the last link still works, and at most the configured number go out
    per account per rolling day, so an unauthenticated requester cannot drain the operator's
    mail quota. Sends that fail are not counted by that limit, so a growing wait after each failure
    and a cap on the sends running at once keep a failing mail server from piling them up

    Every email runs the same statements, stores one row and makes the same commit, whether it has
    no account, a live link, a spent allowance or a reset due, so the time taken does not tell an
    account apart. The token is made on every path, and only a reset that is due stores a live one
    that names its user. Writing the user's foreign key is the one step left that only a due reset does

    Args:
        db: Active database session
        email: Email address requesting the reset
        session_factory: Opens the session that drops a link saved by a request that was cut off

    Returns:
        The email to send, or None when no account matches or none is due
    """
    user_id = await find_user_id_by_email(db, email)
    await delete_stale_password_reset_tokens(db)

    # Hold this user's allowance until the new token commits, including when no prior rows exist.
    # An email with no account locks on itself, so unknown emails never queue behind one another.
    # Its capitals are folded, since the lookup above ignores them
    lock_subject = user_id.bytes if user_id is not None else email.lower().encode()
    lock_digest = hashlib.blake2b(_ISSUANCE_LOCK_NAMESPACE + lock_subject, digest_size=8).digest()
    lock_key = int.from_bytes(lock_digest, byteorder="big", signed=True)
    await db.execute(select(sa_func.pg_advisory_xact_lock(lock_key)))

    # A link whose send never started once the grace has passed belongs to a request that was cut off, such
    # as by a restart, so it is deleted and neither blocks this request nor counts toward the limit. A send
    # still waiting its turn in this process will email its link, so its row stays. Every request runs
    # the same statement, and the cutoff alone changes: while a send is under way it reaches back past the
    # pruned rows, so nothing matches, and one for an unknown email deletes nothing
    now = datetime.now(UTC)
    owner = user_id or _NO_USER_ID
    unsent_before = now - (_SEND_LOG_RETENTION if has_send_under_way(owner) else _UNSENT_LINK_GRACE)
    await db.execute(
        delete(PasswordResetToken).where(
            PasswordResetToken.user_id == owner,
            PasswordResetToken.emailed_at.is_(None),
            PasswordResetToken.created_at < unsent_before,
        )
    )

    # Only the rows of real sends name the user, and after pruning each was created within the rolling day
    sends_query = select(PasswordResetToken).where(PasswordResetToken.user_id == owner)
    sends = (await db.execute(sends_query)).scalars().all()
    has_live_link = any(row.used_at is None and row.expires_at > now for row in sends)
    raw_token = secrets.token_urlsafe(_TOKEN_BYTES)
    token_id = uuid.uuid4()

    # A failed send leaves no token to count, so the back-off after failures and the cap on sends are
    # what bound the sends, and a refusal stores a row that names no user
    ticket = None
    if user_id is not None and not has_live_link and len(sends) < PASSWORD_RESET_DAILY_EMAIL_LIMIT:
        ticket = try_start_send(user_id)
    is_due = ticket is not None
    expires_at = now + timedelta(seconds=PASSWORD_RESET_TOKEN_EXPIRE_SECONDS) if is_due else now

    # Anything that stops this request before the send is handed on, a cancellation included, frees
    # what was claimed, since no send_password_reset_email will
    try:
        # One row for every email, so each request writes and commits the same amount. When no reset is
        # due the row is already used and expired, so nobody can redeem it, and it names no user, so
        # it is left out of the limit and nothing keeps a record that this account was asked about
        await db.execute(
            insert(PasswordResetToken).values(
                id=token_id,
                user_id=user_id if is_due else None,
                token_hash=hash_token(raw_token),
                expires_at=expires_at,
                used_at=None if is_due else now,
            )
        )
        await db.commit()
    except BaseException:
        if ticket is not None:
            end_send(ticket)
            # The commit may have reached the database before the cut-off, and no send will follow to
            # drop the link, so it is dropped here. A row that was never stored deletes nothing
            await asyncio.shield(_drop_token_by_id(token_id, session_factory))
        raise
    if ticket is None:
        return None
    return PendingResetEmail(recipient=email, token_id=token_id, raw_token=raw_token, expires_at=expires_at, ticket=ticket)


async def send_password_reset_email(pending: PendingResetEmail, session_factory: async_sessionmaker[AsyncSession]) -> None:
    """Email a stored reset link once it has its turn, dropping its token when the send fails

    Runs after the response, so the request's own session has closed and the drop opens one
    from the factory. The email is rendered here, since the time it takes would otherwise tell a
    registered address apart, and a render that fails drops the token like a send that fails. A
    link that expired while the send waited its turn, and the link of a send cancelled before it
    finished, are dropped too, and neither is a failure of the mail server

    Args:
        pending: The email request_password_reset returned
        session_factory: Opens the session that drops the token of a link that was not sent
    """
    is_expired = False
    try:
        # The raw token only ever leaves the server inside the emailed link
        reset_link = f"{APP_URL}{_RESET_PATH}?token={pending.raw_token}"
        message = render_reset_email(reset_link, PASSWORD_RESET_TOKEN_EXPIRE_SECONDS // 60)
        async with wait_for_send_turn():
            is_expired = pending.expires_at <= datetime.now(UTC)
            if not is_expired:
                # Marked as the send starts, so a send slower than the grace still blocks other requests
                await _mark_reset_emailed(pending, session_factory)
                await get_email_sender().send(pending.recipient, message)
    except Exception:
        # Recorded before the token is dropped, so a drop that fails cannot lose the failure
        record_send_failed(pending.ticket.user_id)

        # A failed send must drop the token it just stored, otherwise the one-live-link throttle would
        # suppress every retry until the token expires
        await _drop_token_by_id(pending.token_id, session_factory)
        logger.warning("Password reset email failed to send", exc_info=True)
    except asyncio.CancelledError:
        # A cancelled send counts as unsent, so its link must not stay live and block a new request
        await _drop_token_by_id(pending.token_id, session_factory)
        raise
    else:
        if is_expired:
            await _drop_token_by_id(pending.token_id, session_factory)
        else:
            record_send_succeeded(pending.ticket.user_id)
    finally:
        end_send(pending.ticket)


async def _mark_reset_emailed(pending: PendingResetEmail, session_factory: async_sessionmaker[AsyncSession]) -> None:
    """Record that the link's send has started, so it keeps blocking and counting like any sent link"""
    async with session_factory() as db:
        await db.execute(update(PasswordResetToken).where(PasswordResetToken.id == pending.token_id).values(emailed_at=sa_func.now()))
        await db.commit()


async def _drop_token_by_id(token_id: uuid.UUID, session_factory: async_sessionmaker[AsyncSession]) -> None:
    """Delete the token of a link that was not sent in a session of its own, so it never counts toward the daily limit"""
    async with session_factory() as db:
        await db.execute(delete(PasswordResetToken).where(PasswordResetToken.id == token_id))
        await db.commit()


async def _find_active_reset_token(db: AsyncSession, token: str) -> PasswordResetToken | None:
    """Return the unused, unexpired reset token row matching the raw token, if any"""
    reset_token_query = select(PasswordResetToken).where(
        PasswordResetToken.token_hash == hash_token(token),
        PasswordResetToken.used_at.is_(None),
        PasswordResetToken.expires_at > sa_func.now(),
    )
    return (await db.execute(reset_token_query)).scalar_one_or_none()


async def ensure_reset_token_active(db: AsyncSession, token: str) -> None:
    """Check a reset token is still redeemable without consuming anything

    The verify step burns its single-use challenge before touching the token, so this pre-check
    keeps a stale token from wasting a live challenge

    Args:
        db: Active database session
        token: Raw reset token from the emailed link

    Raises:
        HTTPException: The token is unknown, already used, or expired
    """
    if await _find_active_reset_token(db, token) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_TOKEN_DETAIL)


async def begin_password_reset(db: AsyncSession, token: str, new_password: str) -> ResetSecondFactorRequired | None:
    """Reset the password from a valid token, or issue a challenge when a second factor is active

    Possession of the emailed token proves the email step, so accounts without a second factor
    reset immediately. Any confirmed factor, or a pending re-enrolment, holds the reset behind the
    same second-factor step as login, scoped to the reset flow

    Args:
        db: Active database session
        token: Raw reset token from the emailed link
        new_password: Replacement password already validated against the policy

    Returns:
        The issued challenge when a second factor must verify first, otherwise None

    Raises:
        HTTPException: The token is unknown, already used, or expired
    """
    reset_token = await _find_active_reset_token(db, token)
    if reset_token is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_TOKEN_DETAIL)

    # The token lookup ran before any identity existed, so close that transaction and adopt the
    # verified identity, allowing later user reads to stamp it for the self-only users policy
    current_user_id_ctx.set(reset_token.user_id)
    await db.commit()

    totp_enabled = await is_totp_enabled(db, reset_token.user_id)
    passkey_available = await is_passkey_registered(db, reset_token.user_id)
    user = await db.get(User, reset_token.user_id)
    if totp_enabled or passkey_available or (user is not None and user.second_factor_reenrollment_required):
        mfa_token = await issue_mfa_challenge(db, reset_token.user_id, MFA_PURPOSE_PASSWORD_RESET)
        return ResetSecondFactorRequired(
            mfa_token=mfa_token,
            totp_enabled=totp_enabled,
            passkey_available=passkey_available,
        )

    await _apply_password_reset(db, reset_token, new_password)
    return None


async def complete_password_reset(db: AsyncSession, user_id: uuid.UUID, token: str, new_password: str) -> None:
    """Reset the password after the second factor verified for the same user

    Args:
        db: Active database session
        user_id: User the verified challenge belongs to
        token: Raw reset token from the emailed link
        new_password: Replacement password already validated against the policy

    Raises:
        HTTPException: The token is invalid or belongs to a different user than the challenge
    """
    reset_token = await _find_active_reset_token(db, token)

    # The token and the verified challenge must name the same account, so a challenge for one
    # account can never redeem a reset link issued to another
    if reset_token is None or reset_token.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_TOKEN_DETAIL)

    await _apply_password_reset(db, reset_token, new_password)


async def _apply_password_reset(db: AsyncSession, reset_token: PasswordResetToken, new_password: str) -> None:
    """Redeem the reset token, set the new password, and revoke every session

    Args:
        db: Active database session
        reset_token: Active reset token row being redeemed
        new_password: Replacement password already validated against the policy

    Raises:
        HTTPException: The token was already redeemed
    """
    # Claim the token in one conditional update so concurrent redemptions cannot both succeed
    claim_query = (
        update(PasswordResetToken)
        .where(PasswordResetToken.id == reset_token.id, PasswordResetToken.used_at.is_(None))
        .values(used_at=datetime.now(UTC))
    )
    claimed = await db.execute(claim_query)
    if claimed.rowcount != 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_INVALID_TOKEN_DETAIL)

    credential_query = select(PasswordCredential).where(PasswordCredential.user_id == reset_token.user_id)
    credential = (await db.execute(credential_query)).scalar_one_or_none()

    # An account created through a provider sign-in has no password yet, and possession of
    # the account email is the same proof a reset trusts, so redeeming a link sets its first
    # password and records password as an auth provider
    if credential is None:
        credential = await create_first_password_credential(db, reset_token.user_id, new_password)
    else:
        credential.password_hash = await run_in_threadpool(hash_password, new_password)
        credential.password_algo = "argon2id"  # noqa: S105

    # A verified reset clears any login lockout the user was trying to recover from
    email = await db.scalar(select(User.email).where(User.id == reset_token.user_id))
    await reset_failed_attempts(db, email)

    # A reset means the old password may be compromised, so end every session
    await delete_all_user_auth_sessions(db, reset_token.user_id)
    await db.commit()
