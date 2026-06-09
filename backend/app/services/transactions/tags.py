"""Transaction tag-link persistence services"""
import uuid

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tag import TransactionTag


async def replace_transaction_tag_links(
    db: AsyncSession,
    transaction_id: uuid.UUID,
    tag_ids: list[uuid.UUID],
) -> None:
    """Replace the tag links attached to a transaction

    Existing links are removed first so the final persisted set exactly
    matches the validated request payload. New links are inserted in the
    caller-provided order

    Args:
        db: Active database session
        transaction_id: Transaction whose tag links should be replaced
        tag_ids: Tag identifiers to attach after clearing existing links

    Returns:
        None
    """
    # Remove current tag links before inserting the validated replacement set
    await db.execute(
        delete(TransactionTag).where(TransactionTag.transaction_id == transaction_id),
    )
    for tag_id in tag_ids:
        db.add(TransactionTag(transaction_id=transaction_id, tag_id=tag_id))


async def delete_transaction_tag_links(db: AsyncSession, transaction_id: uuid.UUID) -> None:
    """Delete every tag link attached to a transaction

    The transaction delete flow calls this before deleting the transaction row
    so the junction table is cleaned explicitly within the same transaction

    Args:
        db: Active database session
        transaction_id: Transaction whose tag links should be removed

    Returns:
        None
    """
    # Remove junction rows before the transaction itself is deleted
    await db.execute(
        delete(TransactionTag).where(TransactionTag.transaction_id == transaction_id),
    )
