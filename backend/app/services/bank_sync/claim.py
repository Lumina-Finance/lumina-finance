"""Claiming a provider credential, as a new bank connection or in place of a rejected one

The supplied credential, such as a setup token, is exchanged once for the access Lumina
stores encrypted, and is never kept. The access itself is never logged or returned: only its host
is kept in the clear. Right after the claim, the same request discovers the connection's bank
accounts, so the response can list them, or say which linked accounts resume after a reconnect
"""

import re
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime

from fastapi import HTTPException, status
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.encryption import encrypt
from app.models.bank_connection import BankAccountLink, BankConnection, BankImportKind, BankLinkState, ProviderRequestPurpose
from app.models.bank_sync_job import BankSyncJobKind
from app.models.user import User
from app.schemas.bank_sync import (
    BankConnectionResponse,
    CreateBankConnectionRequest,
    ReconnectBankConnectionRequest,
    ReconnectBankConnectionResponse,
)
from app.services.bank_sync.availability import (
    LIVE_LINK,
    PROVIDER_GONE_DETAIL,
    adapter_for,
    get_enabled_adapter,
    is_offered,
    require_bank_linking,
)
from app.services.bank_sync.connections import build_connection_responses, get_own_connection, read_nickname
from app.services.bank_sync.discovery import run_discovery
from app.services.bank_sync.jobs import enqueue_bank_sync_job
from app.services.bank_sync.provider_requests import record_provider_request
from app.services.bank_sync.providers.contract import ClaimRefused, ProviderAdapter, ProviderUnreachable
from app.services.cache_state.updates import mark_user_cache_changed

WORKING_CONNECTION_DETAIL = "This connection is working, so it doesn't need reconnecting"


async def claim_connection(db: AsyncSession, user: User, request: CreateBankConnectionRequest) -> BankConnectionResponse:
    """Claim a supplied credential as a new connection and discover its bank accounts

    Once the provider has handed over the access, the connection is kept even when its discovery
    fails, since the supplied credential is spent, and a job flagged to discover its bank accounts
    is queued

    Args:
        db: Active database session
        user: The user connecting
        request: The provider, the credential the user supplied and an optional nickname

    Returns:
        The new connection, with the bank accounts found or a pending discovery

    Raises:
        HTTPException 403: The user may not link bank accounts, or the provider isn't offered for
            new connections
        HTTPException 404: The connection was disconnected while its bank accounts were listed
        HTTPException 422: The provider isn't enabled, the nickname is too long, or the provider
            refused the credential, saying why
        HTTPException 502: The provider couldn't be reached or gave no usable answer, so nothing
            is saved and the credential can be tried again
    """
    adapter = get_enabled_adapter(request.provider)
    require_bank_linking(user.id)
    nickname = read_nickname(request.nickname)
    if not is_offered(request.provider):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"{adapter.provider_name} is not offered for new connections. Existing connections keep working",
        )

    credential = await _claim_credential(adapter, request.credentials)
    now = datetime.now(UTC)
    connection = BankConnection(owner_id=user.id, provider=request.provider, provider_name=adapter.provider_name, nickname=nickname)
    _store_credential(connection, adapter, credential)
    db.add(connection)
    await db.flush()

    # The claim was sent before the connection existed to count it against, so it is counted now
    await record_provider_request(db, owner_id=user.id, connection_id=connection.id, purpose=ProviderRequestPurpose.CLAIM, now=now)
    await mark_user_cache_changed(db, user.id)

    if not await run_discovery(db, connection, adapter, now=now):
        await enqueue_bank_sync_job(db, owner_id=user.id, connection_id=connection.id, kind=BankSyncJobKind.RETRY, discover=True)

    # Again, for the bank accounts the discovery stored after the first mark was committed
    await mark_user_cache_changed(db, user.id)
    await db.commit()

    # Loads the times the database set, which the response states
    await db.refresh(connection)
    return (await build_connection_responses(db, user.id, [connection]))[0]


async def reconnect_connection(
    db: AsyncSession,
    user: User,
    connection_id: uuid.UUID,
    request: ReconnectBankConnectionRequest,
) -> ReconnectBankConnectionResponse:
    """Replace a rejected connection's credential with a newly claimed one, and say which linked accounts resume

    Right after the claim the connection's bank accounts are listed. Each linked account whose bank
    account comes back unchanged resumes with a catch-up from its checkpoint, an import that runs
    to today whatever the review backlog. One whose bank account is no longer listed waits in
    Choose bank account. If the listing fails, the new credential is kept anyway, since the
    supplied one is spent, and the next sync lists the bank accounts first. A provider withdrawn
    from new connections still reconnects existing ones

    Args:
        db: Active database session
        user: The connection's owner
        connection_id: The connection to reconnect
        request: The credential the user supplied

    Returns:
        The connection, the accounts that resume and the ones whose bank account must be chosen
        again, or that both are known only once a sync lists the bank accounts

    Raises:
        HTTPException 403: The user may not link bank accounts
        HTTPException 404: The connection doesn't exist, is another user's, or was disconnected
            while its bank accounts were listed
        HTTPException 409: The connection's provider is no longer installed, or its credential still works
        HTTPException 422: The provider isn't enabled, or refused the credential, saying why
        HTTPException 502: The provider couldn't be reached or gave no usable answer, so nothing
            is saved and the credential can be tried again
    """
    require_bank_linking(user.id)
    connection = await get_own_connection(db, user.id, connection_id)
    if adapter_for(connection.provider) is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=PROVIDER_GONE_DETAIL)
    adapter = get_enabled_adapter(connection.provider)
    _refuse_working(connection)
    credential = await _claim_credential(adapter, request.credentials)

    # Checked again under a lock, since nothing is locked while the provider answers: a second
    # reconnect sent at the same time finds the first one's credential working, and a connection
    # disconnected meanwhile is not found. Locked for update, as counting the listing locks it
    # next, so the cache row marked below is still the last row this transaction locks
    now = datetime.now(UTC)
    connection = await get_own_connection(db, user.id, connection_id, lock={})
    _refuse_working(connection)
    _store_credential(connection, adapter, credential)
    connection.credential_rejected_at = None
    await record_provider_request(db, owner_id=user.id, connection_id=connection.id, purpose=ProviderRequestPurpose.CLAIM, now=now)
    await mark_user_cache_changed(db, user.id)

    listed = await run_discovery(db, connection, adapter, now=now)
    resumed, choose_again = await _resume_links(db, connection)
    if not listed or resumed:
        await enqueue_bank_sync_job(db, owner_id=user.id, connection_id=connection.id, kind=BankSyncJobKind.INITIAL, discover=not listed)

    # Again, for what the discovery and the links' restart wrote, with the cache row locked last
    await mark_user_cache_changed(db, user.id)
    await db.commit()
    return ReconnectBankConnectionResponse(
        connection=(await build_connection_responses(db, user.id, [connection]))[0],
        resumed_account_ids=resumed if listed else [],
        choose_again_account_ids=choose_again if listed else [],
        accounts_pending=not listed,
    )


def credential_noun(label: str) -> str:
    """A field's label as it reads mid-sentence, lowered unless it opens with an acronym, as "API key" does"""
    return label[0].lower() + label[1:] if re.match(r"[A-Z][a-z]", label) else label


def read_credentials(adapter: ProviderAdapter, supplied: Mapping[str, SecretStr]) -> dict[str, str]:
    """Take each of the provider's credential fields from what the user supplied, leaving out anything else

    Raises:
        HTTPException 422: A field is missing, blank or longer than it takes, named in a sentence
            that never repeats what was sent
    """
    credentials = {}
    for field in adapter.credential_fields:
        noun = credential_noun(field.label)
        value = supplied[field.key].get_secret_value() if field.key in supplied else ""
        if not value.strip():
            detail = f"Paste the {noun} from {adapter.provider_site}"
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)
        if len(value) > field.max_length:
            detail = f"That {noun} is too long. Copy only the {noun} from {adapter.provider_site} and try again"
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)
        credentials[field.key] = value
    return credentials


async def _claim_credential(adapter: ProviderAdapter, supplied: Mapping[str, SecretStr]) -> str:
    """Exchange the credentials the user supplied for the access the provider hands over

    Raises:
        HTTPException 422: A field is missing, blank or too long, or the provider refused the
            credentials, saying why
        HTTPException 502: The provider couldn't be reached or gave no usable answer
    """
    credentials = read_credentials(adapter, supplied)

    # The refusals are written for the user and never repeat a credential, and nothing is
    # chained to them that could
    try:
        return await adapter.claim(credentials)
    except ClaimRefused as refused:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(refused)) from None
    except ProviderUnreachable as unreachable:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(unreachable)) from None


def _store_credential(connection: BankConnection, adapter: ProviderAdapter, credential: str) -> None:
    """Keep a claimed credential encrypted on a connection, with the host it reaches in the clear"""
    connection.credential_encrypted = encrypt(credential)
    connection.server_host = adapter.server_host(credential)


def _refuse_working(connection: BankConnection) -> None:
    """Refuse a new credential for a connection whose current one still works

    Raises:
        HTTPException 409: The provider hasn't rejected the connection's credential
    """
    if connection.credential_rejected_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=WORKING_CONNECTION_DETAIL)


async def _resume_links(db: AsyncSession, connection: BankConnection) -> tuple[list[uuid.UUID], list[uuid.UUID]]:
    """Restart the connection's links after a reconnect, as its discovery left them

    An active link catches up from its checkpoint as a reconnect import, which runs to today
    whatever the review pause says, with a new retry series. No link keeps its last failure, which
    came before the new credential, so its sync status never shows it. The links are locked in id
    order after the connection, the order a disconnect takes them in, and before the job and the
    cache row, so an unlink, which locks its link and then the cache row, can't deadlock with the
    reconnect

    Returns:
        The accounts that resume, and the ones whose bank account must be chosen again, each in
        account id order
    """
    links = await db.scalars(
        select(BankAccountLink)
        .where(BankAccountLink.connection_id == connection.id, LIVE_LINK)
        .order_by(BankAccountLink.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    resumed, choose_again = [], []
    for link in links:
        link.last_failure_reason = None
        if link.state == BankLinkState.ACTIVE:
            link.import_kind = BankImportKind.RECONNECT
            link.importing = True
            link.retry_count = 0
            link.next_attempt_at = None
            resumed.append(link.account_id)
        else:
            choose_again.append(link.account_id)
    return sorted(resumed), sorted(choose_again)
