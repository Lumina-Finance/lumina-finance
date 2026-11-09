"""Reading the user's bank links with how far each import has got and its sync status

An account's page shows its live link with the bank's balance beside the ledger's, or what the
account was last linked to, and the app keeps every live link's status current. Only the user's own
personal accounts are linked, so any other account is refused or left out as linking it is
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
    BankHistoryReminderResponse,
    BankImportProgressResponse,
    BankImportState,
    BankLinkResponse,
    PreviousBankLinkResponse,
)
from app.services.accounts.access import get_own_personal_account, own_personal_account_condition
from app.services.bank_sync.availability import LINK_NOT_OWN_DETAIL, LIVE_LINK, adapter_for, provider_site_label, read_provider_labels
from app.services.bank_sync.balance_comparison import compare_bank_balance, describe_balance_match
from app.services.bank_sync.status import read_link_statuses
from app.services.bank_sync.windows import LinkNeed, plan_window
from app.utils.dates import resolve_timezone


async def read_account_bank_status(db: AsyncSession, user: User, account_id: uuid.UUID) -> AccountBankStatusResponse:
    """Return an account's live link with its import's progress, sync status, bank balance and balance match, or what it was last linked to

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
            or a bank balance is compared
    """
    account = await get_own_personal_account(db, account_id, user.id, not_own_detail=LINK_NOT_OWN_DETAIL)
    link = await db.scalar(select(BankAccountLink).where(BankAccountLink.account_id == account.id, LIVE_LINK))
    if link is not None:
        balance = await compare_bank_balance(db, link, tz=user.tz)
        [described] = await describe_links(db, user, [link], now=datetime.now(UTC))
        return AccountBankStatusResponse(
            account_id=account.id,
            link=described,
            previous_link=None,
            balance=balance,
            balance_match=await describe_balance_match(db, link, balance, tz=user.tz),
        )

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
            provider_name=(await read_provider_labels(db, [previous.provider]))[previous.provider],
            external_account_id=previous.external_account_id,
            external_account_name=previous.external_account_name,
            institution_name=previous.institution_name,
            unlinked_at=previous.unlinked_at,
        ),
        balance=None,
        balance_match=None,
    )


async def commit_with_account_bank_status(db: AsyncSession, user: User, account_id: uuid.UUID) -> AccountBankStatusResponse:
    """Commit a change to an account's link and return the account's bank status as it leaves it

    The status is read before committing, since a delete of the account may take the link the
    moment this commits
    """
    await db.flush()
    response = await read_account_bank_status(db, user, account_id)
    await db.commit()
    return response


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
    return await describe_links(db, user, links.all(), now=datetime.now(UTC))


async def describe_links(db: AsyncSession, user: User, links: Sequence[BankAccountLink], *, now: datetime) -> list[BankLinkResponse]:
    """Return live links as the app shows them, in the order given, with each import's progress while it shows one

    Raises:
        HTTPException 422: The profile's timezone no longer resolves, read only while an import runs
    """
    statuses = await read_link_statuses(db, links, now=now)
    importing = [link for link in links if statuses[link.id].import_state is not None]
    items_found = await _count_items_found(db, importing)
    timezone = resolve_timezone(user.tz) if importing else None
    names = await read_provider_labels(db, (link.provider for link in links))

    described = []
    for link in links:
        status = statuses[link.id]
        progress = None

        # An import through a provider no longer installed fetches nothing more, so it has no progress to show
        adapter = adapter_for(link.provider)
        if status.import_state is not None and timezone is not None and adapter is not None:
            progress = _describe_import(
                link, status.import_state, items_found.get(link.account_id, 0), now=now, timezone=timezone, max_days=adapter.max_window_days
            )
        described.append(
            BankLinkResponse(
                account_id=link.account_id,
                connection_id=link.connection_id,
                provider=link.provider,
                provider_name=names[link.provider],
                provider_site=provider_site_label(link.provider),
                provider_available=adapter is not None,
                external_account_id=link.external_account_id,
                external_account_name=link.external_account_name,
                institution_name=link.institution_name,
                import_start=link.import_start,
                linked_at=link.linked_at,
                state=link.state,
                import_progress=progress,
                sync=status.sync,
                history_reminder=_describe_history_reminder(link),
                cut_off_day=None if link.cut_off_day_dismissed else link.cut_off_day,
            )
        )
    return described


def _describe_history_reminder(link: BankAccountLink) -> BankHistoryReminderResponse | None:
    """Return the reminder the link's last import or catch-up that fell short raised, unless the user dismissed it"""
    if link.history_reminder_start is None or link.history_reminder_dismissed:
        return None
    return BankHistoryReminderResponse(requested_start=link.history_reminder_start, earliest_returned=link.history_reminder_earliest)


def _describe_import(
    link: BankAccountLink, state: BankImportState, items_found: int, *, now: datetime, timezone: ZoneInfo, max_days: int
) -> BankImportProgressResponse:
    """Return how far a link's import from its import start has got, in windows of the provider's longest fetch"""
    windows_total, windows_done = _count_windows(link, today=now.astimezone(timezone).date(), timezone=timezone, max_days=max_days)
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
    bank account was chosen again, since that restarts its link time
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
