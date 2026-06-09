"""Account spending analytics service"""
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.schemas.account import (
    AccountSpendingBreakdown,
    AccountTopCategory,
    AccountTopMerchant,
)
from app.schemas.dashboard import RangeKind

_TOP_SPENDING_ROWS_LIMIT = 5


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
    grand_total_spend = await _query_grand_total_spend(db, expense_predicate)

    if grand_total_spend == 0:
        return AccountSpendingBreakdown(
            range=range_,
            top_categories=[],
            top_merchants=[],
            grand_total_spend=0,
            other_categories_count=0,
            other_merchants_count=0,
        )

    top_categories, other_categories_count = await _query_top_categories(db, expense_predicate)
    top_merchants, other_merchants_count = await _query_top_merchants(db, expense_predicate)
    return AccountSpendingBreakdown(
        range=range_,
        top_categories=top_categories,
        top_merchants=top_merchants,
        grand_total_spend=grand_total_spend,
        other_categories_count=other_categories_count,
        other_merchants_count=other_merchants_count,
    )


def _get_current_period_date_bounds(range_: RangeKind, today: date) -> tuple[date, date]:
    """Return current-period date bounds for an account range

    Args:
        range_: Calendar period requested by the account analytics endpoint
        today: Viewer-local current date

    Returns:
        Inclusive start and end dates for the current period
    """
    if range_ == "WTD":
        return today - timedelta(days=today.weekday()), today
    if range_ == "MTD":
        return date(today.year, today.month, 1), today
    if range_ == "QTD":
        quarter_month = ((today.month - 1) // 3) * 3 + 1
        return date(today.year, quarter_month, 1), today
    return date(today.year, 1, 1), today


def _build_expense_transaction_predicate(account_id: uuid.UUID, start: date, end: date):
    """Build the predicate for expense transactions inside a date range

    Args:
        account_id: Account receiving the spending breakdown
        start: Inclusive start date
        end: Inclusive end date

    Returns:
        SQLAlchemy predicate for account expense transactions
    """
    return (
        (Transaction.account_id == account_id)
        & (Transaction.dt >= start)
        & (Transaction.dt <= end)
        & (Category.kind == CategoryKind.EXPENSE)
    )


async def _query_grand_total_spend(db: AsyncSession, expense_predicate) -> int:
    """Return total account spend for an expense predicate

    Args:
        db: Active database session
        expense_predicate: SQLAlchemy predicate for expense transactions

    Returns:
        Positive total spending in minor units
    """
    # Sum all expense transactions in the period before ranking categories or merchants
    total_result = await db.execute(
        select(func.coalesce(func.sum(Transaction.amount), 0))
        .join(Category, Transaction.category_id == Category.id)
        .where(expense_predicate),
    )
    return -int(total_result.scalar_one())


async def _query_top_categories(db: AsyncSession, expense_predicate) -> tuple[list[AccountTopCategory], int]:
    """Return top spending categories and hidden category count

    Args:
        db: Active database session
        expense_predicate: SQLAlchemy predicate for expense transactions

    Returns:
        Top category rows and count of hidden nonzero categories
    """
    category_total = func.sum(Transaction.amount)
    # Fetch the largest spending categories plus one extra row to detect hidden results
    category_result = await db.execute(
        select(
            Category.id,
            Category.name,
            category_total.label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(expense_predicate)
        .group_by(Category.id, Category.name)
        .having(category_total != 0)
        .order_by(category_total.asc())
        .limit(_TOP_SPENDING_ROWS_LIMIT + 1),
    )
    category_rows = category_result.all()
    hidden_count = await _count_hidden_categories(db, expense_predicate, category_rows)
    return [
        AccountTopCategory(category_id=row.id, name=row.name, total=-int(row.total))
        for row in category_rows[:_TOP_SPENDING_ROWS_LIMIT]
    ], hidden_count


async def _count_hidden_categories(db: AsyncSession, expense_predicate, category_rows) -> int:
    """Return count of nonzero categories beyond the visible limit

    Args:
        db: Active database session
        expense_predicate: SQLAlchemy predicate for expense transactions
        category_rows: Limited category result rows

    Returns:
        Count of nonzero categories hidden behind the visible limit
    """
    if len(category_rows) <= _TOP_SPENDING_ROWS_LIMIT:
        return 0

    nonzero_categories = (
        select(Transaction.category_id)
        .join(Category, Transaction.category_id == Category.id)
        .where(expense_predicate)
        .group_by(Transaction.category_id)
        .having(func.sum(Transaction.amount) != 0)
        .subquery()
    )
    # Count all nonzero categories so the response can report how many are hidden
    total_categories = (await db.execute(
        select(func.count()).select_from(nonzero_categories),
    )).scalar_one()
    return int(total_categories) - _TOP_SPENDING_ROWS_LIMIT


async def _query_top_merchants(db: AsyncSession, expense_predicate) -> tuple[list[AccountTopMerchant], int]:
    """Return top spending merchants and hidden merchant count

    Args:
        db: Active database session
        expense_predicate: SQLAlchemy predicate for expense transactions

    Returns:
        Top merchant rows and count of hidden nonzero merchants
    """
    merchant_total = func.sum(Transaction.amount)
    # Fetch the largest spending merchants plus one extra row to detect hidden results
    merchant_result = await db.execute(
        select(
            Merchant.id,
            Merchant.name,
            merchant_total.label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .join(Merchant, Transaction.merchant_id == Merchant.id)
        .where(expense_predicate)
        .group_by(Merchant.id, Merchant.name)
        .having(merchant_total != 0)
        .order_by(merchant_total.asc())
        .limit(_TOP_SPENDING_ROWS_LIMIT + 1),
    )
    merchant_rows = merchant_result.all()
    hidden_count = await _count_hidden_merchants(db, expense_predicate, merchant_rows)
    return [
        AccountTopMerchant(merchant_id=row.id, name=row.name, total=-int(row.total))
        for row in merchant_rows[:_TOP_SPENDING_ROWS_LIMIT]
    ], hidden_count


async def _count_hidden_merchants(db: AsyncSession, expense_predicate, merchant_rows) -> int:
    """Return count of nonzero merchants beyond the visible limit

    Args:
        db: Active database session
        expense_predicate: SQLAlchemy predicate for expense transactions
        merchant_rows: Limited merchant result rows

    Returns:
        Count of nonzero merchants hidden behind the visible limit
    """
    if len(merchant_rows) <= _TOP_SPENDING_ROWS_LIMIT:
        return 0

    nonzero_merchants = (
        select(Transaction.merchant_id)
        .join(Category, Transaction.category_id == Category.id)
        .where(expense_predicate, Transaction.merchant_id.is_not(None))
        .group_by(Transaction.merchant_id)
        .having(func.sum(Transaction.amount) != 0)
        .subquery()
    )
    # Count all nonzero merchants so the response can report how many are hidden
    total_merchants = (await db.execute(
        select(func.count()).select_from(nonzero_merchants),
    )).scalar_one()
    return int(total_merchants) - _TOP_SPENDING_ROWS_LIMIT
