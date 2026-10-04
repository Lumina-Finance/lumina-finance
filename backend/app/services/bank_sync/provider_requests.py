"""The record of requests sent to bank data providers, for the rolling request budget"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_connection import BankProviderRequest, ProviderRequestPurpose

# How far back the request budget counts. A record older than this can never count again
REQUEST_BUDGET_WINDOW = timedelta(hours=24)


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
