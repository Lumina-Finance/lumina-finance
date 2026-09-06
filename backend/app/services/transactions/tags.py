"""Transaction tag assignment services"""
import uuid

from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tag import TransactionTag


async def replace_transaction_tag_assignments(
    db: AsyncSession,
    transaction_id: uuid.UUID,
    tag_ids: list[uuid.UUID],
) -> None:
    """Replace the tags attached to a transaction

    Existing tag assignments are removed first so the final stored set exactly
    matches the validated request payload. New assignments are inserted in the
    caller-provided order

    Args:
        db: Active database session
        transaction_id: Transaction whose tag assignments should be replaced
        tag_ids: Tag identifiers to attach after clearing existing assignments

    Returns:
        None
    """
    # Remove current tag assignments before inserting the validated replacement set
    await db.execute(
        delete(TransactionTag).where(TransactionTag.transaction_id == transaction_id),
    )
    for tag_id in tag_ids:
        db.add(TransactionTag(transaction_id=transaction_id, tag_id=tag_id))


async def add_transaction_tag_assignments(
    db: AsyncSession,
    transaction_ids: list[uuid.UUID],
    tag_ids: list[uuid.UUID],
) -> None:
    """Attach tags to several transactions without disturbing the tags they already carry

    One statement per tag keeps the bind parameter count proportional to the transaction count
    rather than to the product of the two, which a single combined insert would reach

    Args:
        db: Active database session
        transaction_ids: Transactions to attach the tags to
        tag_ids: Validated tag identifiers to attach

    Returns:
        None
    """
    for tag_id in tag_ids:
        # A transaction already carrying the tag is left as it is, which the composite primary key
        # is what makes detectable
        await db.execute(
            postgres_insert(TransactionTag)
            .values([{"transaction_id": transaction_id, "tag_id": tag_id} for transaction_id in transaction_ids])
            .on_conflict_do_nothing(),
        )


async def delete_transaction_tag_assignments(db: AsyncSession, transaction_id: uuid.UUID) -> None:
    """Delete every tag assignment attached to a transaction

    The transaction delete flow calls this before deleting the transaction row
    so the junction table is cleaned explicitly within the same transaction

    Args:
        db: Active database session
        transaction_id: Transaction whose tag assignments should be removed

    Returns:
        None
    """
    # Remove junction rows before the transaction itself is deleted
    await db.execute(
        delete(TransactionTag).where(TransactionTag.transaction_id == transaction_id),
    )
