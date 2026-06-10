"""Activity lookup helpers for savings-rate trend insights"""

import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.utils.dates import get_month_start_date


async def get_first_activity_month(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    window_end: date,
) -> date | None:
    """Return the first month with income or expense activity before a window end

    Args:
        db: Active database session
        account_ids: Account IDs included in the savings-rate trend
        window_end: Exclusive activity lookup end date

    Returns:
        First activity month, or None when there is no matching activity
    """
    # Find the earliest income or expense transaction before the trend window end
    result = await db.execute(
        select(func.min(Transaction.dt))
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt < window_end,
        ),
    )
    first_activity = result.scalar_one_or_none()
    first_activity_month = get_month_start_date(first_activity) if first_activity else None
    return first_activity_month
