"""Seeding profiles at each stage of a deletion that waits"""

from datetime import datetime

from sqlalchemy import select

from app.models.currency import Currency
from app.models.user import User
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _build_account, _build_user


async def _commit_user(
    email: str,
    *,
    requested_at: datetime | None = None,
    due_at: datetime | None = None,
    reminder_sent_at: datetime | None = None,
    with_account: bool = False,
) -> User:
    """Commit a user, marked for deletion when requested_at is given, optionally with an account to lose

    Args:
        email: The user's address
        requested_at: When the deletion was requested, none for a user who never asked
        due_at: When the deletion is due, none for a mark that deletes at once
        reminder_sent_at: When the reminder went, none for one not sent yet
        with_account: Whether to give the user a personal account, so a deletion has data to remove
    """
    user = _build_user(email)
    user.deletion_requested_at = requested_at
    user.deletion_due_at = due_at
    user.deletion_reminder_sent_at = reminder_sent_at
    async with TestSession() as session:
        if await session.get(Currency, "CAD") is None:
            session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
            await session.flush()
        session.add(user)
        await session.flush()
        if with_account:
            session.add(_build_account(user.id))
        await session.commit()
    return user


async def _stored_marks(user: User) -> tuple[datetime | None, datetime | None, datetime | None] | None:
    """The user's requested, due and reminder times as stored, or None once the user row is gone"""
    async with TestSession() as session:
        row = (
            await session.execute(
                select(User.deletion_requested_at, User.deletion_due_at, User.deletion_reminder_sent_at).where(User.id == user.id)
            )
        ).first()
    return None if row is None else tuple(row)
