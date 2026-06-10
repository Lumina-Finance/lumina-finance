"""Merchant listing helpers"""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.merchant import Merchant
from app.routes.merchants.access_helpers import require_group_member
from app.routes.merchants.merchant_scope_filter_helpers import get_merchant_list_scope_filter
from app.utils.sql_search_helpers import escape_like_search_text


async def get_merchants_for_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    group_id: uuid.UUID | None,
    search_text: str | None,
    limit: int | None,
    offset: int,
) -> Sequence[Merchant]:
    """Return merchants visible in the requested scope

    Args:
        db: Active database session
        user_id: Authenticated user identifier
        group_id: Optional group scope to include with personal merchants
        search_text: Optional name search text
        limit: Optional maximum number of merchants to return
        offset: Number of merchants to skip before returning rows

    Returns:
        Merchants ordered by name

    Raises:
        HTTPException: User is not a member of the requested group
    """
    merchant_query = select(Merchant).where(get_merchant_list_scope_filter(user_id, group_id))

    if group_id is not None:
        await require_group_member(db, group_id, user_id)

    normalized_search_text = search_text.strip() if search_text else ""
    if normalized_search_text:
        escaped_search_text = escape_like_search_text(normalized_search_text)
        merchant_query = merchant_query.where(Merchant.name.ilike(f"%{escaped_search_text}%", escape="\\"))

    merchant_query = merchant_query.order_by(Merchant.name)
    if limit is not None:
        merchant_query = merchant_query.limit(limit).offset(offset)

    # Fetch visible merchants for the requested scope, search text, and pagination
    result = await db.execute(merchant_query)
    merchants = result.scalars().all()
    return merchants
