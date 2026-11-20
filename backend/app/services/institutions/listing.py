"""Institution listing"""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.institution import Institution
from app.utils.sql_search_helpers import escape_like_search_text


async def list_institutions(
    db: AsyncSession,
    search_text: str | None,
    country_code: str | None,
    limit: int,
    offset: int,
) -> Sequence[Institution]:
    """Return one page of institutions, optionally narrowed by name or country

    Args:
        db: Active database session
        search_text: Optional text the name must contain, ignoring case
        country_code: Optional ISO 3166-1 alpha-2 filter
        limit: Maximum number of institutions to return
        offset: Number of institutions to skip before returning rows

    Returns:
        Institutions ordered by name, then identifier
    """
    query = select(Institution)
    if country_code:
        query = query.where(Institution.country_code == country_code)

    normalized_search_text = search_text.strip() if search_text else ""
    if normalized_search_text:
        escaped_search_text = escape_like_search_text(normalized_search_text)
        query = query.where(Institution.name.ilike(f"%{escaped_search_text}%", escape="\\"))

    # The same name can exist in two countries, and paging over a tie the database breaks
    # differently each time repeats or skips a row
    result = await db.execute(query.order_by(Institution.name, Institution.id).limit(limit).offset(offset))
    return result.scalars().all()
