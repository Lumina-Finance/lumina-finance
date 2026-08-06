"""Transaction overview aggregate queries"""

import uuid
from datetime import date

import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import CategoryKind
from app.models.category import Category
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.services.transactions.access_helpers import accessible_account_ids_subquery

_BALANCE_ADJUSTMENT_CATEGORY_NAME = "Balance Adjustment"


def build_overview_transaction_filters(
    user_id: uuid.UUID,
    *,
    from_date: date | None,
    to_date: date | None,
    account_id: uuid.UUID | None,
):
    """Build the shared transaction filters for overview queries

    Args:
        user_id: Identifier for the user requesting the overview
        from_date: Optional inclusive start date for the transaction window
        to_date: Optional inclusive end date for the transaction window
        account_id: Optional account filter applied within the user's accessible accounts

    Returns:
        SQLAlchemy filters shared by all overview aggregate queries
    """
    accessible_account_ids_query = accessible_account_ids_subquery(user_id)
    transaction_query = select(Transaction).where(Transaction.account_id.in_(accessible_account_ids_query))
    if account_id is not None:
        transaction_query = transaction_query.where(Transaction.account_id == account_id)
    if from_date is not None:
        transaction_query = transaction_query.where(Transaction.dt >= from_date)
    if to_date is not None:
        transaction_query = transaction_query.where(Transaction.dt <= to_date)
    return transaction_query.whereclause


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
    # Aggregate expense totals by category, account, and date for conversion
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

            # Spending is what an expense category nets once its refunds are taken off, so an
            # income category stays out even when a reversal leaves it negative for the period
            .where(Category.kind == CategoryKind.EXPENSE)
            .group_by(Transaction.category_id, Category.name, Transaction.account_id, Transaction.dt),
        )
    ).all()


async def get_overview_outlier_candidate_rows(db: AsyncSession, transaction_filters):
    """Return candidate outlier transaction rows for an overview

    The query loads negative income or expense transactions with merchant data
    so the conversion layer can rank the largest converted outflows

    Args:
        db: Active database session
        transaction_filters: SQLAlchemy filters shared by overview queries

    Returns:
        SQLAlchemy rows for transactions eligible for outlier ranking
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
            )
            .outerjoin(Merchant, Transaction.merchant_id == Merchant.id)
            .join(Category, Transaction.category_id == Category.id)
            .where(transaction_filters)
            .where(Category.kind.in_([CategoryKind.EXPENSE, CategoryKind.INCOME]))
            .where(Transaction.amount < 0)
            .order_by(Transaction.amount.asc()),
        )
    ).all()
