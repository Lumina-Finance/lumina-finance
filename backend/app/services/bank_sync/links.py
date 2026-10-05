"""Linking a Lumina account to a bank account on one of the user's connections

The account's link flow lists a connection's bank accounts for the account, each linkable or
unavailable with its reason from the one eligibility check, and links one of them from a chosen
start. Opening the flow asks for a fresh discovery when the last one is over an hour old, so a bank
added at the provider a few minutes ago appears without waiting for the daily sync. The link
request checks again everything the list showed, since the list can be stale, and queues the
link's first import, which a job runs
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import exists, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_connection import (
    BankAccountLink,
    BankConnection,
    BankExternalAccount,
    BankImportKind,
    BankLinkState,
    UnavailableReason,
)
from app.models.bank_sync_job import BankSyncJobKind
from app.models.institution import Institution
from app.models.user import User
from app.schemas.bank_sync import (
    BankAccountLinkResponse,
    DiscoveredBankAccountResponse,
    DiscoveredBankAccountsResponse,
    LinkBankAccountRequest,
)
from app.services.accounts.access import get_own_personal_account
from app.services.bank_sync.availability import (
    LINK_NOT_OWN_DETAIL,
    Unavailability,
    find_unavailability,
    get_enabled_adapter,
    get_institution_allowance,
    read_linked_bank_accounts,
    require_bank_linking,
)
from app.services.bank_sync.connections import get_own_connection, read_discovering_connections
from app.services.bank_sync.import_range import read_import_range
from app.services.bank_sync.jobs import enqueue_bank_sync_job
from app.services.bank_sync.provider_requests import read_request_budget
from app.services.bank_sync.providers.contract import ProviderAdapter
from app.services.cache_state.updates import mark_user_cache_changed
from app.utils.dates import format_day, resolve_timezone

# Opening the link flow asks for a fresh discovery once the last one is older than this
FRESH_DISCOVERY_AGE = timedelta(hours=1)

ACCOUNT_ALREADY_LINKED = "This account is already linked to a bank"
BANK_ACCOUNT_ALREADY_LINKED = "That bank account is already linked to another account"

_LIVE_LINK = BankAccountLink.state != BankLinkState.UNLINKED


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
        await mark_user_cache_changed(db, user.id)
        await db.commit()

    bank_accounts = await db.scalars(
        select(BankExternalAccount)
        .where(BankExternalAccount.connection_id == connection.id, BankExternalAccount.listed.is_(True))
        .order_by(BankExternalAccount.institution_name, BankExternalAccount.name, BankExternalAccount.external_id)
    )
    linked_to = await read_linked_bank_accounts(db, user.id)
    allowance = await get_institution_allowance(db, user.id, connection.provider)
    account_institution = await _read_institution_name(db, account)
    accounts = []
    for bank_account in bank_accounts:
        linked = linked_to.get((connection.provider, bank_account.external_id))
        unavailable = find_unavailability(
            bank_account,
            account,
            linked_to=linked[1] if linked else None,
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

    The import starts on the chosen day, which has to be inside the account's import range, and
    runs as a job, so the request returns at once. An account linked before gets a relink import

    Args:
        db: Active database session
        user: The user linking the account
        account_id: The account to link
        request: The connection, the bank account it lists and the import's first day

    Returns:
        The new link

    Raises:
        HTTPException 403: The user may not link bank accounts, the account isn't their own
            personal account, or the bank account's institution would go over their limit
        HTTPException 404: The account or connection isn't the user's, or the connection no longer
            lists the bank account
        HTTPException 409: The account or the bank account is already linked, or the provider
            rejected the connection
        HTTPException 422: The account is archived, the deployment doesn't enable the provider,
            the currencies differ or the start is outside the import range
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

    linked = (await read_linked_bank_accounts(db, user.id)).get((connection.provider, bank_account.external_id))
    unavailable = find_unavailability(
        bank_account,
        account,
        linked_to=linked[1] if linked else None,
        allowance=await get_institution_allowance(db, user.id, connection.provider),
        provider_name=adapter.provider_name,
    )
    if unavailable is not None:
        raise _refuse_unavailable(unavailable, bank_account, account)

    today = datetime.now(resolve_timezone(user.tz)).date()
    import_range = await read_import_range(db, account.id, history_months=adapter.history_limit_months, today=today)
    if not import_range.allows(request.start_date):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Choose a start date from {format_day(import_range.earliest_allowed)} to {format_day(import_range.latest_allowed)}",
        )

    was_linked_before = await db.scalar(select(exists().where(BankAccountLink.account_id == account.id)))
    link = BankAccountLink(
        owner_id=user.id,
        account_id=account.id,
        connection_id=connection.id,
        provider=connection.provider,
        external_account_id=bank_account.external_id,
        external_account_name=bank_account.name,
        institution_name=bank_account.institution_name,
        import_kind=BankImportKind.RELINK if was_linked_before else BankImportKind.INITIAL,
        import_start=request.start_date,
        # Nothing is known complete yet, so the import fetches from its first day
        checkpoint=request.start_date - timedelta(days=1),
    )
    db.add(link)

    # The account is locked, so only a link to the same bank account through another of the
    # user's connections can race this one, which the one-ledger-per-bank-account index refuses
    try:
        await db.flush()
    except IntegrityError as error:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=BANK_ACCOUNT_ALREADY_LINKED) from error

    await enqueue_bank_sync_job(db, owner_id=user.id, connection_id=connection.id, kind=BankSyncJobKind.INITIAL)
    await mark_user_cache_changed(db, user.id)
    await db.commit()
    await db.refresh(link)
    return BankAccountLinkResponse(
        account_id=link.account_id,
        connection_id=connection.id,
        provider=link.provider,
        provider_name=adapter.provider_name,
        external_account_id=link.external_account_id,
        external_account_name=link.external_account_name,
        institution_name=link.institution_name,
        import_start=link.import_start,
        linked_at=link.linked_at,
    )


async def _get_account_to_link(db: AsyncSession, user: User, account_id: uuid.UUID, *, lock: bool) -> Account:
    """Return one of the user's own personal accounts that isn't archived or linked

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
    if await db.scalar(select(exists().where(BankAccountLink.account_id == account.id, _LIVE_LINK))):
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
    connection = await get_own_connection(db, user_id, connection_id)
    if lock:
        await db.refresh(connection, with_for_update={"read": True, "key_share": True})
    adapter = get_enabled_adapter(connection.provider)
    if connection.credential_rejected_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{adapter.provider_name} rejected this connection. Reconnect it in Settings with a new setup token",
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


async def _read_institution_name(db: AsyncSession, account: Account) -> str | None:
    """Return the name of the institution the account names, if it names one"""
    if account.institution_id is None:
        return None
    return await db.scalar(select(Institution.name).where(Institution.id == account.institution_id))


def _institution_differs(bank_institution: str, account_institution: str | None) -> bool:
    """Return whether a bank account's institution looks different from the one the account names

    Names are compared loosely, so "Harbour" and "Harbour Bank" read as the same institution. An
    account naming none differs from nothing
    """
    named = (account_institution or "").strip().casefold()
    listed = bank_institution.strip().casefold()
    return bool(named) and named not in listed and listed not in named


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
                detail="That bank account uses a currency of its own, which Lumina Finance can't track",
            )
        case UnavailableReason.ALREADY_LINKED:
            return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=BANK_ACCOUNT_ALREADY_LINKED)
        case UnavailableReason.INSTITUTION_LIMIT:
            return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=unavailable.message)
