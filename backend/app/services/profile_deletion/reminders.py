"""Reminding the owners of waiting profile deletions, once each"""

import logging
import uuid
from datetime import datetime

from sqlalchemy import func, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.database import acting_as
from app.db.rls.functions import LIST_PROFILES_TO_REMIND
from app.models.user import User
from app.services.profile_deletion.emails import send_reminder_email

logger = logging.getLogger(__name__)


async def send_due_reminders(session_factory: async_sessionmaker[AsyncSession]) -> None:
    """Email every owner whose profile deletion is due within the reminder lead, once

    A profile whose reminder can't be recorded is logged and skipped, and the rest still run

    Args:
        session_factory: Opens the sessions the pass runs in, with no request identity
    """
    async with session_factory() as session:
        user_ids = list(await session.scalars(text(f"SELECT {LIST_PROFILES_TO_REMIND}()")))
    for user_id in user_ids:
        try:
            claimed = await _claim_reminder(session_factory, user_id)
        except Exception:
            # Best-effort: the reminder is claimed before it is sent, so a profile that fails here has not
            # been reminded and the next pass tries it again
            logger.warning("A profile deletion reminder could not be recorded yet", exc_info=True)
            continue
        if claimed is not None:
            await send_reminder_email(*claimed)


async def _claim_reminder(session_factory: async_sessionmaker[AsyncSession], user_id: uuid.UUID) -> tuple[str, datetime] | None:
    """Record the reminder as sent for a profile still waiting and not yet reminded, returning its address and due time

    The record is committed before the email goes, so a reminder is sent at most once, even when the send
    fails. Another pass that records it first, or a cancel that clears the mark, leaves nothing to claim
    """
    with acting_as(user_id):
        async with session_factory() as db:
            row = (
                await db.execute(
                    update(User)
                    .where(
                        User.id == user_id,
                        User.deletion_requested_at.is_not(None),
                        User.deletion_due_at > func.now(),
                        User.deletion_reminder_sent_at.is_(None),
                    )
                    .values(deletion_reminder_sent_at=func.now())
                    .returning(User.email, User.deletion_due_at)
                )
            ).first()
            await db.commit()
    return None if row is None else (row.email, row.deletion_due_at)
