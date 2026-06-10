"""Account spending analytics service"""
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.schemas.account import AccountSpendingBreakdown
from app.schemas.dashboard import RangeKind
from app.services.accounts.spending_query_helpers import (
    get_account_grand_total_spend,
    get_account_top_categories,
    get_account_top_merchants,
)


async def get_account_spending_breakdown(
    db: AsyncSession,
    account_id: uuid.UUID,
    range_: RangeKind,
    now: datetime,
) -> AccountSpendingBreakdown:
    """Return top category and merchant spend for an account over a range

    Args:
        db: Active database session
        account_id: Account receiving the spending breakdown
        range_: Calendar period used for spending totals
        now: Viewer-local timestamp used to derive current-period bounds

    Returns:
        Spending breakdown with top categories, top merchants, and totals
    """
    start, end = _get_current_period_date_bounds(range_, now.date())
    expense_predicate = _build_expense_transaction_predicate(account_id, start, end)
    grand_total_spend = await get_account_grand_total_spend(db, expense_predicate)

    if grand_total_spend == 0:
        empty_breakdown = AccountSpendingBreakdown(
            range=range_,
            top_categories=[],
            top_merchants=[],
            grand_total_spend=0,
            other_categories_count=0,
            other_merchants_count=0,
        )
        return empty_breakdown

    top_categories, other_categories_count = await get_account_top_categories(db, expense_predicate)
    top_merchants, other_merchants_count = await get_account_top_merchants(db, expense_predicate)
    breakdown = AccountSpendingBreakdown(
        range=range_,
        top_categories=top_categories,
        top_merchants=top_merchants,
        grand_total_spend=grand_total_spend,
        other_categories_count=other_categories_count,
        other_merchants_count=other_merchants_count,
    )
    return breakdown


def _get_current_period_date_bounds(range_: RangeKind, today: date) -> tuple[date, date]:
    """Return current-period date bounds for an account range

    Args:
        range_: Calendar period requested by the account analytics endpoint
        today: Viewer-local current date

    Returns:
        Inclusive start and end dates for the current period
    """
    if range_ == "WTD":
        start = today - timedelta(days=today.weekday())
        end = today
        return start, end
    if range_ == "MTD":
        start = date(today.year, today.month, 1)
        end = today
        return start, end
    if range_ == "QTD":
        quarter_month = ((today.month - 1) // 3) * 3 + 1
        start = date(today.year, quarter_month, 1)
        end = today
        return start, end

    start = date(today.year, 1, 1)
    end = today
    return start, end


def _build_expense_transaction_predicate(account_id: uuid.UUID, start: date, end: date):
    """Build the predicate for expense transactions inside a date range

    Args:
        account_id: Account receiving the spending breakdown
        start: Inclusive start date
        end: Inclusive end date

    Returns:
        SQLAlchemy predicate for account expense transactions
    """
    predicate = (
        (Transaction.account_id == account_id)
        & (Transaction.dt >= start)
        & (Transaction.dt <= end)
        & (Category.kind == CategoryKind.EXPENSE)
    )
    return predicate
