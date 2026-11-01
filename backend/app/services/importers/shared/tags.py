"""Transaction import tag lookup and creation"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field

from fastapi import HTTPException, status
from sqlalchemy import func, literal_column, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tag import Tag
from app.schemas.import_run import MAX_IMPORT_TAG_NAME_LENGTH, TransactionImportTagMapping
from app.services.importers.shared.insertion_helpers import insert_import_records_if_absent
from app.services.importers.shared.name_keys import load_import_name_keys
from app.services.importers.shared.stats import ImportStats
from app.services.importers.shared.validation_helpers import strip_import_text_or_raise


@dataclass
class ImportTags:
    """The personal tags an import may match, keyed by what matches them

    Attributes:
        existing_by_key: What tags there are, keyed by their own name with capitals folded. Extended
            by what this import writes and by what it finds another request has written
        resolved_by_key: The tag each answered tag name files its rows under, keyed by the name's own
            key. Holds what the user pointed a name at and what a corrected name was created as
        skipped_keys: The keys of the tag names the user answered skip, whose rows carry no such tag
        keys_by_name: The key the database gave each name this import has met, tags' own names and
            the file's tag names alike, since every key is worked out by the database
    """

    existing_by_key: dict[str, Tag]
    resolved_by_key: dict[str, Tag] = field(default_factory=dict)
    skipped_keys: set[str] = field(default_factory=set)
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


def get_import_tag_scope_filter(user_id: uuid.UUID):
    """Return the SQL filter for the tags an import may file rows under

    Only the user's own personal tags, since a group's tag is never matched by name

    Args:
        user_id: Identifier for the user running the import

    Returns:
        SQLAlchemy filter matching the tags an import may use
    """
    return (Tag.owner_id == user_id) & Tag.group_id.is_(None)


async def load_usable_import_tags(
    db: AsyncSession,
    tag_ids: set[uuid.UUID],
    user_id: uuid.UUID,
) -> dict[uuid.UUID, Tag]:
    """Read selected tag references under the personal import scope

    Args:
        db: Active caller-scoped database session
        tag_ids: Unique references declared by this request
        user_id: Authenticated importer

    Returns:
        Eligible tags by ID, with absent or inaccessible references omitted
    """
    if not tag_ids:
        return {}

    result = await db.execute(select(Tag).where(Tag.id.in_(tag_ids), get_import_tag_scope_filter(user_id)))
    return {tag.id: tag for tag in result.scalars().all()}


async def require_usable_import_tag(
    db: AsyncSession,
    tag_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    tags_by_id: dict[uuid.UUID, Tag] | None = None,
) -> Tag:
    """Return a tag an import may file rows under, refusing any other

    Args:
        db: Active database session
        tag_id: Tag an answer points at
        user_id: Identifier for the user running the import
        tags_by_id: Optional complete caller-eligible reference lookup for this request

    Returns:
        The tag

    Raises:
        HTTPException: Raised with 422 when the tag is not one this import may use, which covers
            another user's and a group's, so answering a value cannot reach further than matching one
    """
    if tags_by_id is None:
        tags_by_id = await load_usable_import_tags(db, {tag_id}, user_id)
    tag = tags_by_id.get(tag_id)
    if tag is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Tag not found")
    return tag


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
    result = await db.execute(select(Tag, func.lower(Tag.name)).where(get_import_tag_scope_filter(user_id)))

    tags = ImportTags(existing_by_key={})
    for tag, key in result.all():
        tags.keys_by_name[tag.name] = key
        tags.existing_by_key[key] = tag
    return tags


async def create_missing_import_tags(
    db: AsyncSession,
    user_id: uuid.UUID,
    raw_names: Iterable[str],
    mappings: list[TransactionImportTagMapping],
    tags: ImportTags,
    stats: ImportStats,
) -> None:
    """Settle what every tag name in a file resolves to, creating the tags it needs

    A value the user answered is taken as answered: pointed at a tag they chose, created under a name
    they wrote, or dropped from its rows. Every other value matches an existing tag whatever its
    capitals and creates one where nothing matches, and two spellings of one name make one tag
    between them, written under the first. Whatever the file introduces is written in one insert, so
    a file carrying many new tags costs one round trip rather than one for each

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        raw_names: Raw tag names from every row of the import, blanks and repeats included
        mappings: The tag names the user answered by hand, which may be none of them
        tags: Tag lookup for this import, extended with what is chosen and created
        stats: Import summary counters updated when tags are created

    Returns:
        None

    Raises:
        HTTPException: Raised with 422 when a tag name left unanswered is too long, when an answer states no single
            action, when one tag name is answered twice, and when an answer points at a tag the
            import cannot use. Raised with 500 when a name the insert skipped cannot then be found,
            which takes another request creating it and then rolling back
    """
    names = [name for name in (raw_name.strip() for raw_name in raw_names) if name]

    # Every key comes from one query, so none is worked out in Python
    wanted = {*names}
    for mapping in mappings:
        wanted.add(mapping.source.strip())
        if mapping.create is not None:
            wanted.add(mapping.create.name)
    tags.keys_by_name.update(await load_import_name_keys(db, wanted - tags.keys_by_name.keys()))

    answers = _index_import_tag_answers(mappings, tags)
    tags.skipped_keys.update(key for key, answer in answers.items() if answer.skip)
    await _attach_chosen_import_tags(db, user_id, answers, tags)

    # Keyed by the name a tag will be stored under rather than by the name as the file states it,
    # since two names corrected to one make one tag between them
    names_by_key: dict[str, str] = {}
    stored_key_by_key: dict[str, str] = {}

    for name in names:
        key = tags.get_key(name)
        if key in stored_key_by_key or key in tags.resolved_by_key:
            continue

        answer = answers.get(key)
        if answer is None:
            # Only a name stored as it is written has to fit. One the user corrected or skipped may
            # be longer, as a cell can be
            _require_import_tag_name_fits(name)
            stored_name = name
        elif answer.create is None:
            # Answered skip or pointed at a tag, both already settled above
            continue
        else:
            stored_name = answer.create.name

        # A name already held is reused rather than written again
        stored_key = tags.get_key(stored_name)
        existing = tags.existing_by_key.get(stored_key)
        if existing is not None:
            if answer is not None:
                tags.resolved_by_key[key] = existing
            continue

        # The first spelling wins, so "Travel" beside "travel" writes Travel alone
        names_by_key.setdefault(stored_key, stored_name)
        if answer is not None:
            stored_key_by_key[key] = stored_key

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

    for key, stored_key in stored_key_by_key.items():
        tags.resolved_by_key[key] = tags.existing_by_key[stored_key]


def _require_import_tag_name_fits(name: str) -> None:
    """Refuse a tag name longer than the column stores

    Args:
        name: Tag name from a row

    Raises:
        HTTPException: Raised with 422 when the name is too long
    """
    if len(name) > MAX_IMPORT_TAG_NAME_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Tag name is too long: {name[:28]}",
        )


def _index_import_tag_answers(
    mappings: list[TransactionImportTagMapping],
    tags: ImportTags,
) -> dict[str, TransactionImportTagMapping]:
    """Return the answered tag names keyed by what matches them

    Args:
        mappings: The tag names the user answered by hand
        tags: Tag lookup for this import, holding the key of every answered value

    Returns:
        Each answer keyed by its matching key

    Raises:
        HTTPException: Raised with 422 when an answer states no single action, and when two answers
            are given for names that match as one tag, which a staged run cannot carry but a request
            built by hand can
    """
    answers: dict[str, TransactionImportTagMapping] = {}

    for mapping in mappings:
        source = strip_import_text_or_raise(mapping.source, "Tag source")
        stated_actions = (mapping.tag_id is not None) + (mapping.create is not None) + mapping.skip
        if stated_actions != 1:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"The tag source {source} must map to exactly one tag action",
            )

        key = tags.get_key(source)
        if key in answers:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"The tag source {source} is answered twice",
            )
        answers[key] = mapping

    return answers


async def _attach_chosen_import_tags(
    db: AsyncSession,
    user_id: uuid.UUID,
    answers: dict[str, TransactionImportTagMapping],
    tags: ImportTags,
) -> None:
    """Point the tag names answered with an existing tag at it

    Args:
        db: Active database session
        user_id: Identifier for the user running the import
        answers: The answered tag names keyed by what matches them
        tags: Tag lookup for this import, extended with what was chosen

    Returns:
        None

    Raises:
        HTTPException: Raised with 422 when an answer points at a tag this import cannot use
    """
    chosen = [(key, answer.tag_id) for key, answer in answers.items() if answer.tag_id is not None]
    if not chosen:
        return

    tags_by_id = await load_usable_import_tags(db, {tag_id for _, tag_id in chosen}, user_id)
    for key, tag_id in chosen:
        tag = tags_by_id.get(tag_id)
        if tag is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Tag not found")
        tags.resolved_by_key[key] = tag


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
            get_import_tag_scope_filter(user_id),
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
        Ordered tag rows for the import row after dropping blanks, repeats and skipped names, where
        two spellings of one name are a repeat

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

        key = tags.get_key(name)
        if key in tags.skipped_keys:
            continue

        tag = tags.resolved_by_key.get(key) or tags.existing_by_key[key]
        if tag.id in seen_ids:
            continue

        stats.reused_tag_ids.add(tag.id)
        row_tags.append(tag)
        seen_ids.add(tag.id)
    return row_tags
