"""Account analytics helpers."""
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import case, func, select
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
from app.schemas.dashboard import MonthlyIncomeExpense, RangeKind

_TOP_N = 5


def _range_bounds(range_: RangeKind, today: date) -> tuple[date, date]:
    """Return ``(start, today)`` bounds for the calendar ``range_``.

    WTD starts Monday, MTD on the first of the month, QTD on the first of the
    current quarter, YTD on January 1. Matches the period starts used by the
    dashboard's spending widgets so both views agree when the same account is
    in both scopes.
    """
    if range_ == "WTD":
        return today - timedelta(days=today.weekday()), today
    if range_ == "MTD":
        return date(today.year, today.month, 1), today
    if range_ == "QTD":
        q_month = ((today.month - 1) // 3) * 3 + 1
        return date(today.year, q_month, 1), today
    # YTD
    return date(today.year, 1, 1), today


async def get_account_spending_breakdown(
    db: AsyncSession,
    account_id: uuid.UUID,
    range_: RangeKind,
    now: datetime,
) -> AccountSpendingBreakdown:
    """Return top-5 category and merchant spend for ``account_id`` over ``range_``.

    Filters to ``Category.kind == EXPENSE`` so transfers and income are dropped
    from both breakdowns. Merchants additionally require an inner join, which
    naturally excludes transactions without a merchant. Totals are returned as
    positive minor units; the grand total sums every expense in the range and
    anchors the proportional fills on the frontend.
    """
    start, end = _range_bounds(range_, now.date())

    base_where = (
        (Transaction.account_id == account_id)
        & (Transaction.dt >= start)
        & (Transaction.dt <= end)
    )
    expense_where = base_where & (Category.kind == CategoryKind.EXPENSE)

    # Grand total — sum of all expense transactions in the range. Stored negative
    # in the DB, so we flip the sign before returning.
    grand_total_row = await db.execute(
        select(func.coalesce(func.sum(Transaction.amount), 0))
        .join(Category, Transaction.category_id == Category.id)
        .where(expense_where),
    )
    grand_total_spend = -int(grand_total_row.scalar_one())

    if grand_total_spend == 0:
        return AccountSpendingBreakdown(
            range=range_,
            top_categories=[],
            top_merchants=[],
            grand_total_spend=0,
            other_categories_count=0,
            other_merchants_count=0,
        )

    # Categories — group by category, sort by largest spend (most negative sum).
    # Pull TOP_N + 1 to cheaply detect whether an "Other" bucket exists without
    # a second COUNT query.
    cat_result = await db.execute(
        select(
            Category.id,
            Category.name,
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(expense_where)
        .group_by(Category.id, Category.name)
        .order_by(func.sum(Transaction.amount).asc())
        .limit(_TOP_N + 1),
    )
    cat_rows = cat_result.all()

    # Distinct-category count — needed when more than TOP_N exist to compute the
    # "Other (N)" tally. Skipped otherwise.
    other_categories_count = 0
    if len(cat_rows) > _TOP_N:
        total_categories = (await db.execute(
            select(func.count(func.distinct(Transaction.category_id)))
            .join(Category, Transaction.category_id == Category.id)
            .where(expense_where),
        )).scalar_one()
        other_categories_count = int(total_categories) - _TOP_N

    top_categories = [
        AccountTopCategory(category_id=row.id, name=row.name, total=-int(row.total))
        for row in cat_rows[:_TOP_N]
    ]

    # Merchants — inner join drops merchant-less transactions (e.g. transfers,
    # which are already excluded by the expense filter but also commonly have
    # no merchant anyway).
    merchant_result = await db.execute(
        select(
            Merchant.id,
            Merchant.name,
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .join(Merchant, Transaction.merchant_id == Merchant.id)
        .where(expense_where)
        .group_by(Merchant.id, Merchant.name)
        .order_by(func.sum(Transaction.amount).asc())
        .limit(_TOP_N + 1),
    )
    merchant_rows = merchant_result.all()

    other_merchants_count = 0
    if len(merchant_rows) > _TOP_N:
        total_merchants = (await db.execute(
            select(func.count(func.distinct(Transaction.merchant_id)))
            .join(Category, Transaction.category_id == Category.id)
            .where(expense_where, Transaction.merchant_id.is_not(None)),
        )).scalar_one()
        other_merchants_count = int(total_merchants) - _TOP_N

    top_merchants = [
        AccountTopMerchant(merchant_id=row.id, name=row.name, total=-int(row.total))
        for row in merchant_rows[:_TOP_N]
    ]

    return AccountSpendingBreakdown(
        range=range_,
        top_categories=top_categories,
        top_merchants=top_merchants,
        grand_total_spend=grand_total_spend,
        other_categories_count=other_categories_count,
        other_merchants_count=other_merchants_count,
    )


def _first_of_month(year: int, month: int) -> date:
    return date(year, month, 1)


def _month_sequence_ending_at(now: datetime, months: int) -> list[date]:
    """Return a list of first-of-month dates spanning the last ``months`` months.

    Ordered oldest-first; the last entry is the first of ``now``'s (in-progress)
    month. Used to anchor per-month charts so months with no activity still
    appear as zero-valued slots.
    """
    year, month = now.year, now.month
    # Walk back months-1 steps to find the first month in the window.
    for _ in range(months - 1):
        if month == 1:
            year -= 1
            month = 12
        else:
            month -= 1
    result: list[date] = []
    for _ in range(months):
        result.append(_first_of_month(year, month))
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1
    return result


async def get_account_cash_flow_history(
    db: AsyncSession,
    account_id: uuid.UUID,
    months: int,
    now: datetime,
) -> list[MonthlyIncomeExpense]:
    """Return per-month cash-in / cash-out totals for a single account.

    Bucketed by transaction SIGN, not by category kind: positive amounts add
    to ``income`` and negative amounts add to ``expenses``. That makes the
    series match the account's actual balance movement — transfers count,
    refunds count — which is the per-account view the detail page wants.
    (The household-level savings-rate widget keeps the kind-based split
    since cross-account transfers net to zero at that scope.)

    Covers ``months`` calendar months ending with the current (in-progress)
    month, ordered oldest-first. Months without activity emit zeros so the
    chart always has the full x-axis.
    """
    month_starts = _month_sequence_ending_at(now, months)
    window_start = month_starts[0]
    # Exclusive upper bound = first of the month after ``now``'s.
    end_year, end_month = now.year, now.month
    if end_month == 12:
        window_end = date(end_year + 1, 1, 1)
    else:
        window_end = date(end_year, end_month + 1, 1)

    month_start_expr = func.date_trunc("month", Transaction.dt).label("month_start")
    result = await db.execute(
        select(
            month_start_expr,
            func.coalesce(
                func.sum(case((Transaction.amount > 0, Transaction.amount), else_=0)),
                0,
            ).label("income"),
            func.coalesce(
                func.sum(case((Transaction.amount < 0, Transaction.amount), else_=0)),
                0,
            ).label("expenses"),
        )
        .where(
            Transaction.account_id == account_id,
            Transaction.dt >= window_start,
            Transaction.dt < window_end,
        )
        .group_by(month_start_expr),
    )

    totals: dict[date, tuple[int, int]] = {}
    for row in result:
        # date_trunc may return a timestamp; coerce to plain date for keying.
        key = row.month_start.date() if hasattr(row.month_start, "date") else row.month_start
        totals[key] = (int(row.income), abs(int(row.expenses)))

    return [
        MonthlyIncomeExpense(
            month=m,
            income=totals.get(m, (0, 0))[0],
            expenses=totals.get(m, (0, 0))[1],
        )
        for m in month_starts
    ]
