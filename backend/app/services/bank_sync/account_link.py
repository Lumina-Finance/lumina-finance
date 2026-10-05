"""Reading the user's bank links with how far each import has got and its sync status

An account's page shows its live link, or what the account was last linked to, and the app keeps
every live link's status current. Only the user's own personal accounts are linked, so any other
account is refused or left out as linking it is
"""

import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_connection import BankAccountLink
from app.models.bank_transaction import BankTransaction
from app.models.user import User
from app.schemas.bank_sync import (
    AccountBankStatusResponse,
    BankImportProgressResponse,
    BankImportState,
    BankLinkResponse,
    PreviousBankLinkResponse,
)
from app.services.accounts.access import get_own_personal_account, own_personal_account_condition
from app.services.bank_sync.availability import LINK_NOT_OWN_DETAIL, LIVE_LINK, PROVIDER_ADAPTERS
from app.services.bank_sync.status import read_link_statuses
from app.services.bank_sync.windows import LinkNeed, plan_window
from app.utils.dates import resolve_timezone


async def read_account_bank_status(db: AsyncSession, user: User, account_id: uuid.UUID) -> AccountBankStatusResponse:
    """Return an account's live link with its import's progress and sync status, or what the account was last linked to

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
        [described] = await _describe_links(db, user, [link], now=datetime.now(UTC))
        return AccountBankStatusResponse(account_id=account.id, link=described, previous_link=None)

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


async def list_bank_links(db: AsyncSession, user: User) -> list[BankLinkResponse]:
    """Return the user's live links on their own personal accounts, oldest first, with each import's progress and sync status

    A link waiting for its bank account to be chosen again is live, and an unlinked one isn't

    Args:
        db: Active database session
        user: The links' owner

    Returns:
        Each live link

    Raises:
        HTTPException 422: The profile's timezone no longer resolves, read only while an import runs
    """
    links = await db.scalars(
        select(BankAccountLink)
        .join(Account, Account.id == BankAccountLink.account_id)
        .where(LIVE_LINK, own_personal_account_condition(user.id))
        .order_by(BankAccountLink.linked_at, BankAccountLink.id)
    )
    return await _describe_links(db, user, links.all(), now=datetime.now(UTC))


async def _describe_links(db: AsyncSession, user: User, links: Sequence[BankAccountLink], *, now: datetime) -> list[BankLinkResponse]:
    """Return live links as the app shows them, in the order given, with each import's progress while it shows one"""
    statuses = await read_link_statuses(db, links, now=now)
    importing = [link for link in links if statuses[link.id].import_state is not None]
    items_found = await _count_items_found(db, importing)
    timezone = resolve_timezone(user.tz) if importing else None

    described = []
    for link in links:
        status = statuses[link.id]
        progress = None
        if status.import_state is not None and timezone is not None:
            progress = _describe_import(link, status.import_state, items_found.get(link.account_id, 0), now=now, timezone=timezone)
        described.append(
            BankLinkResponse(
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
                import_progress=progress,
                sync=status.sync,
            )
        )
    return described


def _describe_import(
    link: BankAccountLink, state: BankImportState, items_found: int, *, now: datetime, timezone: ZoneInfo
) -> BankImportProgressResponse:
    """Return how far a link's import from its import start has got"""
    windows_total, windows_done = _count_windows(
        link, today=now.astimezone(timezone).date(), timezone=timezone, max_days=PROVIDER_ADAPTERS[link.provider].max_window_days
    )
    return BankImportProgressResponse(
        kind=link.import_kind,
        state=state,
        requested_start=link.import_start,
        windows_total=windows_total,
        windows_done=windows_done,
        items_found=items_found,
        earliest_returned_date=link.earliest_booked_date,
    )


async def _count_items_found(db: AsyncSession, links: Sequence[BankAccountLink]) -> dict[uuid.UUID, int]:
    """Return how many items each link's import has found, by account id, leaving out accounts with none

    Items found are the account's bank transactions received since the link was made, or since its
    bank account was chosen again, which restarts its link time
    """
    if not links:
        return {}
    rows = await db.execute(
        select(BankTransaction.account_id, func.count())
        .join(BankAccountLink, BankAccountLink.account_id == BankTransaction.account_id)
        .where(BankAccountLink.id.in_([link.id for link in links]), BankTransaction.received_at >= BankAccountLink.linked_at)
        .group_by(BankTransaction.account_id)
    )
    return {account_id: count for account_id, count in rows.all()}


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
