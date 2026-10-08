"""Reminding the user when a link's import or catch-up returns less history than it asked for

A bank may keep less history than an import asks for, and a catch-up after a gap may not reach back
as far as it needs to, leaving a gap in the ledger nobody notices. A quiet account can simply have
had no activity early on, so the reminder says what came back rather than claiming a gap.

An import, and a catch-up over more than a week, notes the first day it asked from: the import's
start, or the first day the link lacked. As its parts are stored it keeps the earliest booked date
the provider returned from that first day on. Days re-read before it don't count, since history
from before a gap says nothing of it. Once it reaches today it falls short when that date is
more than a week after the first day, the grace a quiet account's first days get, or when nothing
came back from a first day more than a week before today. Its reminder replaces any earlier one,
dismissed or not, and stays until the user dismisses it. An import or catch-up from a week ago or
less can't fall short by more than the grace, so it raises nothing however quiet the account, and a
catch-up that short isn't noted at all
"""

import uuid
from collections.abc import Iterable, Sequence
from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_connection import BankAccountLink
from app.models.user import User
from app.schemas.bank_sync import AccountBankStatusResponse, DismissHistoryReminderRequest
from app.services.bank_sync.account_link import read_account_bank_status
from app.services.bank_sync.links import lock_live_link
from app.services.bank_sync.providers.contract import ProviderRecord
from app.services.bank_sync.windows import first_missing_day
from app.services.cache_state import mark_user_cache_changed

# How much later than the first day asked for the earliest booked date can be before an import or
# catch-up falls short, since a quiet account often has no activity in its first days
HISTORY_GRACE = timedelta(days=7)


def note_history_returned(deliveries: Iterable[tuple[BankAccountLink, Sequence[ProviderRecord]]], *, today: date) -> None:
    """Note the first day each link's import or catch-up asks from, and the earliest booked date it has returned

    Called before the checkpoints move, so a link whose checkpoint is still before its import start
    is starting its import, and one whose first missing day is more than a week before today is
    starting a catch-up over more than the grace. Pending records, those the provider removed and
    those dated before the first day don't count

    Args:
        deliveries: Each link brought back whole, locked, with the records the part returned for it
        today: Today in the owner's profile timezone
    """
    for link, records in deliveries:
        if link.catchup_requested_start is None:
            first_day = first_missing_day(link)
            if link.checkpoint >= link.import_start and today - first_day <= HISTORY_GRACE:
                continue
            link.catchup_requested_start = first_day
        asked_from = link.catchup_requested_start
        booked = [record.date for record in records if not record.pending and not record.removed and record.date >= asked_from]
        if booked and (link.earliest_booked_date is None or min(booked) < link.earliest_booked_date):
            link.earliest_booked_date = min(booked)


def raise_history_reminders(links: Iterable[BankAccountLink], *, today: date) -> bool:
    """Raise the reminder on each link whose import or catch-up reached today short of its first day, and stop noting its history

    Called once the checkpoints moved. A reminder raised replaces the link's earlier one and shows
    whether or not that one was dismissed

    Args:
        links: Links the part brought back whole, locked
        today: Today in the owner's profile timezone

    Returns:
        Whether a reminder was raised, so the caller tells the owner's pages
    """
    raised = False
    for link in links:
        requested_start = link.catchup_requested_start
        if requested_start is None or link.checkpoint < today:
            continue
        # Nothing back reads as nothing through today, which only an import or catch-up asking from
        # further back than the grace can fall short by
        earliest = link.earliest_booked_date
        if (today if earliest is None else earliest) - requested_start > HISTORY_GRACE:
            link.history_reminder_start = requested_start
            link.history_reminder_earliest = earliest
            link.history_reminder_dismissed = False
            raised = True
        link.catchup_requested_start = None
        link.earliest_booked_date = None
    return raised


async def dismiss_history_reminder(
    db: AsyncSession, user: User, account_id: uuid.UUID, request: DismissHistoryReminderRequest
) -> AccountBankStatusResponse:
    """Dismiss the history reminder a linked account shows, which hides it until a later import or catch-up falls short

    Only the reminder the user saw is dismissed. One already dismissed, or replaced by a newer one
    meanwhile, answers as the account stands, so a double submission dismisses it once and a newer
    reminder stays

    Args:
        db: Active database session
        user: The account's owner
        account_id: The linked account
        request: The reminder as it showed

    Returns:
        The account's bank link

    Raises:
        HTTPException 403: The account is visible but isn't the user's own personal account
        HTTPException 404: The user can't see the account, or it isn't linked
        HTTPException 422: The profile's timezone no longer resolves
    """
    account, link = await lock_live_link(db, user, account_id)
    shown = (link.history_reminder_start, link.history_reminder_earliest)
    if not link.history_reminder_dismissed and shown == (request.requested_start, request.earliest_returned):
        link.history_reminder_dismissed = True
        await mark_user_cache_changed(db, user.id)
        await db.commit()
    return await read_account_bank_status(db, user, account.id)
