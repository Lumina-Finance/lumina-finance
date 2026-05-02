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

from app.models.merchant import Merchant
from app.models.tag import Tag, TransactionTag
from app.models.transaction import Transaction
from app.schemas.transaction import TransactionResponse, TransactionTagSummary


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


async def get_tags_batch(
    db: AsyncSession, transaction_ids: list[uuid.UUID],
) -> dict[uuid.UUID, list[TransactionTagSummary]]:
    """Fetch tag summaries for multiple transactions in a single query."""
    if not transaction_ids:
        return {}

    result = await db.execute(
        select(
            TransactionTag.transaction_id,
            Tag.id,
            Tag.group_id,
            Tag.name,
        )
        .join(Tag, Tag.id == TransactionTag.tag_id)
        .where(TransactionTag.transaction_id.in_(transaction_ids))
        .order_by(Tag.name),
    )
    tag_map: dict[uuid.UUID, list[TransactionTagSummary]] = {tid: [] for tid in transaction_ids}
    for row in result.all():
        tag_map[row.transaction_id].append(
            TransactionTagSummary(id=row.id, group_id=row.group_id, name=row.name),
        )
    return tag_map


async def get_merchant_names_batch(
    db: AsyncSession, merchant_ids: list[uuid.UUID | None],
) -> dict[uuid.UUID, str]:
    """Fetch merchant names for a batch of optional merchant IDs."""
    ids = list({merchant_id for merchant_id in merchant_ids if merchant_id is not None})
    if not ids:
        return {}

    result = await db.execute(
        select(Merchant.id, Merchant.name).where(Merchant.id.in_(ids)),
    )
    return {row.id: row.name for row in result.all()}


def build_transaction_response(
    txn: Transaction,
    tag_ids: list[uuid.UUID],
    merchant_name: str | None = None,
    tags: list[TransactionTagSummary] | None = None,
) -> TransactionResponse:
    """Build a TransactionResponse from a Transaction model and its tag IDs."""
    data = TransactionResponse.model_validate(txn)
    data.tag_ids = tag_ids
    data.merchant_name = merchant_name
    data.tags = tags or []
    return data
