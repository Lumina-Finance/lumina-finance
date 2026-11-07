"""Listing and renaming a user's bank connections

A connection is described by its provider, nickname and server host, never its credential. Each
bank account it lists says which account it is linked to or which accounts could take it, through
the one bank-linking eligibility check, and whether its link through the connection waits on a bank
sign-in. The connection also names its links waiting for their bank account to be chosen again
"""

import uuid
from collections import defaultdict
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_connection import BankAccountLink, BankConnection, BankExternalAccount, BankLinkState
from app.models.bank_sync_job import BankSyncJob, BankSyncJobStatus
from app.models.user import User
from app.schemas.bank_sync import (
    BankConnectionResponse,
    BankRequestBudgetResponse,
    ChooseAgainLinkResponse,
    ConnectionBankAccountResponse,
    UpdateBankConnectionRequest,
)
from app.services.bank_sync.action_needed import ActionNeededKind, read_actions_needed
from app.services.bank_sync.availability import (
    LIVE_LINK,
    adapter_for,
    find_unavailability,
    get_institution_allowance,
    list_link_candidates,
    provider_label,
    provider_site_label,
    read_linked_bank_accounts,
)
from app.services.bank_sync.provider_requests import read_request_budgets
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
        Each connection with its listed bank accounts, its links waiting for a bank account to be
        chosen again, whether a discovery is pending and its request budget
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

    # A bank account reached through two connections shows a sign-in only on the one its link goes
    # through, since the sign-in is for the bank login behind that connection
    signin_needed: set[tuple[uuid.UUID, str]] = set()
    choose_again: dict[uuid.UUID, list[ChooseAgainLinkResponse]] = defaultdict(list)
    links = (
        await db.execute(
            select(
                BankAccountLink.connection_id,
                BankAccountLink.account_id,
                BankAccountLink.external_account_id,
                BankAccountLink.external_account_name,
                BankAccountLink.state,
            )
            .where(BankAccountLink.connection_id.in_(connection_ids), LIVE_LINK)
            .order_by(BankAccountLink.external_account_name, BankAccountLink.account_id)
        )
    ).all()
    needed = await read_actions_needed(db, [link.account_id for link in links])
    for link in links:
        action = needed.get(link.account_id)
        if action is not None and action.kind is ActionNeededKind.BANK_LOGIN:
            signin_needed.add((link.connection_id, link.external_account_id))
        if link.state == BankLinkState.CHOOSE_ACCOUNT:
            choose_again[link.connection_id].append(
                ChooseAgainLinkResponse(account_id=link.account_id, external_account_name=link.external_account_name)
            )

    budgets = await read_request_budgets(db, connections, now=now)
    candidates = await list_link_candidates(db, user_id)
    providers = {connection.provider for connection in connections}
    allowances = {provider: await get_institution_allowance(db, user_id, provider) for provider in providers}

    responses = []
    for connection in connections:
        provider_name = provider_label(connection.provider, connection.provider_name)

        # A provider no longer installed can't link, so none of its bank accounts offers an account
        available = adapter_for(connection.provider) is not None
        accounts = []
        for bank_account in bank_accounts[connection.id]:
            link = linked_to.get((connection.provider, bank_account.external_id))
            eligible = [
                account.id
                for account in candidates
                if available
                and find_unavailability(
                    bank_account,
                    account,
                    linked_to=link[1] if link else None,
                    allowance=allowances[connection.provider],
                    provider_name=provider_name,
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
                    signin_needed=(connection.id, bank_account.external_id) in signin_needed,
                )
            )
        budget = budgets[connection.id]
        responses.append(
            BankConnectionResponse(
                id=connection.id,
                provider=connection.provider,
                provider_name=provider_name,
                provider_site=provider_site_label(connection.provider),
                provider_available=available,
                nickname=connection.nickname,
                server_label=connection.server_host,
                created_at=connection.created_at,
                status="credential_rejected" if connection.credential_rejected_at is not None else "active",
                accounts=accounts,
                choose_again_links=choose_again[connection.id],
                discovery_pending=connection.id in discovering,
                request_budget=BankRequestBudgetResponse(
                    limit=budget.limit,
                    used=budget.used,
                    available_again_at=budget.available_again_at,
                    held_by_provider=budget.held_by_provider,
                ),
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


async def get_own_connection(
    db: AsyncSession,
    user_id: uuid.UUID,
    connection_id: uuid.UUID,
    *,
    lock: Mapping[str, bool] | None = None,
) -> BankConnection:
    """Return one of the user's bank connections, locked until the caller commits when given lock flags

    The flags are with_for_update's, so {} locks the row for update. A request that waited for a
    disconnect then finds the connection gone, as any later request would

    Raises:
        HTTPException 404: The connection doesn't exist or is another user's
    """
    statement = select(BankConnection).where(BankConnection.id == connection_id, BankConnection.owner_id == user_id)
    if lock is not None:
        statement = statement.with_for_update(**lock).execution_options(populate_existing=True)
    connection = await db.scalar(statement)
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
