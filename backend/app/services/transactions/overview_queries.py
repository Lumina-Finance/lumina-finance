"""Transaction overview aggregate queries"""

import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.merchant import Merchant
from app.models.transaction import Transaction

_BALANCE_ADJUSTMENT_CATEGORY_NAME = "Balance Adjustment"


async def get_overview_cash_flow_rows(db: AsyncSession, transaction_filters):
    """Return per-day inflow and outflow aggregate rows for an overview

    The query groups eligible income, expense, and real transfer activity by
    transaction date and account so later conversion can use each account's
    persisted currency

    Args:
        db: Active database session
        transaction_filters: SQLAlchemy filters shared by overview queries

    Returns:
        SQLAlchemy rows containing date, account, inflow, and outflow values
    """
    # Aggregate cash-flow totals by date and account for transactions in the overview scope
    return (
        await db.execute(
            select(
                Transaction.dt.label("date"),
                Transaction.account_id,
                sa.func.coalesce(sa.func.sum(sa.case((Transaction.amount > 0, Transaction.amount))), 0).label("inflow"),
                sa.func.coalesce(sa.func.sum(sa.case((Transaction.amount < 0, Transaction.amount))), 0).label("outflow"),
            )
            .join(Category, Transaction.category_id == Category.id)
            .where(transaction_filters)
            # Real transfers affect cash flow, but synthetic balance adjustments should not
            .where(
                sa.or_(
                    Category.kind.in_([CategoryKind.EXPENSE, CategoryKind.INCOME]),
                    (
                        (Category.kind == CategoryKind.TRANSFER)
                        & (Category.name != _BALANCE_ADJUSTMENT_CATEGORY_NAME)
                    ),
                ),
            )
            .group_by(Transaction.dt, Transaction.account_id),
        )
    ).all()


async def get_overview_category_total_rows(db: AsyncSession, transaction_filters):
    """Return per-category transaction total rows for an overview

    The query preserves account and date on each aggregate row so totals can be
    converted accurately before being merged into top category results

    Args:
        db: Active database session
        transaction_filters: SQLAlchemy filters shared by overview queries

    Returns:
        SQLAlchemy rows containing category, account, date, and total values
    """
    # Aggregate income and expense totals by category, account, and date for conversion
    return (
        await db.execute(
            select(
                Transaction.category_id,
                Category.name.label("category_name"),
                Transaction.account_id,
                Transaction.dt.label("date"),
                sa.func.sum(Transaction.amount).label("total"),
            )
            .join(Category, Transaction.category_id == Category.id)
            .where(transaction_filters)
            .where(Category.kind.in_([CategoryKind.EXPENSE, CategoryKind.INCOME]))
            .group_by(Transaction.category_id, Category.name, Transaction.account_id, Transaction.dt),
        )
    ).all()


async def get_overview_outlier_candidate_rows(db: AsyncSession, transaction_filters):
    """Return candidate outlier transaction rows for an overview

    The query loads negative income or expense transactions with merchant data
    so the conversion layer can rank the largest converted spending rows

    Args:
        db: Active database session
        transaction_filters: SQLAlchemy filters shared by overview queries

    Returns:
        SQLAlchemy rows for expense-side transactions eligible for outlier ranking
    """
    # Fetch negative income or expense transactions that can be ranked as outliers
    return (
        await db.execute(
            select(
                Transaction.id,
                Transaction.account_id,
                Merchant.name.label("merchant_name"),
                Transaction.notes,
                Transaction.amount,
                Transaction.dt.label("date"),
                Transaction.category_id,
            )
            .outerjoin(Merchant, Transaction.merchant_id == Merchant.id)
            .join(Category, Transaction.category_id == Category.id)
            .where(transaction_filters)
            .where(Category.kind.in_([CategoryKind.EXPENSE, CategoryKind.INCOME]))
            .where(Transaction.amount < 0)
            .order_by(Transaction.amount.asc()),
        )
    ).all()
