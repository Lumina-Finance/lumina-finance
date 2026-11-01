"""Answering which tag names already have a tag"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tag import Tag
from app.services.importers.shared.name_keys import select_requested_names
from app.services.importers.shared.tags import get_import_tag_scope_filter


async def get_tags_matching_names(
    db: AsyncSession,
    user_id: uuid.UUID,
    names: list[str],
) -> list[tuple[str, Tag]]:
    """Return the tags an import would file each tag name under

    Matched by the rule the import itself matches by, and over the scope it matches in, so the page
    asking this and the commit that follows reach the same verdict

    Args:
        db: Active database session
        user_id: Authenticated user identifier
        names: Tag names from the file, already trimmed

    Returns:
        One pair per value that matched, holding the value as it was asked about and its tag
    """
    if not names:
        return []

    # One query for the whole file, with both sides lowercased by the database as the import does.
    # Only the user's own personal tags are in scope, and the unique index leaves at most one tag
    # holding a given name there
    requested = select_requested_names(names)
    result = await db.execute(
        select(requested.c.name, Tag)
        .join(Tag, func.lower(Tag.name) == func.lower(requested.c.name))
        .where(get_import_tag_scope_filter(user_id)),
    )

    tags_by_name = {name: tag for name, tag in result.all()}
    return [(name, tags_by_name[name]) for name in names if name in tags_by_name]
