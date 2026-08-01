"""Merchant listing helpers"""

import uuid
from collections.abc import Sequence
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.routes.merchants.access_helpers import require_group_member
from app.routes.merchants.scope_filter_helpers import get_merchant_list_scope_filter
from app.services.categories.transfer_rules import BALANCE_ADJUSTMENT_CATEGORY_NAME
from app.utils.sql_search_helpers import escape_like_search_text

# Recent-usage window that ranks the merchant dropdown so the merchants a user
# transacts with most often surface first, a window shorter than the user's
# history simply ranks by every transaction they have
MERCHANT_FREQUENCY_WINDOW_DAYS = 90


async def get_merchants_for_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    group_id: uuid.UUID | None,
    search_text: str | None,
    limit: int | None,
    offset: int,
) -> Sequence[Merchant]:
    """Return merchants visible in the requested scope ranked by recent usage

    Args:
        db: Active database session
        user_id: Authenticated user identifier
        group_id: Optional group scope to include with personal merchants
        search_text: Optional name search text
        limit: Optional maximum number of merchants to return
        offset: Number of merchants to skip before returning rows

    Returns:
        Merchants ordered by recent transaction count then name

    Raises:
        HTTPException: User is not a member of the requested group
    """
    recent_usage_cutoff = date.today() - timedelta(days=MERCHANT_FREQUENCY_WINDOW_DAYS)
    recent_usage_count = func.count(Transaction.id)

    # Balance adjustments are written by the app rather than the user, and they carry the shared
    # Myself merchant, so counting them would let opening a few accounts push that merchant to the
    # top of a ranking meant to reflect who the user actually transacts with
    balance_adjustment_category_ids = select(Category.id).where(
        Category.is_system.is_(True),
        Category.name == BALANCE_ADJUSTMENT_CATEGORY_NAME,
    )

    # Count each merchant's transactions inside the recency window, the date lives
    # in the join condition so merchants with no recent activity are kept and ranked last
    merchant_query = (
        select(Merchant)
        .outerjoin(
            Transaction,
            (Transaction.merchant_id == Merchant.id)
            & (Transaction.dt >= recent_usage_cutoff)
            & Transaction.category_id.notin_(balance_adjustment_category_ids),
        )
        .where(get_merchant_list_scope_filter(user_id, group_id))
        .group_by(Merchant.id)
    )

    if group_id is not None:
        await require_group_member(db, group_id, user_id)

    normalized_search_text = search_text.strip() if search_text else ""
    if normalized_search_text:
        escaped_search_text = escape_like_search_text(normalized_search_text)
        merchant_query = merchant_query.where(Merchant.name.ilike(f"%{escaped_search_text}%", escape="\\"))

    # Rank by recent usage and fall back to name so untouched merchants stay alphabetical
    merchant_query = merchant_query.order_by(recent_usage_count.desc(), Merchant.name)
    if limit is not None:
        merchant_query = merchant_query.limit(limit).offset(offset)

    # Fetch visible merchants for the requested scope, search text, and pagination
    result = await db.execute(merchant_query)
    merchants = result.scalars().all()
    return merchants
