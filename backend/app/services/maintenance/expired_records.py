"""One cleanup for the records that expire or are left behind, except those bank sync prunes as it writes

Each kind is one entry in EXPIRED_RECORD_KINDS. The app prunes them all on a schedule while it serves,
unless code outside the app turns that timer off, and prune_expired_records runs one pass without it.
Each pass also reminds the owners of profiles waiting to be deleted, and deletes every profile whose
deletion is due, such as one a restart cut short or one whose waiting time has passed

Bank sync prunes its request records where it writes them: recording a request to a provider deletes
that connection's earlier records once the request budget no longer counts them
"""

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager, suppress
from datetime import timedelta
from typing import NamedTuple

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.database import async_session
from app.services.auth.account_lockout import delete_idle_login_lockouts
from app.services.auth.email_change import delete_expired_email_change_requests
from app.services.auth.mfa_challenge import delete_expired_mfa_challenges
from app.services.auth.oidc_login import delete_expired_oidc_authorization_requests
from app.services.auth.password_reset import delete_stale_password_reset_tokens
from app.services.auth.sessions import delete_expired_auth_sessions, delete_expired_auth_tokens
from app.services.auth.signup import delete_stale_signup_email_sends
from app.services.auth.two_factor import prune_stale_factor_staging
from app.services.auth.webauthn import delete_expired_webauthn_challenges
from app.services.bank_sync.authorization import delete_expired_bank_authorizations
from app.services.bank_sync.jobs import delete_finished_bank_sync_jobs
from app.services.importers.shared.run_staging import delete_expired_import_runs
from app.services.profile_deletion import delete_marked_profiles, send_due_reminders

logger = logging.getLogger(__name__)

# How often the server prunes. Twice a day is enough for a personal server, since every kind is already
# refused by its own expiry check once it expires and a pass only clears what is left
EXPIRED_RECORD_PRUNE_INTERVAL = timedelta(hours=12)


class ExpiredRecordKind(NamedTuple):
    """A kind of record that expires, with the delete that removes every expired row of it"""

    name: str

    # Deletes expired rows across every user without committing, so each kind commits on its own
    delete_expired: Callable[[AsyncSession], Awaitable[object]]


EXPIRED_RECORD_KINDS: tuple[ExpiredRecordKind, ...] = (
    ExpiredRecordKind("auth sessions", delete_expired_auth_sessions),
    ExpiredRecordKind("auth tokens", delete_expired_auth_tokens),
    ExpiredRecordKind("passkey challenges", delete_expired_webauthn_challenges),
    ExpiredRecordKind("MFA challenges", delete_expired_mfa_challenges),
    ExpiredRecordKind("OIDC authorization requests", delete_expired_oidc_authorization_requests),
    ExpiredRecordKind("password reset tokens", delete_stale_password_reset_tokens),
    ExpiredRecordKind("email change requests", delete_expired_email_change_requests),
    ExpiredRecordKind("idle sign-in lockouts", delete_idle_login_lockouts),
    ExpiredRecordKind("sign-up email records", delete_stale_signup_email_sends),
    ExpiredRecordKind("two-factor staging", prune_stale_factor_staging),
    ExpiredRecordKind("import runs", delete_expired_import_runs),
    ExpiredRecordKind("finished bank sync jobs", delete_finished_bank_sync_jobs),
    ExpiredRecordKind("bank sign-ins", delete_expired_bank_authorizations),
)


async def prune_expired_records(session_factory: async_sessionmaker[AsyncSession] = async_session) -> None:
    """Delete every kind's expired rows, each kind in its own transaction

    A kind that fails is rolled back and logged, and the rest still run, so one broken cleanup never
    holds back the others

    Args:
        session_factory: Opens the sessions the deletes run in, with no request identity
    """
    for kind in EXPIRED_RECORD_KINDS:
        try:
            async with session_factory() as session:
                await kind.delete_expired(session)
                await session.commit()
        except Exception:
            # Best-effort: a failed kind waits for the next run rather than stopping this one
            logger.warning("Expired %s could not be pruned", kind.name, exc_info=True)

    # The reminders of waiting profile deletions go first. Each profile's reminder is claimed in a
    # transaction of its own, so the pass opens its sessions from the factory
    try:
        await send_due_reminders(session_factory)
    except Exception:
        # Best-effort: a reminder not sent yet waits for the next run, and the deletions below still run
        logger.warning("Profile deletion reminders could not be sent", exc_info=True)

    # Every profile whose deletion is due, including one a restart cut short. Each runs in many
    # transactions of its own, so it opens its sessions from the factory rather than taking one, and
    # logs any profile it can't finish yet
    try:
        await delete_marked_profiles(session_factory)
    except Exception:
        # Best-effort: the profiles stay marked, so nothing can sign in to them, and wait for the next run
        logger.warning("Profiles marked for deletion could not be listed", exc_info=True)


async def _prune_expired_records_on_schedule() -> None:
    """Prune at once and then every interval, until cancelled"""
    while True:
        await prune_expired_records()
        await asyncio.sleep(EXPIRED_RECORD_PRUNE_INTERVAL.total_seconds())


# False while code outside the app has turned the timer off. It is set in code and never read from the
# environment, so no setting can leave expired records unpruned
_is_cleanup_timer_enabled = True


def set_cleanup_timer_enabled(enabled: bool) -> None:
    """Turn the cleanup timer on or off for code that runs the cleanup on its own schedule

    run_cleanup_timer reads the switch as its block starts, so a change applies from the next start and leaves a
    running timer alone

    Args:
        enabled: False leaves out the timer's passes, the one at the start included, so the kinds the
            cleanup covers wait until the caller runs prune_expired_records

    Raises:
        TypeError: The value is not a bool, since text such as "false" would count as on
    """
    global _is_cleanup_timer_enabled
    if not isinstance(enabled, bool):
        raise TypeError("set_cleanup_timer_enabled takes True or False")
    _is_cleanup_timer_enabled = enabled


@asynccontextmanager
async def run_cleanup_timer() -> AsyncIterator[None]:
    """Prune at once and then every interval while the block runs, and stop the timer when the block ends

    The switch is read as the block starts. With the timer turned off before then, the block runs no
    pass and logs one line saying the timer is off
    """
    if not _is_cleanup_timer_enabled:
        logger.info("The cleanup timer is off, so expired records wait for prune_expired_records")
        yield
        return

    timer = asyncio.create_task(_prune_expired_records_on_schedule())
    try:
        yield
    finally:
        timer.cancel()
        with suppress(asyncio.CancelledError):
            await timer
