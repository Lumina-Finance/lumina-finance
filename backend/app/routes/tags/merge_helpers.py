"""Tag merge route helpers"""
import uuid

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.tag import Tag, TransactionTag
from app.routes.tags.access_helpers import get_personal_tag_filter


async def get_merge_replacement_tag(
    db: AsyncSession,
    source_tag: Tag,
    replacement_tag_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Tag:
    """Return the valid replacement tag for a merge

    Args:
        db: Active database session
        source_tag: Tag being merged away
        replacement_tag_id: Requested replacement tag identifier
        user_id: Authenticated user identifier

    Returns:
        Replacement tag for the merge

    Raises:
        HTTPException: Replacement tag is invalid or missing
    """
    if source_tag.id == replacement_tag_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Replacement tag must be different",
        )

    replacement_filter = Tag.id == replacement_tag_id
    if source_tag.group_id is None:
        replacement_filter = replacement_filter & get_personal_tag_filter(user_id)
    else:
        replacement_filter = replacement_filter & (Tag.group_id == source_tag.group_id)

    # Fetch a replacement tag from the same scope as the tag being merged
    replacement_result = await db.execute(select(Tag).where(replacement_filter))
    replacement = replacement_result.scalar_one_or_none()
    if not replacement:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Replacement tag not found",
        )
    return replacement


async def move_tag_references(
    db: AsyncSession,
    source_tag_id: uuid.UUID,
    replacement_tag_id: uuid.UUID,
) -> None:
    """Move transaction references from a source tag to a replacement

    Args:
        db: Active database session
        source_tag_id: Tag being merged away
        replacement_tag_id: Tag receiving transaction references
    """
    replacement_transaction_tag = aliased(TransactionTag)

    # Delete duplicate transaction-tag rows before moving source references to the replacement
    await db.execute(
        sa.delete(TransactionTag).where(
            TransactionTag.tag_id == source_tag_id,
            sa.exists().where(
                replacement_transaction_tag.transaction_id == TransactionTag.transaction_id,
                replacement_transaction_tag.tag_id == replacement_tag_id,
            ),
        ),
    )

    # Move source transaction-tag rows to the replacement tag
    await db.execute(
        sa.update(TransactionTag)
        .where(TransactionTag.tag_id == source_tag_id)
        .values(tag_id=replacement_tag_id),
    )
