"""Shared response-building helpers for transaction routes and aggregations

Mirrors ``services/budget_responses.py``: pure builders and batched loaders
that assemble a :class:`TransactionResponse` from a ``Transaction`` row plus
its associated tag IDs. Both the transaction route and the dashboard
aggregation call these, so keeping them in a service module avoids a layer
inversion (a service importing from a route) and makes the "how do we shape
a transaction response" surface easy to find
"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.merchant import Merchant
from app.models.tag import Tag, TransactionTag
from app.models.transaction import Transaction
from app.schemas.transaction import TransactionResponse, TransactionTagSummary


async def get_tag_ids(db: AsyncSession, transaction_id: uuid.UUID) -> list[uuid.UUID]:
    """Return tag identifiers attached to one transaction

    Args:
        db: Active database session
        transaction_id: Transaction identifier whose tag identifiers should be loaded

    Returns:
        Tag identifiers attached to the transaction
    """
    # Fetch tag identifiers for one transaction when a route returns a single response
    result = await db.execute(
        select(TransactionTag.tag_id).where(TransactionTag.transaction_id == transaction_id),
    )
    return list(result.scalars().all())


async def get_tag_ids_batch(
    db: AsyncSession, transaction_ids: list[uuid.UUID],
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Return tag identifiers grouped by transaction

    Args:
        db: Active database session
        transaction_ids: Transaction identifiers whose tag identifiers should be loaded

    Returns:
        Tag identifiers keyed by transaction identifier
    """
    if not transaction_ids:
        return {}

    # Fetch tag identifiers for a transaction page in one query to avoid per-row lookups
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
    """Return tag summaries grouped by transaction

    Args:
        db: Active database session
        transaction_ids: Transaction identifiers whose tag summaries should be loaded

    Returns:
        Tag summaries keyed by transaction identifier
    """
    if not transaction_ids:
        return {}

    # Fetch tag display data for a transaction page in one query to avoid per-row lookups
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
    """Return merchant names keyed by merchant identifier

    Args:
        db: Active database session
        merchant_ids: Merchant identifiers collected from transaction rows

    Returns:
        Merchant names keyed by merchant identifier
    """
    ids = list({merchant_id for merchant_id in merchant_ids if merchant_id is not None})
    if not ids:
        return {}

    # Fetch merchant display names for every non-null merchant referenced by the response rows
    result = await db.execute(
        select(Merchant.id, Merchant.name).where(Merchant.id.in_(ids)),
    )
    return {row.id: row.name for row in result.all()}


def build_transaction_response(
    txn: Transaction,
    tag_ids: list[uuid.UUID],
    merchant_name: str | None = None,
    tags: list[TransactionTagSummary] | None = None,
    account_amount: int | None = None,
    base_currency_amount: int | None = None,
) -> TransactionResponse:
    """Build a transaction response from a transaction row and related data

    Args:
        txn: Transaction row being serialized
        tag_ids: Tag identifiers attached to the transaction
        merchant_name: Optional merchant display name
        tags: Optional tag summaries attached to the transaction
        account_amount: Optional amount converted into the account currency
        base_currency_amount: Optional amount converted into the user's base currency

    Returns:
        Transaction response containing the transaction row plus related display data
    """
    data = TransactionResponse.model_validate(txn)
    data.account_amount = account_amount
    data.base_currency_amount = base_currency_amount
    data.tag_ids = tag_ids
    data.merchant_name = merchant_name
    data.tags = tags or []
    return data


async def get_transaction_response(db: AsyncSession, txn: Transaction) -> TransactionResponse:
    """Return one transaction response with related display data

    This helper loads tag identifiers, tag summaries, and the optional merchant
    name needed by single-transaction routes before delegating to the pure
    response builder

    Args:
        db: Active database session
        txn: Transaction row being returned by the route

    Returns:
        Transaction response enriched with tag and merchant display data
    """
    tag_ids = await get_tag_ids(db, txn.id)
    tag_summary_map = await get_tags_batch(db, [txn.id])
    merchant_names = await get_merchant_names_batch(db, [txn.merchant_id])
    return build_transaction_response(
        txn,
        tag_ids,
        merchant_names.get(txn.merchant_id) if txn.merchant_id else None,
        tag_summary_map[txn.id],
    )
