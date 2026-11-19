"""Transaction overview aggregate queries"""

import uuid
from datetime import date

import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
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
    today: date,
    account_id: uuid.UUID | None,
):
    """Build the shared transaction filters for overview queries

    Args:
        user_id: Identifier for the user requesting the overview
        from_date: Optional inclusive start date for the transaction window
        to_date: Optional inclusive end date for the transaction window
        today: Latest transaction date eligible for calculated amounts
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
    transaction_query = transaction_query.where(Transaction.dt <= min(to_date or today, today))
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
                    ((Category.kind == CategoryKind.TRANSFER) & (Category.name != _BALANCE_ADJUSTMENT_CATEGORY_NAME)),
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


def _outlier_candidate_query(transaction_filters):
    """Build the query for negative income or expense transactions that can be ranked as outliers

    Merchant names and notes are left out, since only the transactions the panel shows need them
    """
    return (
        select(
            Transaction.id,
            Transaction.account_id,
            Account.currency,
            Transaction.amount,
            Transaction.dt.label("date"),
        )
        .join(Account, Transaction.account_id == Account.id)
        .join(Category, Transaction.category_id == Category.id)
        .where(transaction_filters)
        .where(Category.kind.in_([CategoryKind.EXPENSE, CategoryKind.INCOME]))
        .where(Transaction.amount < 0)
    )


async def get_overview_outlier_candidate_rows(db: AsyncSession, transaction_filters, *, limit: int):
    """Return the candidate outlier transaction rows for an overview

    Every transaction of one account currency on one date converts at the same rate, so
    the largest converted outflows of that group are its largest amounts. Keeping the
    ``limit`` largest per group ranks the panel, apart from rows tying at its last place
    that the amounts left out can outrank by identifier, and bounds what a request reads
    by the days the range covers rather than by the transactions in it

    Args:
        db: Active database session
        transaction_filters: SQLAlchemy filters shared by overview queries
        limit: How many transactions the panel shows

    Returns:
        SQLAlchemy rows holding id, account, currency, amount and date, and each row's
        position and group size within its currency and date, largest outflow first
    """
    group = (Account.currency, Transaction.dt)

    # Number each currency and date group's rows by amount, with the identifier breaking
    # ties the way the panel's ranking does
    ranked = (
        _outlier_candidate_query(transaction_filters)
        .add_columns(
            sa.func.row_number().over(partition_by=group, order_by=(Transaction.amount.asc(), Transaction.id.asc())).label("position"),
            sa.func.count().over(partition_by=group).label("group_size"),
        )
        .subquery()
    )
    return (await db.execute(select(ranked).where(ranked.c.position <= limit))).all()


async def get_overview_outlier_tied_rows(
    db: AsyncSession,
    transaction_filters,
    *,
    currency: str,
    group_date: date,
    read_ids: list[uuid.UUID],
    last_amount: int,
    limit: int,
):
    """Return the left-out rows of one currency and date with the lowest identifiers, up to a largest amount

    Args:
        db: Active database session
        transaction_filters: SQLAlchemy filters shared by overview queries
        currency: Account currency of the group
        group_date: Transaction date of the group
        read_ids: Identifiers of the group's rows the candidate rows already hold
        last_amount: The largest amount to return, which is the last one converting to the outflow in question
        limit: How many rows the panel shows, which is the most that can take a place

    Returns:
        SQLAlchemy rows shaped like the candidate rows, without position and group size
    """
    # Rows at one converted outflow rank by identifier, so the lowest few are the only ones that can place
    return (
        await db.execute(
            _outlier_candidate_query(transaction_filters)
            .where(Account.currency == currency, Transaction.dt == group_date)
            .where(Transaction.id.not_in(read_ids), Transaction.amount <= last_amount)
            .order_by(Transaction.id.asc())
            .limit(limit),
        )
    ).all()


async def get_overview_outlier_details(db: AsyncSession, transaction_ids: list[uuid.UUID]):
    """Return the merchant name and notes of the transactions the outlier panel shows

    Args:
        db: Active database session
        transaction_ids: Identifiers of the ranked outlier transactions

    Returns:
        SQLAlchemy rows holding id, merchant name and notes
    """
    # Notes can run to thousands of characters, so only the ranked transactions load them
    return (
        await db.execute(
            select(Transaction.id, Merchant.name.label("merchant_name"), Transaction.notes)
            .outerjoin(Merchant, Transaction.merchant_id == Merchant.id)
            .where(Transaction.id.in_(transaction_ids)),
        )
    ).all()
