"""Reminding the user when a link's import or catch-up returns less history than it asked for

A bank may keep less history than an import asks for, and a catch-up after a gap may not reach back
as far as it needs to, leaving a gap in the ledger nobody notices. A quiet account can simply have
had no activity early on, so the reminder says what came back rather than claiming a gap.

An import, and a catch-up over more than a week, notes the first day it asked from: the import's
start, or the first day the link lacked. As its parts are stored it keeps the earliest booked date
the provider returned from that first day on. Days re-read before it don't count, since history
from before a gap says nothing of it. Once it reaches today it falls short when that date is
more than a week after the first day, the grace a quiet account's first days get, or when nothing
came back at all, however recent the first day. A catch-up over a week or less isn't noted, so it
raises nothing however quiet the account. A reminder replaces any earlier one, dismissed or not,
and stays until the user dismisses it. One saying nothing came back also ends once a later sync
brings back booked history from its first day on, since what it says is no longer true.

A single day that still brings back as many transactions as the provider sends at once is kept,
though some of its transactions may be missing, so each link it brought back whole gets a reminder
of its own, naming the latest such day. Re-reading that day or an earlier one doesn't raise it
again once dismissed, and a later one does
"""

import uuid
from collections.abc import Iterable, Sequence
from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_connection import BankAccountLink
from app.models.user import User
from app.schemas.bank_sync import AccountBankStatusResponse, DismissCutOffDayRequest, DismissHistoryReminderRequest
from app.services.bank_sync.account_link import read_account_bank_status
from app.services.bank_sync.links import lock_live_link
from app.services.bank_sync.providers.contract import ProviderRecord
from app.services.bank_sync.windows import first_missing_day
from app.services.cache_state import mark_user_status_changed

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
        booked = _booked_dates(records, since=link.catchup_requested_start)
        if booked and (link.earliest_booked_date is None or min(booked) < link.earliest_booked_date):
            link.earliest_booked_date = min(booked)


def clear_no_history_reminders(deliveries: Iterable[tuple[BankAccountLink, Sequence[ProviderRecord]]]) -> bool:
    """Clear the reminder that nothing came back on each link the part returned booked history for from the reminder's first day on

    Whichever sync brings that history, the reminder's claim no longer holds. A routine sync's
    re-read days before the first day say nothing of the days after it, so they don't count. A
    dismissed reminder is cleared too. That changes nothing the user sees. A reminder that less
    history came back is never cleared this way

    Args:
        deliveries: Each link brought back whole, locked, with the records the part returned for it

    Returns:
        Whether a reminder was cleared, so the caller tells the owner's pages
    """
    cleared = False
    for link, records in deliveries:
        first_day = link.history_reminder_start
        if first_day is None or link.history_reminder_earliest is not None or not _booked_dates(records, since=first_day):
            continue
        link.history_reminder_start = None
        link.history_reminder_dismissed = False
        cleared = True
    return cleared


def _booked_dates(records: Iterable[ProviderRecord], *, since: date) -> list[date]:
    """Return the dates of the records the bank booked from a day on, leaving out those still pending and those it removed"""
    return [record.date for record in records if not record.pending and not record.removed and record.date >= since]


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
        earliest = link.earliest_booked_date
        if earliest is None or earliest - requested_start > HISTORY_GRACE:
            link.history_reminder_start = requested_start
            link.history_reminder_earliest = earliest
            link.history_reminder_dismissed = False
            raised = True
        link.catchup_requested_start = None
        link.earliest_booked_date = None
    return raised


def flag_cut_off_day(links: Iterable[BankAccountLink], day: date) -> bool:
    """Flag a day kept though its response may have been cut short on each link it brought back whole, unless a link has a later one

    The provider's limit counts every bank account in the response, so any of them may be missing
    transactions from that day

    Args:
        links: Links the day's part brought back whole, locked
        day: The day

    Returns:
        Whether a link's reminder changed, so the caller tells the owner's pages
    """
    flagged = False
    for link in links:
        if link.cut_off_day is None or day > link.cut_off_day:
            link.cut_off_day = day
            link.cut_off_day_dismissed = False
            flagged = True
    return flagged


async def dismiss_history_reminder(
    db: AsyncSession, user: User, account_id: uuid.UUID, request: DismissHistoryReminderRequest
) -> AccountBankStatusResponse:
    """Dismiss the history reminder a linked account shows. This hides it until a later import or catch-up falls short

    Only the reminder the user saw is dismissed. One already dismissed, or replaced by a newer one
    meanwhile, answers as the account stands, so a double submission dismisses it once and a newer
    reminder stays. A dismissal changes none of the user's data, so the data mark an import's undo
    compares with stays where it was

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
        await mark_user_status_changed(db, user.id)
        await db.commit()
    return await read_account_bank_status(db, user, account.id)


async def dismiss_cut_off_day(
    db: AsyncSession, user: User, account_id: uuid.UUID, request: DismissCutOffDayRequest
) -> AccountBankStatusResponse:
    """Dismiss the reminder about a day that may be missing transactions. This hides it until a later day raises it

    Only the day the user saw is dismissed. One already dismissed, or replaced by a later day
    meanwhile, answers as the account stands. Like the history reminder's, the dismissal leaves an
    import's undo as it was

    Args:
        db: Active database session
        user: The account's owner
        account_id: The linked account
        request: The day the reminder named

    Returns:
        The account's bank link

    Raises:
        HTTPException 403: The account is visible but isn't the user's own personal account
        HTTPException 404: The user can't see the account, or it isn't linked
        HTTPException 422: The profile's timezone no longer resolves
    """
    account, link = await lock_live_link(db, user, account_id)
    if not link.cut_off_day_dismissed and link.cut_off_day == request.day:
        link.cut_off_day_dismissed = True
        await mark_user_status_changed(db, user.id)
        await db.commit()
    return await read_account_bank_status(db, user, account.id)
