"""Listing and renaming a user's bank connections

A connection is described by its provider, nickname and server host, never its credential. Each
bank account it lists says which account it is linked to or which accounts could take it, through
the one bank-linking eligibility check
"""

import uuid
from collections import defaultdict
from collections.abc import Sequence
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_connection import BankConnection, BankExternalAccount, BankProviderRequest
from app.models.bank_sync_job import BankSyncJob, BankSyncJobStatus
from app.models.user import User
from app.schemas.bank_sync import (
    BankConnectionResponse,
    BankRequestBudgetResponse,
    ConnectionBankAccountResponse,
    UpdateBankConnectionRequest,
)
from app.services.bank_sync.availability import (
    PROVIDER_ADAPTERS,
    find_unavailability,
    get_institution_allowance,
    list_link_candidates,
    read_linked_bank_accounts,
)
from app.services.bank_sync.provider_requests import REQUEST_BUDGET_WINDOW, summarize_request_budget
from app.services.bank_sync.providers.contract import is_iso_currency_code
from app.services.cache_state.updates import mark_user_cache_changed

# The stored nickname's length, which the form states in its refusal
NICKNAME_MAX_LENGTH = 64

CONNECTION_NOT_FOUND = "Bank connection not found"


def read_nickname(nickname: str | None) -> str | None:
    """Return a trimmed nickname to store, where blank means none

    Raises:
        HTTPException 422: The nickname is longer than a connection can store
    """
    if nickname and len(nickname) > NICKNAME_MAX_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Keep the nickname to {NICKNAME_MAX_LENGTH} characters or fewer",
        )
    return nickname or None


async def read_discovering_connections(db: AsyncSession, connection_ids: Sequence[uuid.UUID]) -> set[uuid.UUID]:
    """Return which of the connections have a discovery queued or running"""
    discovering = await db.scalars(
        select(BankSyncJob.connection_id).where(
            BankSyncJob.connection_id.in_(connection_ids),
            BankSyncJob.discover.is_(True),
            BankSyncJob.status.in_((BankSyncJobStatus.QUEUED, BankSyncJobStatus.RUNNING)),
        )
    )
    return set(discovering)


async def build_connection_responses(
    db: AsyncSession,
    user_id: uuid.UUID,
    connections: Sequence[BankConnection],
) -> list[BankConnectionResponse]:
    """Describe connections with their bank accounts, a fixed number of queries however many there are

    Args:
        db: Active database session
        user_id: The connections' owner
        connections: The connections to describe, in the order to return them

    Returns:
        Each connection with its listed bank accounts, whether a discovery is pending and its
        request budget
    """
    if not connections:
        return []
    now = datetime.now(UTC)
    connection_ids = [connection.id for connection in connections]

    bank_accounts: dict[uuid.UUID, list[BankExternalAccount]] = defaultdict(list)
    listed = await db.scalars(
        select(BankExternalAccount)
        .where(BankExternalAccount.connection_id.in_(connection_ids), BankExternalAccount.listed.is_(True))
        .order_by(BankExternalAccount.institution_name, BankExternalAccount.name, BankExternalAccount.external_id)
    )
    for bank_account in listed:
        bank_accounts[bank_account.connection_id].append(bank_account)

    linked_to = await read_linked_bank_accounts(db, user_id)
    discovering = await read_discovering_connections(db, connection_ids)

    counted: dict[uuid.UUID, list[datetime]] = defaultdict(list)
    requests = await db.execute(
        select(BankProviderRequest.connection_id, BankProviderRequest.requested_at)
        .where(BankProviderRequest.connection_id.in_(connection_ids), BankProviderRequest.requested_at > now - REQUEST_BUDGET_WINDOW)
        .order_by(BankProviderRequest.requested_at)
    )
    for connection_id, requested_at in requests:
        counted[connection_id].append(requested_at)

    candidates = await list_link_candidates(db, user_id)
    providers = {connection.provider for connection in connections}
    allowances = {provider: await get_institution_allowance(db, user_id, provider) for provider in providers}

    responses = []
    for connection in connections:
        adapter = PROVIDER_ADAPTERS[connection.provider]
        accounts = []
        for bank_account in bank_accounts[connection.id]:
            link = linked_to.get((connection.provider, bank_account.external_id))
            eligible = [
                account.id
                for account in candidates
                if find_unavailability(
                    bank_account,
                    account,
                    linked_to=link[1] if link else None,
                    allowance=allowances[connection.provider],
                    provider_name=adapter.provider_name,
                )
                is None
            ]
            accounts.append(
                ConnectionBankAccountResponse(
                    external_id=bank_account.external_id,
                    name=bank_account.name,
                    institution_name=bank_account.institution_name,
                    currency=bank_account.currency,
                    custom_currency=not is_iso_currency_code(bank_account.currency),
                    linked_account_id=link[0] if link else None,
                    eligible_account_ids=eligible,
                )
            )
        budget = summarize_request_budget(
            counted[connection.id],
            limit=adapter.daily_request_budget,
            spent_until=connection.request_budget_spent_until,
            now=now,
        )
        responses.append(
            BankConnectionResponse(
                id=connection.id,
                provider=connection.provider,
                provider_name=adapter.provider_name,
                nickname=connection.nickname,
                server_label=connection.server_host,
                created_at=connection.created_at,
                status="credential_rejected" if connection.credential_rejected_at is not None else "active",
                accounts=accounts,
                discovery_pending=connection.id in discovering,
                request_budget=BankRequestBudgetResponse(limit=budget.limit, used=budget.used, available_again_at=budget.available_again_at),
            )
        )
    return responses


async def list_connections(db: AsyncSession, user: User) -> list[BankConnectionResponse]:
    """Return the user's bank connections, oldest first

    Args:
        db: Active database session
        user: The connections' owner

    Returns:
        Each connection with its bank accounts, pending discovery and request budget
    """
    connections = await db.scalars(
        select(BankConnection).where(BankConnection.owner_id == user.id).order_by(BankConnection.created_at, BankConnection.id)
    )
    return await build_connection_responses(db, user.id, connections.all())


async def get_own_connection(db: AsyncSession, user_id: uuid.UUID, connection_id: uuid.UUID) -> BankConnection:
    """Return one of the user's bank connections

    Raises:
        HTTPException 404: The connection doesn't exist or is another user's
    """
    connection = await db.scalar(select(BankConnection).where(BankConnection.id == connection_id, BankConnection.owner_id == user_id))
    if connection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=CONNECTION_NOT_FOUND)
    return connection


async def rename_connection(
    db: AsyncSession,
    user: User,
    connection_id: uuid.UUID,
    request: UpdateBankConnectionRequest,
) -> BankConnectionResponse:
    """Set or clear a connection's nickname, whatever state it is in

    Args:
        db: Active database session
        user: The connection's owner
        connection_id: The connection to rename
        request: The new nickname, where blank brings back the provider's name

    Returns:
        The renamed connection

    Raises:
        HTTPException 404: The connection doesn't exist or is another user's
        HTTPException 422: The nickname is longer than a connection can store
    """
    connection = await get_own_connection(db, user.id, connection_id)
    connection.nickname = read_nickname(request.nickname)
    await mark_user_cache_changed(db, user.id)
    await db.commit()
    return (await build_connection_responses(db, user.id, [connection]))[0]
