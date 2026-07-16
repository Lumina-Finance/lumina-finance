"""Transaction import tag lookup and creation"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tag import Tag
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


async def get_or_create_import_tags(
    db: AsyncSession,
    user_id: uuid.UUID,
    raw_names: list[str],
    tags_by_name: dict[str, Tag],
    stats: ImportStats,
) -> list[Tag]:
    """Return tag rows for one import row, creating personal tags when needed

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        raw_names: Raw tag names from an import row
        tags_by_name: Request-local tag lookup keyed by tag name
        stats: Import summary counters updated when tags are reused or created

    Returns:
        Ordered tag rows for the import row after dropping blanks and duplicates

    Raises:
        HTTPException: Raised with 422 when a tag name is too long
    """
    tags: list[Tag] = []
    seen_names: set[str] = set()

    # Deduplicate tags within one row while preserving first-seen order
    for raw_name in raw_names:
        name = raw_name.strip()
        if not name or name in seen_names:
            continue
        if len(name) > 64:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Tag name is too long: {name[:28]}")

        tag = await _get_or_create_import_tag(db, user_id, name, tags_by_name, stats)
        tags.append(tag)
        seen_names.add(name)
    return tags


async def _get_or_create_import_tag(
    db: AsyncSession,
    user_id: uuid.UUID,
    name: str,
    tags_by_name: dict[str, Tag],
    stats: ImportStats,
) -> Tag:
    """Return one existing tag by name or create a personal import tag

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        name: Trimmed tag name from an import row
        tags_by_name: Request-local tag lookup keyed by tag name
        stats: Import summary counters updated when a tag is reused or created

    Returns:
        Existing or newly created tag row for the import row
    """
    existing_tag = tags_by_name.get(name)
    if existing_tag is not None:
        stats.tags_reused += 1
        return existing_tag

    tag = Tag(owner_id=user_id, group_id=None, name=name)
    db.add(tag)
    await db.flush()
    tags_by_name[name] = tag
    stats.tags_created += 1
    stats.created_tag_ids.append(tag.id)
    return tag
