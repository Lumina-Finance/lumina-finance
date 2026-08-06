"""Merchant listing helpers"""

import uuid
from collections.abc import Sequence
from datetime import date, timedelta

from sqlalchemy import Date, Integer, Numeric, cast, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.routes.merchants.access_helpers import require_group_member
from app.routes.merchants.scope_filter_helpers import get_merchant_list_scope_filter
from app.services.categories.transfer_rules import BALANCE_ADJUSTMENT_CATEGORY_NAME
from app.utils.sql_search_helpers import escape_like_search_text

# How long a transaction takes to count for half of what it counted the day it was recorded. The
# score fades smoothly instead of stopping at the 90-day window it replaces, so a merchant used
# often a while ago still outranks one used a single time today
MERCHANT_USAGE_HALF_LIFE_DAYS = 90

# Transactions older than this are left out of the score. The oldest one still counted, dated at
# exactly this age, is worth 0.36% of a transaction recorded today, so around 280 of them would be
# needed to outweigh a single recent one, which is far beyond anything a real history holds
MERCHANT_USAGE_CUTOFF_DAYS = 730

# The score is rounded before it orders anything, because adding floating-point numbers is not
# associative and the database does not promise to sum a merchant's rows in any fixed order. Two
# merchants used identically would otherwise differ by a rounding step, never reach the name
# tiebreaker, and swap places between requests, which pages a merchant twice or not at all
MERCHANT_USAGE_SCORE_DECIMAL_PLACES = 6


async def get_merchants_for_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    group_id: uuid.UUID | None,
    search_text: str | None,
    limit: int | None,
    offset: int,
    today: date,
) -> Sequence[Merchant]:
    """Return merchants visible in the requested scope ranked by decayed usage

    Args:
        db: Active database session
        user_id: Authenticated user identifier
        group_id: Optional group scope to include with personal merchants
        search_text: Optional name search text
        limit: Optional maximum number of merchants to return
        offset: Number of merchants to skip before returning rows
        today: Current date in the requesting user's timezone, used to age each transaction

    Returns:
        Merchants ordered by decayed usage score, then name, then identifier

    Raises:
        HTTPException: User is not a member of the requested group
    """
    usage_cutoff = today - timedelta(days=MERCHANT_USAGE_CUTOFF_DAYS)

    # Subtracting one date from another gives whole days in Postgres, and SQLAlchemy casts the
    # divisor so the division keeps its fraction instead of truncating to whole half-lives
    transaction_age_days = cast(literal(today, Date) - Transaction.dt, Integer)
    usage_weight = func.power(0.5, transaction_age_days / float(MERCHANT_USAGE_HALF_LIFE_DAYS))

    # Summing no rows gives null, which Postgres sorts ahead of every number under DESC, so a
    # merchant nobody has used would lead the list without this
    decayed_usage_score = func.round(
        cast(func.coalesce(func.sum(usage_weight), 0.0), Numeric),
        MERCHANT_USAGE_SCORE_DECIMAL_PLACES,
    )

    # Balance adjustments are written by the app rather than the user, and they carry the shared
    # Myself merchant, so counting them would let opening a few accounts push that merchant to the
    # top of a ranking meant to reflect who the user actually transacts with
    balance_adjustment_category_ids = select(Category.id).where(
        Category.is_system.is_(True),
        Category.name == BALANCE_ADJUSTMENT_CATEGORY_NAME,
    )

    # Score each merchant's transactions, the date bound living in the join condition so merchants
    # with nothing to count are kept and ranked last. Bounding both ends in one comparison drops
    # transactions past the cutoff and transactions dated ahead of the user's today, which would
    # otherwise weigh more than one recorded now
    merchant_query = (
        select(Merchant)
        .outerjoin(
            Transaction,
            (Transaction.merchant_id == Merchant.id)
            & Transaction.dt.between(usage_cutoff, today)
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

    # Rank by decayed usage and fall back to name so untouched merchants stay alphabetical. The
    # identifier settles what name cannot: a personal merchant and a group merchant may share one,
    # and paging over a tie the database breaks differently each time repeats or skips a row
    merchant_query = merchant_query.order_by(decayed_usage_score.desc(), Merchant.name, Merchant.id)
    if limit is not None:
        merchant_query = merchant_query.limit(limit).offset(offset)

    # Fetch visible merchants for the requested scope, search text, and pagination
    result = await db.execute(merchant_query)
    merchants = result.scalars().all()
    return merchants
