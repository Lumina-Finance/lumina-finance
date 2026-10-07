"""One cleanup for every kind of record that expires or is left behind

Each kind is one entry in EXPIRED_RECORD_KINDS. A self-hosted server prunes them all on a schedule
from inside the app, and any other runtime calls prune_expired_records from its own scheduler
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import timedelta
from typing import NamedTuple

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.database import async_session
from app.services.auth.mfa_challenge import delete_expired_mfa_challenges
from app.services.auth.oidc_login import delete_expired_oidc_authorization_requests
from app.services.auth.password_reset import delete_stale_password_reset_tokens
from app.services.auth.sessions import delete_expired_auth_sessions, delete_expired_auth_tokens
from app.services.auth.two_factor import prune_stale_factor_staging
from app.services.auth.webauthn import delete_expired_webauthn_challenges
from app.services.importers.shared.run_staging import delete_expired_import_runs

logger = logging.getLogger(__name__)

# How often the server prunes. Twice a day is enough for a personal server, since expired sign-ins and
# imports are already refused by their own expiry checks and a pass only clears what they leave. A
# staged two-factor setup is the exception: it stays confirmable until a pass or its owner's next
# login deletes it
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
    ExpiredRecordKind("two-factor staging", prune_stale_factor_staging),
    ExpiredRecordKind("import runs", delete_expired_import_runs),
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


async def prune_expired_records_on_schedule() -> None:
    """Prune at once and then every interval, until cancelled when the server shuts down"""
    while True:
        await prune_expired_records()
        await asyncio.sleep(EXPIRED_RECORD_PRUNE_INTERVAL.total_seconds())
