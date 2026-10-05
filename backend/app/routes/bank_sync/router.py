"""Bank sync API routes"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.bank_connection import BankProvider
from app.models.user import User
from app.schemas.bank_sync import (
    BankAccountLinkResponse,
    BankConnectionResponse,
    BankImportRangeResponse,
    BankProvidersResponse,
    CreateBankConnectionRequest,
    DiscoveredBankAccountsResponse,
    LinkBankAccountRequest,
    ReconnectBankConnectionRequest,
    ReconnectBankConnectionResponse,
    UnlinkResponse,
    UpdateBankConnectionRequest,
)
from app.services.bank_sync.availability import list_providers
from app.services.bank_sync.claim import claim_connection, reconnect_connection
from app.services.bank_sync.connections import list_connections, rename_connection
from app.services.bank_sync.import_range import get_import_range
from app.services.bank_sync.links import (
    disconnect_connection,
    link_bank_account,
    list_bank_accounts_for_account,
    unlink_account,
)

router = APIRouter(prefix="/bank-sync", tags=["bank-sync"])

# An account's own link to a bank account, kept with the rest of bank sync rather than the account routes
bank_link_router = APIRouter(prefix="/accounts/{account_id}/bank-link", tags=["bank-sync"])


@router.get("/providers", response_model=BankProvidersResponse)
async def list_bank_providers(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the providers the deployment enables, and whether the user can link bank accounts now

    Args:
        user: Authenticated user choosing a provider
        db: Active database session

    Returns:
        The bank-linking check, whether sync is running, and each enabled provider's facts
    """
    return await list_providers(db, user)


@router.get("/connections", response_model=list[BankConnectionResponse])
async def list_bank_connections(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the user's bank connections, oldest first

    Args:
        user: Authenticated owner of the connections
        db: Active database session

    Returns:
        Each connection with its bank accounts, pending discovery and request budget
    """
    return await list_connections(db, user)


@router.post("/connections", response_model=BankConnectionResponse, status_code=status.HTTP_201_CREATED)
async def create_bank_connection(
    request: CreateBankConnectionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Claim a setup token as a new connection and discover its bank accounts

    Args:
        request: The provider, the setup token and an optional nickname
        user: Authenticated user connecting
        db: Active database session

    Returns:
        The new connection, with the bank accounts found or a pending discovery
    """
    return await claim_connection(db, user, request)


@router.patch("/connections/{connection_id}", response_model=BankConnectionResponse)
async def update_bank_connection(
    connection_id: uuid.UUID,
    request: UpdateBankConnectionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Set or clear a connection's nickname

    Args:
        connection_id: The connection to rename
        request: The new nickname, where blank brings back the provider's name
        user: Authenticated owner of the connection
        db: Active database session

    Returns:
        The renamed connection
    """
    return await rename_connection(db, user, connection_id, request)


@router.delete("/connections/{connection_id}", response_model=UnlinkResponse)
async def delete_bank_connection(
    connection_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Unlink every account linked through a connection and delete it with its stored credential

    Args:
        connection_id: The connection to disconnect
        user: Authenticated owner of the connection
        db: Active database session

    Returns:
        The accounts unlinked
    """
    return await disconnect_connection(db, user, connection_id)


@router.post("/connections/{connection_id}/reconnect", response_model=ReconnectBankConnectionResponse)
async def reconnect_bank_connection(
    connection_id: uuid.UUID,
    request: ReconnectBankConnectionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Replace a rejected connection's credential with a new setup token, and resume its linked accounts

    Args:
        connection_id: The connection to reconnect
        request: The new setup token
        user: Authenticated owner of the connection
        db: Active database session

    Returns:
        The connection, and which linked accounts resume or need their bank account chosen again
    """
    return await reconnect_connection(db, user, connection_id, request)


@router.get("/connections/{connection_id}/accounts", response_model=DiscoveredBankAccountsResponse)
async def list_connection_bank_accounts(
    connection_id: uuid.UUID,
    for_account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a connection's bank accounts for the account being linked, asking for a fresh discovery when due

    Args:
        connection_id: The connection whose bank accounts to list
        for_account_id: The account being linked
        user: Authenticated user linking the account
        db: Active database session

    Returns:
        Each bank account, linkable or unavailable with its reason, and whether a discovery is on its way
    """
    return await list_bank_accounts_for_account(db, user, connection_id, for_account_id)


@bank_link_router.post("", response_model=BankAccountLinkResponse, status_code=status.HTTP_201_CREATED)
async def create_bank_link(
    account_id: uuid.UUID,
    request: LinkBankAccountRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Link one of the user's accounts to a bank account and queue its import

    Args:
        account_id: The account to link
        request: The connection, the bank account it lists and the import's first day
        user: Authenticated user linking the account
        db: Active database session

    Returns:
        The new link
    """
    return await link_bank_account(db, user, account_id, request)


@bank_link_router.delete("", response_model=UnlinkResponse)
async def delete_bank_link(
    account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """End an account's link, keeping its connection

    Args:
        account_id: The account to unlink
        user: Authenticated owner of the account
        db: Active database session

    Returns:
        The account unlinked
    """
    return await unlink_account(db, user, account_id)


@bank_link_router.get("/import-range", response_model=BankImportRangeResponse)
async def get_bank_import_range(
    account_id: uuid.UUID,
    provider: BankProvider,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return where an import from a provider into one of the user's own accounts may start

    Args:
        account_id: The account to link
        provider: The provider the import would come from
        user: Authenticated user linking the account
        db: Active database session

    Returns:
        The allowed range, its suggestions and the facts the start step shows beside them
    """
    return await get_import_range(db, user, account_id, provider)
