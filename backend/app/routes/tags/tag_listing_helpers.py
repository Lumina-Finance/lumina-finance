"""Tag listing helpers"""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tag import Tag
from app.routes.tags.access_helpers import (
    require_group_member,
)
from app.routes.tags.tag_scope_filter_helpers import get_tag_list_scope_filter
from app.utils.sql_search_helpers import escape_like_search_text


async def get_tags_for_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    group_id: uuid.UUID | None,
    search_text: str | None,
    limit: int | None,
    offset: int,
) -> Sequence[Tag]:
    """Return tags visible in the requested scope

    Args:
        db: Active database session
        user_id: Authenticated user identifier
        group_id: Optional group scope to include with personal tags
        search_text: Optional name search text
        limit: Optional maximum number of tags to return
        offset: Number of tags to skip before returning rows

    Returns:
        Tags ordered by name

    Raises:
        HTTPException: User is not a member of the requested group
    """
    tag_query = select(Tag).where(get_tag_list_scope_filter(user_id, group_id))

    if group_id is not None:
        await require_group_member(db, group_id, user_id)

    normalized_search_text = search_text.strip() if search_text else ""
    if normalized_search_text:
        escaped_search_text = escape_like_search_text(normalized_search_text)
        tag_query = tag_query.where(Tag.name.ilike(f"%{escaped_search_text}%", escape="\\"))

    tag_query = tag_query.order_by(Tag.name)
    if limit is not None:
        tag_query = tag_query.limit(limit).offset(offset)

    # Fetch visible tags for the requested scope, search text, and pagination
    result = await db.execute(tag_query)
    tags = result.scalars().all()
    return tags
