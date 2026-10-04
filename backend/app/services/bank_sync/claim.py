"""Claiming a provider credential as a new bank connection

The supplied credential, such as a SimpleFIN setup token, is exchanged once for the access Lumina
stores encrypted, and is never kept. The access itself is never logged or returned: only its host
is kept in the clear. Right after the claim, the same request discovers the connection's bank
accounts, so the response can list them
"""

from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.encryption import encrypt
from app.models.bank_connection import BankConnection, ProviderRequestPurpose
from app.models.bank_sync_job import BankSyncJobKind
from app.models.user import User
from app.schemas.bank_sync import BankConnectionResponse, CreateBankConnectionRequest
from app.services.bank_sync.availability import get_enabled_adapter, is_offered, may_link_bank_accounts
from app.services.bank_sync.connections import build_connection_responses, read_nickname
from app.services.bank_sync.discovery import run_discovery
from app.services.bank_sync.jobs import enqueue_bank_sync_job
from app.services.bank_sync.provider_requests import record_provider_request
from app.services.bank_sync.providers.contract import ClaimRefused, ProviderUnreachable
from app.services.cache_state.updates import mark_user_cache_changed


async def claim_connection(db: AsyncSession, user: User, request: CreateBankConnectionRequest) -> BankConnectionResponse:
    """Claim a supplied credential as a new connection and discover its bank accounts

    Once the provider has handed over the access, the connection is kept even when its discovery
    fails, since the supplied credential is spent. Its next job then discovers the bank accounts

    Args:
        db: Active database session
        user: The user connecting
        request: The provider, the credential the user supplied and an optional nickname

    Returns:
        The new connection, with the bank accounts found or a pending discovery

    Raises:
        HTTPException 403: The user may not link bank accounts, or the provider isn't offered for
            new connections
        HTTPException 422: The provider isn't enabled, the nickname is too long, or the provider
            refused the credential, saying why
        HTTPException 502: The provider couldn't be reached or gave no usable answer, so nothing
            is saved and the credential can be tried again
    """
    adapter = get_enabled_adapter(request.provider)
    if adapter is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Choose a bank provider this server supports")
    if not may_link_bank_accounts(user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bank sync isn't available for your account")
    nickname = read_nickname(request.nickname)
    if not is_offered(request.provider):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"{adapter.provider_name} is not offered for new connections. Existing connections keep working",
        )

    # The refusals are written for the user and never repeat the credential, and nothing is
    # chained to them that could
    try:
        credential = await adapter.claim(request.setup_token)
    except ClaimRefused as refused:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(refused)) from None
    except ProviderUnreachable as unreachable:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(unreachable)) from None

    now = datetime.now(UTC)
    connection = BankConnection(
        owner_id=user.id,
        provider=request.provider,
        nickname=nickname,
        credential_encrypted=encrypt(credential),
        server_host=adapter.server_host(credential),
    )
    db.add(connection)
    await db.flush()

    # The claim was sent before the connection existed to count it against, so it is counted now
    await record_provider_request(db, owner_id=user.id, connection_id=connection.id, purpose=ProviderRequestPurpose.CLAIM, now=now)
    await mark_user_cache_changed(db, user.id)

    if not await run_discovery(db, connection, adapter, now=now):
        await enqueue_bank_sync_job(db, owner_id=user.id, connection_id=connection.id, kind=BankSyncJobKind.MANUAL, discover=True)
    await db.commit()

    # Loads the times the database set, which the response states
    await db.refresh(connection)
    return (await build_connection_responses(db, user.id, [connection]))[0]
