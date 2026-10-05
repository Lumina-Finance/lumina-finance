"""Reading an account's bank link for the account's page

The page shows the live link with how far its import has got, or what the account was last linked
to. Only the user's own personal accounts are linked, so any other account is refused as linking it is
"""

import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_connection import BankAccountLink, BankConnection, BankImportKind, BankLinkState
from app.models.bank_transaction import BankTransaction
from app.models.user import User
from app.schemas.bank_sync import (
    AccountBankLinkResponse,
    AccountBankStatusResponse,
    BankImportProgressResponse,
    BankImportState,
    PreviousBankLinkResponse,
)
from app.services.accounts.access import get_own_personal_account
from app.services.bank_sync.availability import LINK_NOT_OWN_DETAIL, LIVE_LINK, PROVIDER_ADAPTERS
from app.services.bank_sync.provider_requests import read_request_budget
from app.services.bank_sync.retries import is_waiting_to_retry
from app.services.bank_sync.windows import LinkNeed, plan_window
from app.utils.dates import resolve_timezone


async def read_account_bank_status(db: AsyncSession, user: User, account_id: uuid.UUID) -> AccountBankStatusResponse:
    """Return an account's live link with its import's progress, or what the account was last linked to

    Args:
        db: Active database session
        user: The account's owner
        account_id: The account

    Returns:
        The live link, or when there is none, the latest unlinked one if the account was linked before

    Raises:
        HTTPException 403: The account is visible but isn't the user's own personal account
        HTTPException 404: The user can't see the account
        HTTPException 422: The profile's timezone no longer resolves, read only while an import runs
    """
    account = await get_own_personal_account(db, account_id, user.id, not_own_detail=LINK_NOT_OWN_DETAIL)
    link = await db.scalar(select(BankAccountLink).where(BankAccountLink.account_id == account.id, LIVE_LINK))
    if link is not None:
        return AccountBankStatusResponse(account_id=account.id, link=await _describe_link(db, user, link), previous_link=None)

    # Every link left is unlinked, so each has the day it ended
    previous = await db.scalar(
        select(BankAccountLink).where(BankAccountLink.account_id == account.id).order_by(BankAccountLink.unlinked_at.desc()).limit(1)
    )
    return AccountBankStatusResponse(
        account_id=account.id,
        link=None,
        previous_link=None
        if previous is None
        else PreviousBankLinkResponse(
            provider_name=PROVIDER_ADAPTERS[previous.provider].provider_name,
            external_account_id=previous.external_account_id,
            external_account_name=previous.external_account_name,
            institution_name=previous.institution_name,
            unlinked_at=previous.unlinked_at,
        ),
    )


async def _describe_link(db: AsyncSession, user: User, link: BankAccountLink) -> AccountBankLinkResponse:
    """Return a live link as the page shows it, with its import's progress while one runs from a recorded start

    A link waiting for its bank account to be chosen again doesn't sync, so it has no progress to show
    """
    importing = link.importing and link.state == BankLinkState.ACTIVE and link.import_kind != BankImportKind.RECONNECT
    return AccountBankLinkResponse(
        account_id=link.account_id,
        connection_id=link.connection_id,
        provider=link.provider,
        provider_name=PROVIDER_ADAPTERS[link.provider].provider_name,
        external_account_id=link.external_account_id,
        external_account_name=link.external_account_name,
        institution_name=link.institution_name,
        import_start=link.import_start,
        linked_at=link.linked_at,
        state=link.state,
        import_progress=await _read_import_progress(db, user, link) if importing else None,
    )


async def _read_import_progress(db: AsyncSession, user: User, link: BankAccountLink) -> BankImportProgressResponse:
    """Return how far a link's import from its import start has got

    Items found are the account's bank transactions received since the link was made, or since its
    bank account was chosen again, which restarts its link time
    """
    now = datetime.now(UTC)
    timezone = resolve_timezone(user.tz)
    windows_total, windows_done = _count_windows(
        link, today=now.astimezone(timezone).date(), timezone=timezone, max_days=PROVIDER_ADAPTERS[link.provider].max_window_days
    )
    items_found = await db.scalar(
        select(func.count()).where(BankTransaction.account_id == link.account_id, BankTransaction.received_at >= link.linked_at)
    )
    connection = await db.get_one(BankConnection, link.connection_id)
    return BankImportProgressResponse(
        kind=link.import_kind,
        state=await _read_import_state(db, link, connection, now=now),
        requested_start=link.import_start,
        windows_total=windows_total,
        windows_done=windows_done,
        items_found=items_found,
        earliest_returned_date=link.earliest_booked_date,
    )


async def _read_import_state(db: AsyncSession, link: BankAccountLink, connection: BankConnection, *, now: datetime) -> BankImportState:
    """Return whether a link's import can fetch its next part now, or what holds it back

    A failed attempt waiting to retry, a bank that needs a sign-in and a refused credential each hold
    it until something changes, and a spent budget until a request frees up
    """
    if is_waiting_to_retry(link) or link.signin_needed_since is not None or connection.credential_rejected_at is not None:
        return "waiting"
    budget = await read_request_budget(db, connection, now=now)
    return "running" if budget.available_again_at is None else "waiting_on_budget"


def _count_windows(link: BankAccountLink, *, today: date, timezone: ZoneInfo, max_days: int) -> tuple[int, int]:
    """Return how many windows the link's import from its start through today splits into, and how many its checkpoint covers

    The windows are the ones the planner fetches for this link alone. Another link on the same
    connection can shift them, and a failed window is fetched again in halves, so this is a measure
    of progress rather than the requests sent. A start still to come counts as one window
    """
    total = done = 0
    first_day = link.import_start
    while first_day <= today:
        window = plan_window([LinkNeed(link, first_day)], today=today, timezone=timezone, max_days=max_days)
        total += 1
        done += window.last_day <= link.checkpoint
        first_day = window.last_day + timedelta(days=1)
    return max(total, 1), done
