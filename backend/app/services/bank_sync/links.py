"""Linking an account to a bank account on one of the user's connections, and ending links

The account's link flow lists a connection's bank accounts for the account, each linkable or
unavailable with its reason from the one eligibility check, and links one of them from a chosen
start, or for a chosen date range. Opening the flow asks for a fresh discovery when the last one is
over an hour old, so a bank added at the provider a few minutes ago appears without waiting for the
daily sync. The link
request checks again everything the list showed, since the list can be stale, and queues the
link's first import for 2 minutes on, moving a queued one back to 2 minutes after this link, so
the accounts linked in a row share one import. A job runs it, or the user starts it sooner.

A link waiting in Choose bank account, because the provider now lists its bank account differently,
goes through the same flow. Choosing moves the link to the new bank account with an import of its
own from the chosen start, since the old bank account's progress and transaction identities can't
be assumed to carry over. What the new one sends again under new identities waits for review like
anything else it brings in. Items the old one left waiting for review stay where they are.

Unlinking ends one account's link and disconnecting ends every link on a connection and deletes it.
Either clears the accounts' pending bank transactions, since nothing can refresh them any more, and
keeps everything else: ledger transactions and their bank source, review decisions and the items
still waiting for review. An ended link stays as a row, so the account remembers what it followed
"""

import uuid
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_connection import (
    FRESH_DISCOVERY_AGE,
    BankAccountLink,
    BankConnection,
    BankExternalAccount,
    BankImportKind,
    BankLinkState,
    UnavailableReason,
)
from app.models.bank_sync_job import BankSyncJob, BankSyncJobKind
from app.models.base import PermissionLevel
from app.models.institution import Institution
from app.models.user import User
from app.permissions import check_account_access
from app.schemas.bank_sync import (
    BankAccountLinkResponse,
    DiscoveredBankAccountResponse,
    DiscoveredBankAccountsResponse,
    LinkBankAccountRequest,
    UnlinkResponse,
)
from app.services.accounts.access import get_own_personal_account
from app.services.bank_sync.availability import (
    LINK_NOT_OWN_DETAIL,
    LIVE_LINK,
    Unavailability,
    find_unavailability,
    get_enabled_adapter,
    get_institution_allowance,
    read_linked_bank_accounts,
    require_bank_linking,
)
from app.services.bank_sync.connections import get_own_connection, read_discovering_connections, read_listed_bank_accounts
from app.services.bank_sync.holds import clear_holds
from app.services.bank_sync.import_range import check_import_days, read_import_range
from app.services.bank_sync.jobs import enqueue_bank_sync_job
from app.services.bank_sync.pending import replace_pending_transactions
from app.services.bank_sync.provider_requests import read_request_budget
from app.services.bank_sync.providers.contract import ProviderAdapter
from app.services.bank_sync.range_days import forget_range, start_range
from app.services.bank_sync.review_pause import lock_account_links
from app.services.cache_state.updates import mark_user_cache_changed, mark_user_status_changed
from app.utils.dates import resolve_timezone

# How long a link's import waits for the user's other accounts on the connection to be linked. Each
# link made meanwhile moves the start to this long after it, and joins the same import, since one
# request fetches any number of bank accounts and the provider allows only so many requests a day.
# The user can start it sooner
IMPORT_START_DELAY = timedelta(minutes=2)

ACCOUNT_ALREADY_LINKED = "This account is already linked to a bank"
ACCOUNT_NOT_LINKED = "This account is not linked to a bank"
BANK_ACCOUNT_ALREADY_LINKED = "That bank account is already linked to another account"


async def list_bank_accounts_for_account(
    db: AsyncSession,
    user: User,
    connection_id: uuid.UUID,
    account_id: uuid.UUID,
) -> DiscoveredBankAccountsResponse:
    """Return a connection's bank accounts for the account being linked, asking for a fresh discovery when due

    A discovery is queued when the connection's last one is over an hour old, none is queued or
    running already, and the request budget has a request free. Every bank account the connection
    lists is returned, an unavailable one with its reason rather than left out

    Args:
        db: Active database session
        user: The user linking the account
        connection_id: The connection whose bank accounts to list
        account_id: The account being linked

    Returns:
        The bank accounts, and whether a discovery is queued or running

    Raises:
        HTTPException 403: The user may not link bank accounts, or the account isn't their own
            personal account
        HTTPException 404: The account or connection isn't the user's
        HTTPException 409: The account is already linked, or the provider rejected the connection
        HTTPException 422: The account is archived, or the deployment doesn't enable the provider
    """
    require_bank_linking(user.id)
    account = await _get_account_to_link(db, user, account_id, lock=False)
    connection, adapter = await _get_working_connection(db, user.id, connection_id, lock=False)
    if await _request_fresh_discovery(db, connection, now=datetime.now(UTC)):
        # The connection now shows a listing pending. That changes none of the user's data
        await mark_user_status_changed(db, user.id)
        await db.commit()

    bank_accounts = (await read_listed_bank_accounts(db, [connection.id]))[connection.id]
    linked_to = await read_linked_bank_accounts(db, user.id)
    allowance = await get_institution_allowance(db, user.id, connection.provider)
    account_institution = await _read_institution_name(db, account)
    accounts = []
    for bank_account in bank_accounts:
        unavailable = find_unavailability(
            bank_account,
            account,
            linked_to=_linked_elsewhere(linked_to, connection.provider, bank_account, account),
            allowance=allowance,
            provider_name=adapter.provider_name,
        )
        accounts.append(
            DiscoveredBankAccountResponse(
                external_id=bank_account.external_id,
                name=bank_account.name,
                institution_name=bank_account.institution_name,
                currency=bank_account.currency,
                balance=bank_account.balance,
                balance_date=bank_account.balance_at,
                linkable=unavailable is None,
                unavailable_reason=unavailable.reason if unavailable else None,
                unavailable_message=unavailable.message if unavailable else None,
                institution_differs=_institution_differs(bank_account.institution_name, account_institution),
            )
        )
    return DiscoveredBankAccountsResponse(
        accounts=accounts,
        discovery_pending=connection.id in await read_discovering_connections(db, [connection.id]),
    )


async def link_bank_account(
    db: AsyncSession,
    user: User,
    account_id: uuid.UUID,
    request: LinkBankAccountRequest,
) -> BankAccountLinkResponse:
    """Link one of the user's accounts to a bank account on one of their connections, and queue its import

    The import starts on the chosen day and runs to today. With an end date before today it imports
    the chosen days as a date range instead, and starts syncing from today. Both days have to be
    inside the account's import range. The import runs as a job, so the request returns at once. An
    account linked before gets a relink import, and one whose link waits in Choose bank account keeps its link, moved to the chosen bank account
    with a choose-again import

    Args:
        db: Active database session
        user: The user linking the account
        account_id: The account to link
        request: The connection, the bank account it lists and the import's first and last days

    Returns:
        The link

    Raises:
        HTTPException 403: The user may not link bank accounts, the account isn't their own
            personal account, or the bank account's institution would go over their limit
        HTTPException 404: The account or connection isn't the user's, or the connection no longer
            lists the bank account
        HTTPException 409: The account or the bank account is already linked, or the provider
            rejected the connection
        HTTPException 422: The account is archived, the deployment doesn't enable the provider,
            the currencies differ, a day is outside the import range or the start is after the end
    """
    require_bank_linking(user.id)
    account = await _get_account_to_link(db, user, account_id, lock=True)
    connection, adapter = await _get_working_connection(db, user.id, request.connection_id, lock=True)

    # Shared, so a discovery that would stop listing it waits until the link exists and moves it too
    bank_account = await db.scalar(
        select(BankExternalAccount)
        .where(
            BankExternalAccount.connection_id == connection.id,
            BankExternalAccount.external_id == request.external_account_id,
            BankExternalAccount.listed.is_(True),
        )
        .with_for_update(read=True)
    )
    if bank_account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{adapter.provider_name} no longer returns that bank account",
        )

    linked_to = await read_linked_bank_accounts(db, user.id)
    unavailable = find_unavailability(
        bank_account,
        account,
        linked_to=_linked_elsewhere(linked_to, connection.provider, bank_account, account),
        allowance=await get_institution_allowance(db, user.id, connection.provider),
        provider_name=adapter.provider_name,
    )
    if unavailable is not None:
        raise _refuse_unavailable(unavailable, bank_account, account)

    today = datetime.now(resolve_timezone(user.tz)).date()
    import_range = await read_import_range(db, account.id, history_months=adapter.history_limit_months, today=today)
    end_date = today if request.end_date is None else request.end_date
    check_import_days(import_range, request.start_date, end_date)

    # Locked after the connection, the order a disconnect takes them in, and read again, since an
    # unlink or a discovery that lists the old bank account again may have moved it meanwhile
    link = await db.scalar(
        select(BankAccountLink)
        .where(BankAccountLink.account_id == account.id, LIVE_LINK)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if link is None:
        was_linked_before = await db.scalar(select(exists().where(BankAccountLink.account_id == account.id)))
        link = BankAccountLink(
            owner_id=user.id,
            account_id=account.id,
            import_kind=BankImportKind.RELINK if was_linked_before else BankImportKind.INITIAL,
        )
        db.add(link)
    elif link.state == BankLinkState.CHOOSE_ACCOUNT:
        _restart_for_new_bank_account(link)
        await replace_pending_transactions(db, account.id, [])
        await clear_holds(db, account.id)
    else:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=ACCOUNT_ALREADY_LINKED)
    link.connection_id = connection.id
    link.provider = connection.provider
    link.external_account_id = bank_account.external_id
    link.external_account_name = bank_account.name
    link.institution_name = bank_account.institution_name

    # A range ending before today is fetched once the import of today is done, and the days between
    # them stay as the ledger has them, since syncing picks up from today
    link.import_start = request.start_date if end_date == today else today
    if end_date < today:
        start_range(link, request.start_date, end_date, restores_dismissed=False)

    # Nothing is known complete yet, so the import fetches from its first day
    link.checkpoint = link.import_start - timedelta(days=1)

    # The account is locked, but the bank account is only shared, so another account linking the
    # same bank account can race this one, through this connection or another of the user's. The
    # one-ledger-per-bank-account index refuses whichever link is written second
    try:
        await db.flush()
    except IntegrityError as error:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=BANK_ACCOUNT_ALREADY_LINKED) from error

    await enqueue_bank_sync_job(
        db,
        owner_id=user.id,
        connection_id=connection.id,
        kind=BankSyncJobKind.INITIAL,
        run_after=datetime.now(UTC) + IMPORT_START_DELAY,
        moves_queued_import_later=True,
    )
    await mark_user_cache_changed(db, user.id)

    # Build the response before committing, since a delete of the account may take the link the moment
    # this commits
    await db.flush()
    await db.refresh(link)
    response = BankAccountLinkResponse(
        account_id=link.account_id,
        connection_id=connection.id,
        provider=link.provider,
        provider_name=adapter.provider_name,
        provider_site=adapter.provider_site,
        provider_available=True,
        external_account_id=link.external_account_id,
        external_account_name=link.external_account_name,
        institution_name=link.institution_name,
        import_start=link.import_start,
        linked_at=link.linked_at,
    )
    await db.commit()
    return response


async def unlink_account(db: AsyncSession, user: User, account_id: uuid.UUID) -> UnlinkResponse:
    """End an account's link, keeping its connection even when no account is left linked through it

    The link is locked before the pending transactions are cleared, so a sync finishing at the same
    time either writes first and has its pending items cleared, or finds the link ended and writes
    nothing for it

    Args:
        db: Active database session
        user: The account's owner
        account_id: The account to unlink

    Returns:
        The account unlinked

    Raises:
        HTTPException 404: The account isn't visible to the user, or isn't linked
    """
    await check_account_access(db, account_id, user.id, PermissionLevel.READ)
    link = await db.scalar(
        select(BankAccountLink)
        .where(BankAccountLink.account_id == account_id, BankAccountLink.owner_id == user.id, LIVE_LINK)
        .with_for_update()
    )
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ACCOUNT_NOT_LINKED)
    await _end_links(db, [link], now=datetime.now(UTC))
    await mark_user_cache_changed(db, user.id)
    await db.commit()
    return UnlinkResponse(unlinked_account_ids=[link.account_id])


async def lock_live_link(db: AsyncSession, user: User, account_id: uuid.UUID) -> tuple[Account, BankAccountLink]:
    """Lock the links of one of the user's own personal accounts, and return the account with its live link

    The links are locked after their connections, as every writer takes them, so a sync or a review
    decision writing the link finishes first, and a second write waits for the first and finds what it left

    Raises:
        HTTPException 403: The account is visible but isn't the user's own personal account
        HTTPException 404: The user can't see the account, or it isn't linked
    """
    account = await get_own_personal_account(db, account_id, user.id, not_own_detail=LINK_NOT_OWN_DETAIL)
    links = await lock_account_links(db, [account.id])
    link = next((link for link in links if link.state != BankLinkState.UNLINKED), None)
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=ACCOUNT_NOT_LINKED)
    return account, link


async def disconnect_connection(db: AsyncSession, user: User, connection_id: uuid.UUID) -> UnlinkResponse:
    """Unlink every account linked through a connection, and delete the connection with its stored credential

    The connection is locked first, so a link being made through it finishes before and is
    unlinked too, or waits and finds it gone. Its jobs are locked before its links, the order a
    job's finishing step takes them in, and deleting the connection deletes its jobs, so a sync
    still fetching writes nothing

    Args:
        db: Active database session
        user: The connection's owner
        connection_id: The connection to disconnect

    Returns:
        The accounts unlinked, none when nothing was linked through it

    Raises:
        HTTPException 404: The connection doesn't exist or is another user's
    """
    connection = await get_own_connection(db, user.id, connection_id, lock={})
    await db.execute(select(BankSyncJob.id).where(BankSyncJob.connection_id == connection.id).order_by(BankSyncJob.id).with_for_update())
    linked = await db.scalars(
        select(BankAccountLink).where(BankAccountLink.connection_id == connection.id, LIVE_LINK).order_by(BankAccountLink.id).with_for_update()
    )
    ended = linked.all()
    await _end_links(db, ended, now=datetime.now(UTC))
    await db.delete(connection)
    await mark_user_cache_changed(db, user.id)
    await db.commit()
    return UnlinkResponse(unlinked_account_ids=[link.account_id for link in ended])


async def _end_links(db: AsyncSession, ended: Sequence[BankAccountLink], *, now: datetime) -> None:
    """Mark locked links unlinked, ending any date range import, and clear their accounts' pending bank transactions"""
    for link in ended:
        link.state = BankLinkState.UNLINKED
        link.unlinked_at = now
        forget_range(link)
        await replace_pending_transactions(db, link.account_id, [])
        await clear_holds(db, link.account_id)


async def _get_account_to_link(db: AsyncSession, user: User, account_id: uuid.UUID, *, lock: bool) -> Account:
    """Return one of the user's own personal accounts that isn't archived, and isn't linked unless its bank account is to be chosen again

    Locked, a second link or an archive of the same account waits for this request and then sees
    what it did

    Raises:
        HTTPException 403: The account is visible but not the user's own personal account
        HTTPException 404: The account isn't visible to the user
        HTTPException 409: The account is already linked
        HTTPException 422: The account is archived
    """
    account = await get_own_personal_account(db, account_id, user.id, not_own_detail=LINK_NOT_OWN_DETAIL)
    if lock:
        await db.refresh(account, with_for_update={"key_share": True})
    if account.is_archived:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Archived accounts can't be linked to a bank")
    if await db.scalar(select(exists().where(BankAccountLink.account_id == account.id, BankAccountLink.state == BankLinkState.ACTIVE))):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=ACCOUNT_ALREADY_LINKED)
    return account


async def _get_working_connection(
    db: AsyncSession,
    user_id: uuid.UUID,
    connection_id: uuid.UUID,
    *,
    lock: bool,
) -> tuple[BankConnection, ProviderAdapter]:
    """Return one of the user's connections whose provider is enabled and whose credential works, with its adapter

    Locked, it is shared, so a disconnect waits until a link made through it exists and unlinks it too

    Raises:
        HTTPException 404: The connection isn't the user's
        HTTPException 409: The provider rejected the connection's credential
        HTTPException 422: The deployment doesn't enable the connection's provider
    """
    connection = await get_own_connection(db, user_id, connection_id, lock={"read": True, "key_share": True} if lock else None)
    adapter = get_enabled_adapter(connection.provider)
    if connection.credential_rejected_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{adapter.provider_name} rejected this connection. Please reconnect in Settings",
        )
    return connection, adapter


async def _request_fresh_discovery(db: AsyncSession, connection: BankConnection, *, now: datetime) -> bool:
    """Queue a discovery when the connection's last one is over an hour old and none is on its way

    Only while the request budget has a request free, since a discovery counts against it

    Returns:
        Whether a discovery was queued
    """
    if connection.discovered_at is not None and now - connection.discovered_at <= FRESH_DISCOVERY_AGE:
        return False
    if connection.id in await read_discovering_connections(db, [connection.id]):
        return False
    if (await read_request_budget(db, connection, now=now)).available_again_at is not None:
        return False
    await enqueue_bank_sync_job(db, owner_id=connection.owner_id, connection_id=connection.id, kind=BankSyncJobKind.RETRY, discover=True)
    return True


def _restart_for_new_bank_account(link: BankAccountLink) -> None:
    """Make a link waiting in Choose bank account active again as a choose-again import

    Its sync record belonged to the bank account as the provider listed it before, so none of it
    carries over, its reminders about history that bank account may not have returned included,
    since the new import raises its own. The review pause counts the account's waiting items, so it
    stays, and the new import runs to today whatever the pause says
    """
    link.state = BankLinkState.ACTIVE
    link.import_kind = BankImportKind.CHOOSE_AGAIN
    link.importing = True
    link.linked_at = func.now()
    link.last_success_at = None
    link.last_attempt_at = None
    link.last_failure_reason = None
    link.retry_count = 0
    link.next_attempt_at = None
    link.signin_needed_since = None
    link.catchup_requested_start = None
    link.earliest_booked_date = None
    link.history_reminder_start = None
    link.history_reminder_earliest = None
    link.history_reminder_dismissed = False
    link.cut_off_day = None
    link.cut_off_day_dismissed = False
    forget_range(link)


def _linked_elsewhere(
    linked_to: Mapping[tuple[str, str], tuple[uuid.UUID, str]],
    provider: str,
    bank_account: BankExternalAccount,
    account: Account,
) -> str | None:
    """Return the name of the account another link feeds the bank account into, if one does

    The account's own link waiting for its bank account to be chosen again doesn't count
    """
    linked = linked_to.get((provider, bank_account.external_id))
    return linked[1] if linked and linked[0] != account.id else None


async def _read_institution_name(db: AsyncSession, account: Account) -> str | None:
    """Return the name of the institution the account names, if it names one"""
    if account.institution_id is None:
        return None
    return await db.scalar(select(Institution.name).where(Institution.id == account.institution_id))


def _institution_differs(bank_institution: str, account_institution: str | None) -> bool:
    """Return whether a bank account's institution looks different from the one the account names

    Names are compared loosely, so "Harbour" and "Harbour Bank" read as the same institution
    whichever of them the account names. An account naming none differs from nothing, since an
    empty name is part of every name
    """
    named = (account_institution or "").strip().casefold()
    listed = bank_institution.strip().casefold()
    return named not in listed and listed not in named


def _refuse_unavailable(unavailable: Unavailability, bank_account: BankExternalAccount, account: Account) -> HTTPException:
    """Return the refusal for linking a bank account the eligibility check found unavailable"""
    match unavailable.reason:
        case UnavailableReason.CURRENCY_MISMATCH:
            return HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"That bank account is in {bank_account.currency}, but {account.name} is in {account.currency}",
            )
        case UnavailableReason.CUSTOM_CURRENCY:
            return HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="That bank account uses a currency of its own that Lumina Finance can't track",
            )
        case UnavailableReason.ALREADY_LINKED:
            return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=BANK_ACCOUNT_ALREADY_LINKED)
        case UnavailableReason.INSTITUTION_LIMIT:
            return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=unavailable.message)
