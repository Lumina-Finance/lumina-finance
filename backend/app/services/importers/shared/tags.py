"""Transaction import tag lookup and creation"""
import uuid
from collections.abc import Iterable

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tag import Tag
from app.schemas.transaction import MAX_IMPORT_TAG_NAME_LENGTH
from app.services.importers.shared.stats import ImportStats


async def get_personal_import_tags_by_name(db: AsyncSession, user_id: uuid.UUID) -> dict[str, Tag]:
    """Return personal tag rows keyed by tag name

    Args:
        db: Active database session
        user_id: Identifier for the user running the import

    Returns:
        Personal tag rows keyed by tag name
    """
    # Load existing personal tags once so repeated import rows can reuse them by name
    result = await db.execute(select(Tag).where(Tag.owner_id == user_id, Tag.group_id.is_(None)))
    return {tag.name: tag for tag in result.scalars().all()}


async def create_missing_import_tags(
    db: AsyncSession,
    user_id: uuid.UUID,
    raw_names: Iterable[str],
    tags_by_name: dict[str, Tag],
    stats: ImportStats,
) -> None:
    """Create the personal tags an import needs and does not already have

    Every tag the file introduces is written in one insert, so a file carrying many new tags costs
    one round trip rather than one for each

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        raw_names: Raw tag names from every row of the import, blanks and repeats included
        tags_by_name: Tag lookup for this import, extended with what is created
        stats: Import summary counters updated when tags are created

    Returns:
        None

    Raises:
        HTTPException: Raised with 422 when a tag name is too long
    """
    pending: dict[str, Tag] = {}

    for raw_name in raw_names:
        name = raw_name.strip()
        if not name:
            continue
        if len(name) > MAX_IMPORT_TAG_NAME_LENGTH:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Tag name is too long: {name[:28]}",
            )
        if name in tags_by_name or name in pending:
            continue

        pending[name] = Tag(owner_id=user_id, group_id=None, name=name)

    if not pending:
        return

    db.add_all(list(pending.values()))
    await db.flush()
    for name, tag in pending.items():
        tags_by_name[name] = tag
        stats.tags_created += 1
        stats.created_tag_ids.append(tag.id)


def get_import_row_tags(
    raw_names: list[str],
    tags_by_name: dict[str, Tag],
    stats: ImportStats,
) -> list[Tag]:
    """Return the tag rows one import row carries

    Args:
        raw_names: Raw tag names from the import row
        tags_by_name: Tag lookup for this import
        stats: Import summary counters updated when tags are used

    Returns:
        Ordered tag rows for the import row after dropping blanks and duplicates

    Raises:
        KeyError: Raised when a name was not put through create_missing_import_tags first
    """
    tags: list[Tag] = []
    seen_names: set[str] = set()

    # Deduplicate tags within one row while preserving first-seen order
    for raw_name in raw_names:
        name = raw_name.strip()
        if not name or name in seen_names:
            continue

        tag = tags_by_name[name]
        stats.reused_tag_ids.add(tag.id)
        tags.append(tag)
        seen_names.add(name)
    return tags
