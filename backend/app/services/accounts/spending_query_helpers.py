"""Account spending query helpers"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.category import Category
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.schemas.account import AccountTopCategory, AccountTopMerchant

_TOP_SPENDING_ROWS_LIMIT = 5


async def get_account_grand_total_spend(db: AsyncSession, expense_predicate) -> int:
    """Return total account spend for an expense predicate

    Args:
        db: Active database session
        expense_predicate: SQLAlchemy predicate for expense transactions

    Returns:
        Positive total spending in minor units
    """
    total_spend_query = (
        select(func.coalesce(func.sum(Transaction.amount), 0))
        .join(Category, Transaction.category_id == Category.id)
        .where(expense_predicate)
    )

    # Sum all expense transactions in the period before ranking categories or merchants
    total_result = await db.execute(total_spend_query)
    total_spend = -int(total_result.scalar_one())
    return total_spend


async def get_account_top_categories(db: AsyncSession, expense_predicate) -> tuple[list[AccountTopCategory], int]:
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
    top_categories = [
        AccountTopCategory(category_id=row.id, name=row.name, total=-int(row.total))
        for row in category_rows[:_TOP_SPENDING_ROWS_LIMIT]
    ]
    return top_categories, hidden_count


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
    hidden_count = int(total_categories) - _TOP_SPENDING_ROWS_LIMIT
    return hidden_count


async def get_account_top_merchants(db: AsyncSession, expense_predicate) -> tuple[list[AccountTopMerchant], int]:
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
    top_merchants = [
        AccountTopMerchant(merchant_id=row.id, name=row.name, total=-int(row.total))
        for row in merchant_rows[:_TOP_SPENDING_ROWS_LIMIT]
    ]
    return top_merchants, hidden_count


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
    hidden_count = int(total_merchants) - _TOP_SPENDING_ROWS_LIMIT
    return hidden_count
