"""Shared response-building helpers for transaction routes and aggregations.

Mirrors ``services/budget_responses.py``: pure builders and batched loaders
that assemble a :class:`TransactionResponse` from a ``Transaction`` row plus
its associated tag IDs. Both the transaction route and the dashboard
aggregation call these, so keeping them in a service module avoids a layer
inversion (a service importing from a route) and makes the "how do we shape
a transaction response" surface easy to find.
"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tag import TransactionTag
from app.models.transaction import Transaction
from app.schemas.transaction import TransactionResponse


async def get_tag_ids(db: AsyncSession, transaction_id: uuid.UUID) -> list[uuid.UUID]:
    """Fetch tag IDs for a single transaction."""
    result = await db.execute(
        select(TransactionTag.tag_id).where(TransactionTag.transaction_id == transaction_id),
    )
    return list(result.scalars().all())


async def get_tag_ids_batch(
    db: AsyncSession, transaction_ids: list[uuid.UUID],
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Fetch tag IDs for multiple transactions in a single query."""
    if not transaction_ids:
        return {}
    result = await db.execute(
        select(TransactionTag).where(TransactionTag.transaction_id.in_(transaction_ids)),
    )
    tag_map: dict[uuid.UUID, list[uuid.UUID]] = {tid: [] for tid in transaction_ids}
    for row in result.scalars().all():
        tag_map[row.transaction_id].append(row.tag_id)
    return tag_map


def build_transaction_response(
    txn: Transaction, tag_ids: list[uuid.UUID],
) -> TransactionResponse:
    """Build a TransactionResponse from a Transaction model and its tag IDs."""
    data = TransactionResponse.model_validate(txn)
    data.tag_ids = tag_ids
    return data
