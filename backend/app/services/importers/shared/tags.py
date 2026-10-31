"""Transaction import tag lookup and creation"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field

from fastapi import HTTPException, status
from sqlalchemy import func, literal_column, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tag import Tag
from app.schemas.import_run import MAX_IMPORT_TAG_NAME_LENGTH
from app.services.importers.shared.insertion_helpers import insert_import_records_if_absent
from app.services.importers.shared.name_keys import load_import_name_keys
from app.services.importers.shared.stats import ImportStats


@dataclass
class ImportTags:
    """The personal tags an import may match, keyed by what matches them

    Attributes:
        existing_by_key: What tags there are, keyed by their own name with capitals folded. Extended
            by what this import writes and by what it finds another request has written
        keys_by_name: The key the database gave each name this import has met, tags' own names and
            the file's tag names alike, since every key is worked out by the database
    """

    existing_by_key: dict[str, Tag]
    keys_by_name: dict[str, str] = field(default_factory=dict)

    def get_key(self, name: str) -> str:
        """Return the key a trimmed name is matched under

        Args:
            name: A name this import has already loaded the key of

        Returns:
            The key

        Raises:
            KeyError: Raised when the name's key was never loaded
        """
        return self.keys_by_name[name]


async def load_import_tags(db: AsyncSession, user_id: uuid.UUID) -> ImportTags:
    """Return the personal tags an import may match, keyed by what matches them

    Args:
        db: Active database session
        user_id: Identifier for the user running the import

    Returns:
        The tags this import can match a tag name to
    """
    # Loaded once so matching a row costs no query. Capitals are folded by the database, as the
    # unique index is built on its lower(name), so two names it holds apart are never matched as one
    result = await db.execute(
        select(Tag, func.lower(Tag.name)).where(Tag.owner_id == user_id, Tag.group_id.is_(None)),
    )

    tags = ImportTags(existing_by_key={})
    for tag, key in result.all():
        tags.keys_by_name[tag.name] = key
        tags.existing_by_key[key] = tag
    return tags


async def create_missing_import_tags(
    db: AsyncSession,
    user_id: uuid.UUID,
    raw_names: Iterable[str],
    tags: ImportTags,
    stats: ImportStats,
) -> None:
    """Create the personal tags an import needs and does not already have

    A name matches an existing tag whatever its capitals, and two spellings of one name in the file
    make one tag between them, written under the first. Every tag the file introduces is written in
    one insert, so a file carrying many new tags costs one round trip rather than one for each

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        raw_names: Raw tag names from every row of the import, blanks and repeats included
        tags: Tag lookup for this import, extended with what is created
        stats: Import summary counters updated when tags are created

    Returns:
        None

    Raises:
        HTTPException: Raised with 422 when a tag name is too long, and with 500 when a name the
            insert skipped cannot then be found, which takes another request creating it and then
            rolling back
    """
    names = [name for name in (raw_name.strip() for raw_name in raw_names) if name]
    for name in set(names):
        if len(name) > MAX_IMPORT_TAG_NAME_LENGTH:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Tag name is too long: {name[:28]}",
            )

    tags.keys_by_name.update(await load_import_name_keys(db, set(names) - tags.keys_by_name.keys()))

    # Keyed by what matches the name, so the first spelling wins: "Travel" beside "travel" writes
    # Travel alone, and both resolve to it
    names_by_key: dict[str, str] = {}
    for name in names:
        key = tags.get_key(name)
        if key not in tags.existing_by_key:
            names_by_key.setdefault(key, name)

    if not names_by_key:
        return

    inserted = await insert_import_records_if_absent(
        db,
        Tag,
        [{"owner_id": user_id, "group_id": None, "name": name} for name in names_by_key.values()],
        index_elements=[Tag.owner_id, literal_column("lower(name)")],
        index_where=text("group_id IS NULL"),
    )

    for tag in inserted:
        tags.existing_by_key[tags.get_key(tag.name)] = tag
        stats.tags_created += 1
        stats.created_tag_ids.append(tag.id)

    # A name the insert skipped was taken between this import loading its tags and writing them, by
    # another import of the same file or by the user in another tab
    taken_keys = names_by_key.keys() - tags.existing_by_key.keys()
    if taken_keys:
        await _load_import_tags_created_elsewhere(db, user_id, taken_keys, tags)


async def _load_import_tags_created_elsewhere(
    db: AsyncSession,
    user_id: uuid.UUID,
    keys: set[str],
    tags: ImportTags,
) -> None:
    """Load the tags another request wrote while this import was running

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        keys: Matching keys the insert skipped because the name was already taken
        tags: Tag lookup for this import, extended with what is found

    Returns:
        None

    Raises:
        HTTPException: Raised with 500 when a name the insert skipped cannot then be found, which
            would leave the rows carrying it with no tag to file them under
    """
    result = await db.execute(
        select(Tag, func.lower(Tag.name)).where(
            Tag.owner_id == user_id,
            Tag.group_id.is_(None),
            func.lower(Tag.name).in_(keys),
        ),
    )
    for tag, key in result.all():
        tags.keys_by_name[tag.name] = key
        tags.existing_by_key.setdefault(key, tag)

    missing = keys - tags.existing_by_key.keys()
    if missing:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Tag could not be created or found: {sorted(missing)[0]}",
        )


def get_import_row_tags(
    raw_names: list[str],
    tags: ImportTags,
    stats: ImportStats,
) -> list[Tag]:
    """Return the tag rows one import row carries

    Args:
        raw_names: Raw tag names from the import row
        tags: Tag lookup for this import
        stats: Import summary counters updated when tags are used

    Returns:
        Ordered tag rows for the import row after dropping blanks and repeats, where two spellings
        of one name are a repeat

    Raises:
        KeyError: Raised when a name was not put through create_missing_import_tags first
    """
    row_tags: list[Tag] = []
    seen_ids: set[uuid.UUID] = set()

    # Deduplicate tags within one row while preserving first-seen order
    for raw_name in raw_names:
        name = raw_name.strip()
        if not name:
            continue

        tag = tags.existing_by_key[tags.get_key(name)]
        if tag.id in seen_ids:
            continue

        stats.reused_tag_ids.add(tag.id)
        row_tags.append(tag)
        seen_ids.add(tag.id)
    return row_tags
