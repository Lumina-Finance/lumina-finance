"""Period glance service for the insights page."""

import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountBalanceSnapshot
from app.models.base import AccountKind, CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.insights import InsightsPeriodGlanceResponse
from app.services.insights.common import get_base_currency_accounts, previous_period_bounds

CategoryNetTotals = dict[uuid.UUID, tuple[str, CategoryKind, int]]


async def _query_period_totals(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    from_date: date,
    to_date: date,
) -> tuple[int, int]:
    """Return sign-directed net income and expense totals for the period."""
    result = await db.execute(
        select(Category.id, func.sum(Transaction.amount).label("total"))
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= from_date,
            Transaction.dt <= to_date,
        )
        .group_by(Category.id),
    )

    income = 0
    expenses = 0
    for row in result:
        total = int(row.total or 0)
        if total > 0:
            income += total
        elif total < 0:
            expenses += -total

    return income, expenses


async def _query_expense_category_totals(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    from_date: date,
    to_date: date,
) -> dict[uuid.UUID, tuple[str, int]]:
    """Return positive expense-side totals keyed by category id for an inclusive period."""
    result = await db.execute(
        select(
            Category.id,
            Category.name,
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
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


async def _query_category_net_totals(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    from_date: date,
    to_date: date,
) -> CategoryNetTotals:
    """Return signed category totals keyed by category id for an inclusive period."""
    result = await db.execute(
        select(
            Category.id,
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

    totals: CategoryNetTotals = {}
    for row in result:
        amount = int(row.total or 0)
        if amount:
            totals[row.id] = (row.name, row.kind, amount)
    return totals


def _top_category(
    current_totals: dict[uuid.UUID, tuple[str, int]],
) -> tuple[str, int | None] | None:
    """Return the largest current expense category, if present."""
    if not current_totals:
        return None
    total_positive_expenses = sum(amount for _name, amount in current_totals.values())
    name, amount = sorted(current_totals.values(), key=lambda item: (-item[1], item[0]))[0]
    return name, round((amount / total_positive_expenses) * 100) if total_positive_expenses > 0 else None


def _biggest_category_change(
    current_totals: CategoryNetTotals,
    previous_totals: CategoryNetTotals,
) -> tuple[str, int, int | None] | None:
    """Return the tracked category with the largest comparable dollar change."""
    category_ids = [
        category_id
        for category_id in set(current_totals) | set(previous_totals)
        if _is_change_candidate(category_id, current_totals, previous_totals)
    ]
    if not category_ids:
        return None

    def change_sort_key(candidate: uuid.UUID) -> tuple[int, str]:
        name, kind = _category_identity(candidate, current_totals, previous_totals)
        current_amount = current_totals.get(candidate, ("", kind, 0))[2]
        previous_amount = previous_totals.get(candidate, ("", kind, 0))[2]
        return -abs(_category_change_amount(kind, current_amount, previous_amount)), name

    category_id = sorted(category_ids, key=change_sort_key)[0]
    name, kind = _category_identity(category_id, current_totals, previous_totals)
    current_amount = current_totals.get(category_id, ("", kind, 0))[2]
    previous_amount = previous_totals.get(category_id, ("", kind, 0))[2]
    change_amount = _category_change_amount(kind, current_amount, previous_amount)
    previous_basis = _category_change_basis(kind, current_amount, previous_amount)
    change_pct = round((change_amount / previous_basis) * 100) if previous_basis > 0 else None
    return name, change_amount, change_pct


def _category_identity(
    category_id: uuid.UUID,
    current_totals: CategoryNetTotals,
    previous_totals: CategoryNetTotals,
) -> tuple[str, CategoryKind]:
    name, kind, _amount = current_totals.get(
        category_id,
        previous_totals.get(category_id, ("", CategoryKind.EXPENSE, 0)),
    )
    return name, kind


def _is_change_candidate(
    category_id: uuid.UUID,
    current_totals: CategoryNetTotals,
    previous_totals: CategoryNetTotals,
) -> bool:
    _name, kind = _category_identity(category_id, current_totals, previous_totals)
    current_amount = current_totals.get(category_id, ("", kind, 0))[2]
    previous_amount = previous_totals.get(category_id, ("", kind, 0))[2]

    if kind == CategoryKind.INCOME:
        return current_amount < 0
    return current_amount != 0 or previous_amount != 0


def _category_change_amount(kind: CategoryKind, current_amount: int, previous_amount: int) -> int:
    if kind == CategoryKind.EXPENSE and current_amount <= 0 and previous_amount <= 0:
        return (-current_amount) - (-previous_amount)
    return current_amount - previous_amount


def _category_change_basis(kind: CategoryKind, current_amount: int, previous_amount: int) -> int:
    if previous_amount == 0:
        return 0
    if kind == CategoryKind.EXPENSE and current_amount <= 0 and previous_amount <= 0:
        return -previous_amount
    return abs(previous_amount)


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
    previous_from_date, previous_to_date = previous_period_bounds(from_date, to_date)
    base_currency_accounts = await get_base_currency_accounts(db, user)
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
    current_category_net_totals = await _query_category_net_totals(
        db,
        account_ids,
        from_date,
        to_date,
    )
    previous_category_net_totals = await _query_category_net_totals(
        db,
        account_ids,
        previous_from_date,
        previous_to_date,
    )
    start_net_worth = await _net_worth_at(db, base_currency_accounts, from_date)
    end_net_worth = await _net_worth_at(db, base_currency_accounts, to_date)
    top_category = _top_category(current_category_totals)
    biggest_change = _biggest_category_change(current_category_net_totals, previous_category_net_totals)

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
