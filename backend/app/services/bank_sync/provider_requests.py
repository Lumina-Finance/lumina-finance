"""The record of requests sent to bank data providers, and the rolling request budget it counts

A provider may disable a credential that keeps going over its daily limit, which would put every
account on the connection into Reconnect needed. So every request is counted before it is sent,
in a transaction committed on its own, against the daily budget the provider's adapter sets, and a
provider saying its quota is spent marks the budget spent rather than letting the rest go out
"""

import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_connection import BankConnection, BankProviderRequest, ProviderRequestPurpose
from app.models.bank_sync_job import ProviderErrorKind
from app.services.bank_sync.availability import adapter_for
from app.services.bank_sync.providers.contract import FetchResult

# How far back the request budget counts. A record older than this can never count again
REQUEST_BUDGET_WINDOW = timedelta(hours=24)


@dataclass(frozen=True)
class RequestBudget:
    """A connection's requests over the last 24 hours, for the settings meter, the status and Sync now"""

    # None for a connection whose provider is no longer installed, which sends nothing
    limit: int | None
    used: int

    # When the next request can be sent once the budget is spent, or None while one is free
    available_again_at: datetime | None

    # Whether the provider's word that its quota is spent, rather than the connection's own count,
    # holds the next request back, which is so only when fewer than the limit were sent
    held_by_provider: bool = False


class RequestBudgetSpent(Exception):
    """The connection has no request left in the last 24 hours"""

    def __init__(self, available_again_at: datetime) -> None:
        """Say when the next request frees up"""
        super().__init__(f"The request budget is spent until {available_again_at.isoformat()}")
        self.available_again_at = available_again_at


def summarize_request_budget(
    counted: Sequence[datetime],
    *,
    limit: int,
    spent_until: datetime | None,
    now: datetime,
) -> RequestBudget:
    """Return a connection's budget from the requests it counts and any spent mark

    Args:
        counted: When each request still inside the 24 hours was sent, oldest first
        limit: Requests the connection may send in 24 hours
        spent_until: Until when the provider's word that its quota is spent holds, if it said so
        now: The current time

    Returns:
        The limit, the count used and, once spent, when the next request frees up and whether the
        provider's word rather than the count holds it back
    """
    used = len(counted)
    available_again_at = None
    held_by_provider = False

    # Enough of the oldest requests have to leave the 24 hours to bring the count below the
    # limit, which is more than one when the limit was lowered after they were sent
    if used >= limit:
        available_again_at = counted[used - limit] + REQUEST_BUDGET_WINDOW

    # The provider's word lasts until the oldest request counted leaves the 24 hours, which a full
    # count frees no earlier than, so it holds the next request back only below the limit
    if spent_until is not None and spent_until > now:
        held_by_provider = available_again_at is None
        used = max(used, limit)
        available_again_at = max(available_again_at or spent_until, spent_until)
    return RequestBudget(limit=limit, used=used, available_again_at=available_again_at, held_by_provider=held_by_provider)


async def read_request_budget(db: AsyncSession, connection: BankConnection, *, now: datetime) -> RequestBudget:
    """Return a connection's request budget at a moment

    Args:
        db: Active database session
        connection: The connection, as last read
        now: The current time

    Returns:
        The limit, the count used and, once spent, when the next request frees up
    """
    return (await read_request_budgets(db, [connection], now=now))[connection.id]


async def read_request_budgets(db: AsyncSession, connections: Collection[BankConnection], *, now: datetime) -> dict[uuid.UUID, RequestBudget]:
    """Return each connection's request budget at a moment, read together

    Args:
        db: Active database session
        connections: The connections, as last read
        now: The current time

    Returns:
        Each connection's limit, count used and, once spent, when its next request frees up, by connection id
    """
    counted: dict[uuid.UUID, list[datetime]] = {connection.id: [] for connection in connections}
    rows = await db.execute(
        select(BankProviderRequest.connection_id, BankProviderRequest.requested_at)
        .where(BankProviderRequest.connection_id.in_(counted), BankProviderRequest.requested_at > now - REQUEST_BUDGET_WINDOW)
        .order_by(BankProviderRequest.requested_at)
    )
    for connection_id, requested_at in rows:
        counted[connection_id].append(requested_at)
    budgets = {}
    for connection in connections:
        adapter = adapter_for(connection.provider)

        # A provider no longer installed is sent nothing, so its connection uses none and has no limit
        if adapter is None:
            budgets[connection.id] = RequestBudget(limit=None, used=0, available_again_at=None)
            continue
        budgets[connection.id] = summarize_request_budget(
            counted[connection.id],
            limit=adapter.daily_request_budget,
            spent_until=connection.request_budget_spent_until,
            now=now,
        )
    return budgets


async def record_provider_request(
    db: AsyncSession,
    *,
    owner_id: uuid.UUID,
    connection_id: uuid.UUID,
    purpose: ProviderRequestPurpose,
    now: datetime,
) -> None:
    """Record one request to a provider, pruning the connection's records the budget no longer counts

    The caller commits before sending the request, so a request whose sender dies after
    sending it is still counted

    Args:
        db: Session the record is written in
        owner_id: The connection's owner
        connection_id: The connection the request is sent for
        purpose: Why the request is sent
        now: When the request is sent
    """
    await db.execute(
        delete(BankProviderRequest).where(
            BankProviderRequest.connection_id == connection_id,
            BankProviderRequest.requested_at <= now - REQUEST_BUDGET_WINDOW,
        )
    )
    db.add(BankProviderRequest(owner_id=owner_id, connection_id=connection_id, purpose=purpose, requested_at=now))
    await db.flush()


async def reserve_provider_request(
    db: AsyncSession,
    connection: BankConnection,
    *,
    purpose: ProviderRequestPurpose,
    now: datetime,
) -> None:
    """Count one request against a connection's budget before it is sent, or refuse when none is left

    The connection's row is locked first, so two senders can't both take the last request. The
    caller commits straight afterwards, before sending, so the count outlives a sender that dies

    Args:
        db: Session the record is written in
        connection: The connection the request is sent for
        purpose: Why the request is sent
        now: When the request is sent

    Raises:
        RequestBudgetSpent: The connection has sent its limit in the last 24 hours, or the
            provider said its quota is spent, carrying when the next request frees up
    """
    locked = await db.scalar(
        select(BankConnection).where(BankConnection.id == connection.id).with_for_update().execution_options(populate_existing=True)
    )
    budget = await read_request_budget(db, locked, now=now)
    if budget.available_again_at is not None:
        raise RequestBudgetSpent(budget.available_again_at)
    await record_provider_request(db, owner_id=locked.owner_id, connection_id=locked.id, purpose=purpose, now=now)


def is_quota_spent(result: FetchResult) -> bool:
    """Return whether a provider's answer says its request quota is spent, whether or not data came with it"""
    return any(error is not None and error.kind == ProviderErrorKind.RATE_LIMITED for error in (result.request_error, *result.warnings))


async def mark_request_budget_spent(db: AsyncSession, connection: BankConnection, *, now: datetime) -> None:
    """Count a connection's budget as spent until the oldest request it counts leaves the 24 hours

    Called when the provider answers 429 or warns about its quota, so nothing more is sent until
    a request frees up, rather than the rest of the budget earning more warnings

    Args:
        db: Active database session
        connection: The connection the provider answered for
        now: When the answer arrived
    """
    oldest = await db.scalar(
        select(func.min(BankProviderRequest.requested_at)).where(
            BankProviderRequest.connection_id == connection.id,
            BankProviderRequest.requested_at > now - REQUEST_BUDGET_WINDOW,
        )
    )

    # The request answered was counted before it was sent, so one is normally there
    connection.request_budget_spent_until = (oldest or now) + REQUEST_BUDGET_WINDOW
    await db.flush()
