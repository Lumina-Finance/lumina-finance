"""Data helpers for the ``GET /dashboard`` aggregation endpoint.

Each public function in this module builds one widget of the dashboard
payload. Helpers take the signed-in user (or a derived account list) plus
a reference time ``now`` and derive any further date boundaries internally,
so callers don't have to plumb window-start/window-end timestamps through.

Scoping rules mirror the list endpoints:
- accessible accounts = personal + group admin + explicit per-account permission
- accessible budgets  = same pattern against base budgets
so the dashboard never surfaces data the user couldn't read elsewhere.

Currency rule: spending, credit, net worth, and savings widgets sum only
activity on accounts whose currency matches the user's base currency.
Foreign-currency rows are excluded until fx conversion lands.
"""
import calendar
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import (
    DASHBOARD_HISTORICAL_MONTHS_TO_AVERAGE,
    DASHBOARD_RECENT_TRANSACTIONS_LIMIT,
    DASHBOARD_SAVINGS_RATE_MONTHS,
)
from app.models.account import Account, AccountBalanceSnapshot, AccountPermission
from app.models.base import AccountKind, CategoryKind
from app.models.budget import BaseBudget, Budget, BudgetPermission, BudgetTrackedCategory
from app.models.category import Category
from app.models.group import GroupMember
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.dashboard import ActiveBudgetSummary
from app.schemas.transaction import TransactionResponse
from app.services.snapshots import get_current_balances
from app.services.transaction_responses import build_transaction_response, get_tag_ids_batch

# ---------------------------------------------------------------------------
# Helpers for dashboard widgets (date & math)
# ---------------------------------------------------------------------------

def _first_of_current_month(now: datetime) -> date:
    """Return the first of ``now``'s month as a ``date``."""
    return date(now.year, now.month, 1)


def _months_before(now: datetime, n: int) -> date:
    """Return the first of the month ``n`` full months before ``now``'s month."""
    year, month = now.year, now.month
    for _ in range(n):
        if month == 1:
            year -= 1
            month = 12
        else:
            month -= 1
    return date(year, month, 1)


def _cumsum(values: list[int]) -> list[int]:
    """Return the running cumulative sum of ``values``."""
    running = 0
    out: list[int] = []
    for v in values:
        running += v
        out.append(running)
    return out


def _average_cumulative_across_months(
    daily_rows: list[tuple[date, int]], target_month_length: int,
) -> tuple[list[int] | None, int]:
    """Average a flat list of ``(day, total)`` rows across months into a cumulative series.

    Rows are grouped by ``(year, month)`` into per-month daily arrays, each
    array is cumsummed, and then for each day-of-month in
    ``target_month_length`` the values are averaged across the months that
    had that day-of-month. Returns ``(series, months_averaged)``. The series
    is ``None`` and ``months_averaged`` is ``0`` when no months contributed.
    """
    if not daily_rows:
        return None, 0

    per_month: dict[tuple[int, int], list[int]] = {}
    for day_value, total in daily_rows:
        key = (day_value.year, day_value.month)
        if key not in per_month:
            per_month[key] = [0] * calendar.monthrange(key[0], key[1])[1]
        per_month[key][day_value.day - 1] = total

    cumul_per_month = {k: _cumsum(v) for k, v in per_month.items()}

    avg_series: list[int] = []
    for day_idx in range(target_month_length):
        values_for_day = [c[day_idx] for c in cumul_per_month.values() if day_idx < len(c)]
        if values_for_day:
            avg_series.append(sum(values_for_day) // len(values_for_day))
        else:
            avg_series.append(0)

    return avg_series, len(per_month)


# ---------------------------------------------------------------------------
# Account access
# ---------------------------------------------------------------------------

async def get_accessible_accounts(db: AsyncSession, user: User) -> list[Account]:
    """Return every account the user can read (personal / group admin / explicit permission)."""
    result = await db.execute(
        select(Account)
        .outerjoin(GroupMember, Account.group_id == GroupMember.group_id)
        .outerjoin(
            AccountPermission,
            (AccountPermission.account_id == Account.id) & (AccountPermission.user_id == user.id),
        )
        .where(
            (Account.owner_id == user.id)
            | ((GroupMember.user_id == user.id) & (GroupMember.is_admin.is_(True)))
            | (AccountPermission.user_id == user.id),
        ),
    )
    return list(result.scalars().unique().all())


# ---------------------------------------------------------------------------
# Net worth widget
# ---------------------------------------------------------------------------

async def get_net_worth_history(
    db: AsyncSession,
    base_currency_accounts: list[Account],
    window_days: int,
    now: datetime,
) -> tuple[int, list[int]]:
    """Return ``(current_net_worth, daily_history)`` across the last ``window_days`` days.

    Seeds a per-account running balance from the last snapshot strictly
    before the window start, then advances it using snapshots inside the
    window. The final daily total == current net worth; intermediate totals
    form the history series (index 0 = earliest day, final index = today).
    Asset balances add positively, liability balances subtract.
    """
    series = [0] * window_days
    if not base_currency_accounts:
        return 0, series

    today = now.date()
    window_start = today - timedelta(days=window_days - 1)
    ids = [a.id for a in base_currency_accounts]
    sign_by_id = {
        a.id: 1 if a.account_kind == AccountKind.ASSET else -1
        for a in base_currency_accounts
    }

    # Anchor: most recent snapshot strictly before window_start per account.
    anchor_result = await db.execute(
        select(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.balance)
        .where(
            AccountBalanceSnapshot.account_id.in_(ids),
            AccountBalanceSnapshot.dt < window_start,
        )
        .order_by(AccountBalanceSnapshot.account_id, AccountBalanceSnapshot.dt.desc())
        .distinct(AccountBalanceSnapshot.account_id),
    )
    running: dict[uuid.UUID, int] = {row.account_id: row.balance for row in anchor_result}
    for aid in ids:
        running.setdefault(aid, 0)

    # In-window snapshots, oldest first so we can walk day-by-day.
    in_window_result = await db.execute(
        select(
            AccountBalanceSnapshot.account_id,
            AccountBalanceSnapshot.balance,
            AccountBalanceSnapshot.dt,
        )
        .where(
            AccountBalanceSnapshot.account_id.in_(ids),
            AccountBalanceSnapshot.dt >= window_start,
        )
        .order_by(AccountBalanceSnapshot.dt),
    )
    updates_by_day: dict[date, dict[uuid.UUID, int]] = {}
    for row in in_window_result:
        updates_by_day.setdefault(row.dt, {})[row.account_id] = row.balance

    for day_idx in range(window_days):
        current_day = window_start + timedelta(days=day_idx)
        if current_day > today:
            break
        for aid, balance in updates_by_day.get(current_day, {}).items():
            running[aid] = balance
        series[day_idx] = sum(running[aid] * sign_by_id[aid] for aid in ids)

    current_net_worth = sum(running[aid] * sign_by_id[aid] for aid in ids)
    return current_net_worth, series


# ---------------------------------------------------------------------------
# Credit widget
# ---------------------------------------------------------------------------

async def get_credit_widget(
    db: AsyncSession, base_currency_accounts: list[Account],
) -> tuple[int, int]:
    """Return ``(credit_limit_total, credit_used)`` summed across eligible accounts.

    Only base-currency liability accounts with ``credit_limit`` set
    contribute. Liability balances are stored as negatives, so ``credit_used``
    takes the absolute value of each balance.
    """
    credit_accounts = [
        a for a in base_currency_accounts
        if a.account_kind == AccountKind.LIABILITY and a.credit_limit is not None
    ]
    if not credit_accounts:
        return 0, 0

    balances = await get_current_balances(db, [a.id for a in credit_accounts])
    credit_limit_total = sum(a.credit_limit for a in credit_accounts)
    credit_used = sum(abs(balances.get(a.id, 0)) for a in credit_accounts)
    return credit_limit_total, credit_used


# ---------------------------------------------------------------------------
# Recent transactions widget
# ---------------------------------------------------------------------------

async def get_recent_transactions(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    window_days: int,
    now: datetime,
) -> list[TransactionResponse]:
    """Return the last ``DASHBOARD_RECENT_TRANSACTIONS_LIMIT`` transactions inside the window."""
    if not account_ids:
        return []
    window_start = now.date() - timedelta(days=window_days)
    txn_result = await db.execute(
        select(Transaction)
        .where(
            Transaction.account_id.in_(account_ids),
            Transaction.dt >= window_start,
        )
        .order_by(Transaction.dt.desc(), Transaction.id)
        .limit(DASHBOARD_RECENT_TRANSACTIONS_LIMIT),
    )
    transactions = list(txn_result.scalars().all())
    tag_map = await get_tag_ids_batch(db, [t.id for t in transactions])
    return [build_transaction_response(t, tag_map[t.id]) for t in transactions]


# ---------------------------------------------------------------------------
# Active budgets widget
# ---------------------------------------------------------------------------

async def _fetch_active_budget_instances(
    db: AsyncSession, user: User, now: datetime,
) -> list[tuple[Budget, BaseBudget]]:
    """Return in-flight budget instances the user can read, with their base budgets.

    Active = ``period_start <= now <= period_end``. Scope mirrors
    ``list_budgets`` (owner / group admin / explicit permission).
    """
    result = await db.execute(
        select(Budget, BaseBudget)
        .join(BaseBudget, Budget.base_budget_id == BaseBudget.id)
        .outerjoin(GroupMember, BaseBudget.group_id == GroupMember.group_id)
        .outerjoin(
            BudgetPermission,
            (BudgetPermission.base_budget_id == BaseBudget.id) & (BudgetPermission.user_id == user.id),
        )
        .where(
            Budget.period_start <= now,
            Budget.period_end >= now,
        )
        .where(
            (BaseBudget.owner_id == user.id)
            | ((GroupMember.user_id == user.id) & (GroupMember.is_admin.is_(True)))
            | (BudgetPermission.user_id == user.id),
        )
        .order_by(BaseBudget.name),
    )
    return list(result.unique().all())


async def _aggregate_spent_per_active_budget(
    db: AsyncSession, budget_ids: list[uuid.UUID],
) -> dict[uuid.UUID, int]:
    """Return ``{budget_id: total_spent}`` for the given budgets, in one query.

    Mirrors ``get_budget_utilization``'s scoping: tracked-category membership
    as of ``period_end`` (historical-accuracy predicate), account/base
    currency match, and owner/group scope filter. Batches across every active
    budget by grouping on ``Budget.id``. Expenses are stored as negative
    amounts, so the sum is flipped so ``total_spent`` is positive.
    """
    if not budget_ids:
        return {}

    # added_at / removed_at are still DateTime — cast to the user-facing UTC day so
    # they compare cleanly against Budget.period_end (Date). Transaction.dt is Date.
    added_at_day = cast(func.timezone("UTC", BudgetTrackedCategory.added_at), Date)
    removed_at_day = cast(func.timezone("UTC", BudgetTrackedCategory.removed_at), Date)
    result = await db.execute(
        select(Budget.id, func.sum(Transaction.amount).label("amount_sum"))
        .join(BaseBudget, Budget.base_budget_id == BaseBudget.id)
        .join(BudgetTrackedCategory, BudgetTrackedCategory.base_budget_id == BaseBudget.id)
        .join(Transaction, Transaction.category_id == BudgetTrackedCategory.category_id)
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Budget.id.in_(budget_ids),
            added_at_day <= Budget.period_end,
            (BudgetTrackedCategory.removed_at.is_(None)) | (removed_at_day > Budget.period_end),
            Transaction.dt >= Budget.period_start,
            Transaction.dt <= Budget.period_end,
            Account.currency == BaseBudget.currency,
            (
                (BaseBudget.group_id.is_not(None) & (Account.group_id == BaseBudget.group_id))
                | (BaseBudget.owner_id.is_not(None) & (Account.owner_id == BaseBudget.owner_id))
            ),
        )
        .group_by(Budget.id),
    )
    return {row.id: -int(row.amount_sum) for row in result}


async def get_active_budgets(
    db: AsyncSession, user: User, now: datetime,
) -> list[ActiveBudgetSummary]:
    """Return active budgets with current utilization, scoped like ``list_budgets``."""
    rows = await _fetch_active_budget_instances(db, user, now)
    if not rows:
        return []
    spent_by_budget = await _aggregate_spent_per_active_budget(
        db, [budget.id for budget, _ in rows],
    )
    return [
        ActiveBudgetSummary(
            budget_id=budget.id,
            base_budget_id=base.id,
            name=base.name,
            currency=base.currency,
            period_start=budget.period_start,
            period_end=budget.period_end,
            overall_limit=budget.overall_limit,
            total_spent=spent_by_budget.get(budget.id, 0),
        )
        for budget, base in rows
    ]


# ---------------------------------------------------------------------------
# Spending comparison widget
# ---------------------------------------------------------------------------

async def get_current_month_cumulative(
    db: AsyncSession, base_currency_account_ids: list[uuid.UUID], now: datetime,
) -> list[int]:
    """Return cumulative base-currency expense totals for the current month, day by day.

    Index 0 = day 1 of the month, final index = today's day-of-month. Only
    EXPENSE-kind rows contribute. Transactions at ``now`` or later are
    excluded so the series never outruns the request time.
    """
    current_day_of_month = now.day
    daily = [0] * current_day_of_month
    if not base_currency_account_ids:
        return daily

    month_start = _first_of_current_month(now)
    today = now.date()
    result = await db.execute(
        select(Transaction.dt, func.sum(Transaction.amount).label("total"))
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(base_currency_account_ids),
            Category.kind == CategoryKind.EXPENSE,
            Transaction.dt >= month_start,
            Transaction.dt <= today,
        )
        .group_by(Transaction.dt),
    )
    for row in result:
        idx = row.dt.day - 1
        if 0 <= idx < current_day_of_month:
            daily[idx] = int(row.total)
    return _cumsum(daily)


async def get_historical_avg_cumulative(
    db: AsyncSession, base_currency_account_ids: list[uuid.UUID], now: datetime,
) -> tuple[list[int] | None, int]:
    """Return the average cumulative expense curve across up to six prior months.

    The returned series has length equal to the current month's day count so
    it aligns with ``get_current_month_cumulative`` on the same x-axis and
    extends to month-end. Returns ``(None, 0)`` when no prior month had any
    base-currency expenses.
    """
    if not base_currency_account_ids:
        return None, 0

    month_start = _first_of_current_month(now)
    history_start = _months_before(now, DASHBOARD_HISTORICAL_MONTHS_TO_AVERAGE)
    result = await db.execute(
        select(Transaction.dt, func.sum(Transaction.amount).label("total"))
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(base_currency_account_ids),
            Category.kind == CategoryKind.EXPENSE,
            Transaction.dt >= history_start,
            Transaction.dt < month_start,
        )
        .group_by(Transaction.dt),
    )
    daily_rows = [(row.dt, int(row.total)) for row in result]
    days_in_current_month = calendar.monthrange(now.year, now.month)[1]
    return _average_cumulative_across_months(daily_rows, days_in_current_month)


# ---------------------------------------------------------------------------
# Savings rate widget
# ---------------------------------------------------------------------------

async def get_savings_rate(
    db: AsyncSession, base_currency_account_ids: list[uuid.UUID], now: datetime,
) -> float | None:
    """Return ``(income - expenses) / income`` over the three complete prior months.

    Only base-currency accounts contribute. Expenses are stored as negative
    amounts, so their absolute value is subtracted. Returns ``None`` when
    there was no income in the window — avoids divide-by-zero and an
    ambiguous ``0.0`` answer. Negative values are valid and signal
    overspending.
    """
    if not base_currency_account_ids:
        return None

    month_start = _first_of_current_month(now)
    savings_window_start = _months_before(now, DASHBOARD_SAVINGS_RATE_MONTHS)
    result = await db.execute(
        select(Category.kind, func.sum(Transaction.amount))
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(base_currency_account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= savings_window_start,
            Transaction.dt < month_start,
        )
        .group_by(Category.kind),
    )
    income_total = 0
    expense_total = 0
    for kind, total in result:
        if kind == CategoryKind.INCOME:
            income_total = int(total)
        else:
            expense_total = int(total)
    if income_total <= 0:
        return None
    return (income_total - abs(expense_total)) / income_total
