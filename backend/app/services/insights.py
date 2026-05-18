"""Aggregation helpers for insights endpoints."""

import uuid
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountBalanceSnapshot
from app.models.base import AccountKind, CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.insights import InsightsIncomeExpenseFlowResponse, InsightsPeriodGlanceResponse
from app.services.dashboard import get_accessible_accounts


def _previous_period_bounds(from_date: date, to_date: date) -> tuple[date, date]:
    """Return the immediately preceding inclusive period with the same length."""
    period_days = (to_date - from_date).days + 1
    previous_to_date = from_date - timedelta(days=1)
    previous_from_date = previous_to_date - timedelta(days=period_days - 1)
    return previous_from_date, previous_to_date


async def _query_period_totals(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    from_date: date,
    to_date: date,
) -> tuple[int, int]:
    """Return kind-aware net income and expense totals for the period."""
    result = await db.execute(
        select(Category.id, Category.kind, func.sum(Transaction.amount).label("total"))
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= from_date,
            Transaction.dt <= to_date,
        )
        .group_by(Category.id, Category.kind),
    )

    income = 0
    expenses = 0
    for row in result:
        total = int(row.total or 0)
        if row.kind == CategoryKind.INCOME:
            income += total
        else:
            expenses += max(-total, 0)

    return income, expenses


async def _query_expense_category_totals(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    from_date: date,
    to_date: date,
) -> dict[uuid.UUID, tuple[str, int]]:
    """Return positive expense-kind totals keyed by category id for an inclusive period."""
    result = await db.execute(
        select(
            Category.id,
            Category.name,
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind == CategoryKind.EXPENSE,
            Transaction.dt >= from_date,
            Transaction.dt <= to_date,
        )
        .group_by(Category.id, Category.name),
    )

    totals: dict[uuid.UUID, tuple[str, int]] = {}
    for row in result:
        amount = max(-int(row.total or 0), 0)
        if amount:
            totals[row.id] = (row.name, amount)
    return totals


async def _query_flow_entries(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    from_date: date,
    to_date: date,
) -> tuple[
    list[tuple[str, int]],
    list[tuple[str, int]],
    list[tuple[str, int]],
    list[tuple[str, int]],
]:
    """Return sign-directed category totals for the Sankey card."""
    result = await db.execute(
        select(
            Category.name,
            Category.kind,
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= from_date,
            Transaction.dt <= to_date,
        )
        .group_by(Category.id, Category.name, Category.kind),
    )

    inflows: list[tuple[str, int]] = []
    outflows: list[tuple[str, int]] = []
    expense_inflows: list[tuple[str, int]] = []
    income_outflows: list[tuple[str, int]] = []
    for row in result:
        total = int(row.total or 0)
        if total > 0:
            inflows.append((row.name, total))
            if row.kind == CategoryKind.EXPENSE:
                expense_inflows.append((row.name, total))
        elif total < 0:
            amount = -total
            outflows.append((row.name, amount))
            if row.kind == CategoryKind.INCOME:
                income_outflows.append((row.name, amount))

    def sorted_entries(entries: list[tuple[str, int]]) -> list[tuple[str, int]]:
        return sorted(entries, key=lambda entry: (-entry[1], entry[0]))

    return (
        sorted_entries(inflows),
        sorted_entries(outflows),
        sorted_entries(income_outflows),
        sorted_entries(expense_inflows),
    )


def _top_category(
    current_totals: dict[uuid.UUID, tuple[str, int]],
    expenses: int,
) -> tuple[str, int | None] | None:
    """Return the largest current expense category, if present."""
    if not current_totals:
        return None
    name, amount = sorted(current_totals.values(), key=lambda item: (-item[1], item[0]))[0]
    return name, round((amount / expenses) * 100) if expenses > 0 else None


def _biggest_category_change(
    current_totals: dict[uuid.UUID, tuple[str, int]],
    previous_totals: dict[uuid.UUID, tuple[str, int]],
) -> tuple[str, int, int | None] | None:
    """Return the expense category with the largest absolute dollar change."""
    category_ids = set(current_totals) | set(previous_totals)
    if not category_ids:
        return None

    def change_sort_key(candidate: uuid.UUID) -> tuple[int, str]:
        current_name, current_amount = current_totals.get(candidate, ("", 0))
        previous_name, previous_amount = previous_totals.get(candidate, ("", 0))
        return -abs(current_amount - previous_amount), current_name or previous_name

    category_id = sorted(category_ids, key=change_sort_key)[0]
    name = current_totals.get(category_id, previous_totals.get(category_id, ("", 0)))[0]
    current_amount = current_totals.get(category_id, ("", 0))[1]
    previous_amount = previous_totals.get(category_id, ("", 0))[1]
    change_amount = current_amount - previous_amount
    change_pct = round((change_amount / previous_amount) * 100) if previous_amount > 0 else None
    return name, change_amount, change_pct


async def _net_worth_at(
    db: AsyncSession,
    accounts: list[Account],
    target_date: date,
) -> int:
    """Return net worth from latest per-account snapshots on or before target_date."""
    if not accounts:
        return 0

    account_ids = [account.id for account in accounts]
    sign_by_id = {
        account.id: 1 if account.account_kind == AccountKind.ASSET else -1
        for account in accounts
    }
    result = await db.execute(
        select(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.balance)
        .where(
            AccountBalanceSnapshot.account_id.in_(account_ids),
            AccountBalanceSnapshot.dt <= target_date,
        )
        .order_by(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.dt.desc())
        .distinct(AccountBalanceSnapshot.account_id),
    )
    balances = {row.account_id: int(row.balance) for row in result}
    return sum(balances.get(account_id, 0) * sign_by_id[account_id] for account_id in account_ids)


async def get_period_glance(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsPeriodGlanceResponse:
    """Return compact insight totals for the top period-glance card."""
    previous_from_date, previous_to_date = _previous_period_bounds(from_date, to_date)
    accounts = await get_accessible_accounts(db, user)
    base_currency_accounts = [account for account in accounts if account.currency == user.base_currency]
    account_ids = [account.id for account in base_currency_accounts]

    if not account_ids:
        return InsightsPeriodGlanceResponse(
            income=0,
            expenses=0,
            net_worth_change=0,
        )

    income, expenses = await _query_period_totals(
        db,
        account_ids,
        from_date,
        to_date,
    )
    current_category_totals = await _query_expense_category_totals(
        db,
        account_ids,
        from_date,
        to_date,
    )
    previous_category_totals = await _query_expense_category_totals(
        db,
        account_ids,
        previous_from_date,
        previous_to_date,
    )
    start_net_worth = await _net_worth_at(db, base_currency_accounts, from_date)
    end_net_worth = await _net_worth_at(db, base_currency_accounts, to_date)
    top_category = _top_category(current_category_totals, expenses)
    biggest_change = _biggest_category_change(current_category_totals, previous_category_totals)

    return InsightsPeriodGlanceResponse(
        income=income,
        expenses=expenses,
        net_worth_change=end_net_worth - start_net_worth,
        top_category_name=top_category[0] if top_category else None,
        top_category_share_pct=top_category[1] if top_category else None,
        biggest_change_name=biggest_change[0] if biggest_change else None,
        biggest_change_amount=biggest_change[1] if biggest_change else None,
        biggest_change_pct=biggest_change[2] if biggest_change else None,
    )


async def get_income_expense_flow(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsIncomeExpenseFlowResponse:
    """Return all positive entries for the income-to-expenses Sankey card."""
    accounts = await get_accessible_accounts(db, user)
    base_currency_accounts = [account for account in accounts if account.currency == user.base_currency]
    account_ids = [account.id for account in base_currency_accounts]

    if not account_ids:
        return InsightsIncomeExpenseFlowResponse(
            income_sources=[],
            expense_categories=[],
            income_outflows=[],
            expense_inflows=[],
            income_source_count=0,
            expense_category_count=0,
        )

    income_sources, expense_categories, income_outflows, expense_inflows = await _query_flow_entries(
        db,
        account_ids,
        from_date,
        to_date,
    )

    return InsightsIncomeExpenseFlowResponse(
        income_sources=income_sources,
        expense_categories=expense_categories,
        income_outflows=income_outflows,
        expense_inflows=expense_inflows,
        income_source_count=len(income_sources),
        expense_category_count=len(expense_categories),
    )
