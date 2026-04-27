"""Data helpers for the ``GET /dashboard`` aggregation endpoint.

Each public function in this module builds one widget of the dashboard
payload. Helpers take the signed-in user (or a derived account list) plus
a reference time ``now`` and derive any further date boundaries internally,
so callers don't have to plumb window-start/window-end timestamps through.

Scoping rules mirror the default aggregate/list endpoints:
- accessible accounts = non-hidden personal + group admin + explicit per-account permission
- accessible budgets  = same pattern against base budgets
so the dashboard never surfaces data the user couldn't read elsewhere.

Currency rule: spending, credit, net worth, and savings widgets sum only
activity on accounts whose currency matches the user's base currency.
Foreign-currency rows are excluded until fx conversion lands.
"""
import calendar
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import (
    DASHBOARD_RECENT_TRANSACTIONS_LIMIT,
    DASHBOARD_SAVINGS_HISTORY_MONTHS,
)
from app.models.account import Account, AccountBalanceSnapshot, AccountPermission
from app.models.base import AccountKind, CategoryKind
from app.models.budget import BaseBudget, Budget, BudgetPermission, BudgetTrackedCategory
from app.models.category import Category
from app.models.group import GroupMember
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.dashboard import (
    ActiveBudgetSummary,
    CategoryBreakdownEntry,
    MonthlyIncomeExpense,
    RangeKind,
    SpendingBreakdownResponse,
    SpendingComparisonResponse,
)
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


def _first_of_next_month(now: datetime) -> date:
    """Return the first of the month immediately after ``now``'s month."""
    if now.month == 12:
        return date(now.year + 1, 1, 1)
    return date(now.year, now.month + 1, 1)


def _cumsum(values: list[int]) -> list[int]:
    """Return the running cumulative sum of ``values``."""
    running = 0
    out: list[int] = []
    for v in values:
        running += v
        out.append(running)
    return out


# ---------------------------------------------------------------------------
# Account access
# ---------------------------------------------------------------------------

async def get_accessible_accounts(
    db: AsyncSession, user: User, *, include_hidden: bool = False,
) -> list[Account]:
    """Return accounts the user can read, excluding hidden accounts by default."""
    query = (
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
        )
    )
    if not include_hidden:
        query = query.where(Account.is_hidden.is_(False))

    result = await db.execute(
        query,
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

    Only base-currency revolving-credit accounts with ``credit_limit`` set
    contribute. Liability balances are stored as negatives, so ``credit_used``
    takes the absolute value of each balance.
    """
    credit_accounts = [
        a for a in base_currency_accounts
        if a.account_kind == AccountKind.REVOLVING and a.credit_limit is not None
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

    result = await db.execute(
        select(Budget.id, func.sum(Transaction.amount).label("amount_sum"))
        .join(BaseBudget, Budget.base_budget_id == BaseBudget.id)
        .join(BudgetTrackedCategory, BudgetTrackedCategory.base_budget_id == BaseBudget.id)
        .join(Transaction, Transaction.category_id == BudgetTrackedCategory.category_id)
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Budget.id.in_(budget_ids),
            BudgetTrackedCategory.added_at <= Budget.period_end,
            (BudgetTrackedCategory.removed_at.is_(None)) | (BudgetTrackedCategory.removed_at > Budget.period_end),
            Transaction.dt >= Budget.period_start,
            Transaction.dt <= Budget.period_end,
            Account.is_hidden.is_(False),
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
# Savings rate widget
# ---------------------------------------------------------------------------

async def get_savings_rate_history(
    db: AsyncSession, base_currency_account_ids: list[uuid.UUID], now: datetime,
) -> list[MonthlyIncomeExpense]:
    """Return per-month income / expense totals for the savings-rate chart.

    The series covers ``DASHBOARD_SAVINGS_HISTORY_MONTHS`` calendar months
    ending with the current (in-progress) month, ordered oldest-first. Months
    with no activity are emitted as zeros so every chart slot has a value.
    Expenses are stored as negative amounts; the returned ``expenses`` field
    is the absolute value so the frontend can compute the rate directly.
    """
    months_count = DASHBOARD_SAVINGS_HISTORY_MONTHS
    first_month = _months_before(now, months_count - 1)
    window_end = _first_of_next_month(now)

    # Build the month sequence up front so missing months still appear as zeros.
    months: list[date] = []
    year, month = first_month.year, first_month.month
    for _ in range(months_count):
        months.append(date(year, month, 1))
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1

    if not base_currency_account_ids:
        return [MonthlyIncomeExpense(month=m, income=0, expenses=0) for m in months]

    month_start_expr = func.date_trunc("month", Transaction.dt).label("month_start")
    result = await db.execute(
        select(month_start_expr, Category.kind, func.sum(Transaction.amount).label("total"))
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(base_currency_account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= first_month,
            Transaction.dt < window_end,
        )
        .group_by(month_start_expr, Category.kind),
    )

    # Collect row totals keyed by first-of-month, keeping income and expense
    # buckets separate so we can emit one MonthlyIncomeExpense per month below.
    totals: dict[date, dict[CategoryKind, int]] = {m: {} for m in months}
    for row in result:
        # date_trunc returns a timestamp; coerce to a plain date for the key.
        key = row.month_start.date() if hasattr(row.month_start, "date") else row.month_start
        totals[key][row.kind] = int(row.total)

    return [
        MonthlyIncomeExpense(
            month=m,
            income=totals[m].get(CategoryKind.INCOME, 0),
            expenses=abs(totals[m].get(CategoryKind.EXPENSE, 0)),
        )
        for m in months
    ]


# ---------------------------------------------------------------------------
# Spending comparison (range-scoped)
# ---------------------------------------------------------------------------

_MONTH_ABBR = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]


def _plan_spending_comparison(
    range_: RangeKind, today: date,
) -> tuple[list[str], list[tuple[date, date]], list[tuple[date, date]]]:
    """Build x-axis slot labels and per-slot date ranges for ``range_``.

    A slot is one spot on the chart's x-axis — a day for WTD/MTD, a week for
    QTD, a month for YTD. ``labels`` covers the full current period (drives
    the x-axis). ``current_ranges`` and ``previous_ranges`` only include
    slots that have real data — ``current`` stops at today, ``previous``
    stops at the prior period's last day (capped at ``len(labels)``).
    """
    if range_ == "WTD":
        # Full Monday-Sunday week drives the x-axis; current fills up to today.
        week_start = today - timedelta(days=today.weekday())
        labels = [(week_start + timedelta(days=i)).strftime("%a") for i in range(7)]
        elapsed_days = today.weekday() + 1
        current_ranges = [
            (week_start + timedelta(days=i), week_start + timedelta(days=i))
            for i in range(elapsed_days)
        ]
        prev_start = week_start - timedelta(days=7)
        previous_ranges = [
            (prev_start + timedelta(days=i), prev_start + timedelta(days=i))
            for i in range(7)
        ]
        return labels, current_ranges, previous_ranges

    if range_ == "MTD":
        month_days = calendar.monthrange(today.year, today.month)[1]
        labels = [str(i + 1) for i in range(month_days)]
        current_ranges = [
            (date(today.year, today.month, day), date(today.year, today.month, day))
            for day in range(1, today.day + 1)
        ]
        if today.month == 1:
            prev_year, prev_month = today.year - 1, 12
        else:
            prev_year, prev_month = today.year, today.month - 1
        prev_month_days = calendar.monthrange(prev_year, prev_month)[1]
        # Cap at the x-axis length so previous never extends past the chart.
        previous_ranges = [
            (date(prev_year, prev_month, day), date(prev_year, prev_month, day))
            for day in range(1, min(prev_month_days, month_days) + 1)
        ]
        return labels, current_ranges, previous_ranges

    if range_ == "QTD":
        q_month = ((today.month - 1) // 3) * 3 + 1
        current_quarter_start = date(today.year, q_month, 1)
        next_q_start = (
            date(today.year + 1, 1, 1) if q_month == 10
            else date(today.year, q_month + 3, 1)
        )
        days_in_quarter = (next_q_start - current_quarter_start).days
        # Weekly slots; the last one may be short (e.g., Q1 non-leap = 90 days, W13 has 6 days).
        n_weeks = (days_in_quarter + 6) // 7
        quarter_last_day = next_q_start - timedelta(days=1)
        labels = [f"W{i + 1}" for i in range(n_weeks)]
        # Current weeks run from quarter start up to the one containing today.
        current_weeks_elapsed = (today - current_quarter_start).days // 7 + 1
        current_ranges = []
        for i in range(current_weeks_elapsed):
            slot_start = current_quarter_start + timedelta(days=7 * i)
            slot_end = min(slot_start + timedelta(days=6), today, quarter_last_day)
            current_ranges.append((slot_start, slot_end))
        if q_month == 1:
            prev_q_year, prev_q_month = today.year - 1, 10
        else:
            prev_q_year, prev_q_month = today.year, q_month - 3
        prev_quarter_start = date(prev_q_year, prev_q_month, 1)
        prev_next_q_start = (
            date(prev_q_year + 1, 1, 1) if prev_q_month == 10
            else date(prev_q_year, prev_q_month + 3, 1)
        )
        prev_last_day = prev_next_q_start - timedelta(days=1)
        prev_days = (prev_next_q_start - prev_quarter_start).days
        prev_weeks = (prev_days + 6) // 7
        # Cap at n_weeks so previous never extends past the chart.
        previous_ranges = []
        for i in range(min(prev_weeks, n_weeks)):
            slot_start = prev_quarter_start + timedelta(days=7 * i)
            slot_end = min(slot_start + timedelta(days=6), prev_last_day)
            previous_ranges.append((slot_start, slot_end))
        return labels, current_ranges, previous_ranges

    # YTD — twelve monthly slots; current fills up to today's month.
    labels = list(_MONTH_ABBR)
    current_ranges = []
    for month in range(1, today.month + 1):
        start = date(today.year, month, 1)
        end = today if month == today.month else date(today.year, month, calendar.monthrange(today.year, month)[1])
        current_ranges.append((start, end))
    prev_year = today.year - 1
    previous_ranges = [
        (date(prev_year, m, 1),
         date(prev_year, m, calendar.monthrange(prev_year, m)[1]))
        for m in range(1, 13)
    ]
    return labels, current_ranges, previous_ranges


async def _query_daily_expense(
    db: AsyncSession,
    base_currency_account_ids: list[uuid.UUID],
    start: date,
    end: date,
) -> dict[date, int]:
    """Return ``{dt: positive_expense_minor_units}`` for ``[start, end]`` inclusive.

    Expenses are stored as negative amounts; the mapping flips sign so
    callers can cumsum into positive display values directly.
    """
    result = await db.execute(
        select(Transaction.dt, func.sum(Transaction.amount).label("total"))
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(base_currency_account_ids),
            Category.kind == CategoryKind.EXPENSE,
            Transaction.dt >= start,
            Transaction.dt <= end,
        )
        .group_by(Transaction.dt),
    )
    return {row.dt: -int(row.total) for row in result}


def _sum_days(daily: dict[date, int], start: date, end: date) -> int:
    """Sum ``daily`` totals across every date in ``[start, end]`` inclusive."""
    total = 0
    d = start
    while d <= end:
        total += daily.get(d, 0)
        d += timedelta(days=1)
    return total


async def get_spending_comparison(
    db: AsyncSession,
    base_currency_account_ids: list[uuid.UUID],
    range_: RangeKind,
    now: datetime,
) -> SpendingComparisonResponse:
    """Return current-vs-prior cumulative expense series for ``range_``.

    See :class:`SpendingComparisonResponse` for payload shape. ``current``
    and ``previous`` only include slots with real data — the frontend zips
    by index and treats missing trailing entries as no data.
    """
    labels, current_ranges, previous_ranges = _plan_spending_comparison(range_, now.date())

    if not base_currency_account_ids:
        return SpendingComparisonResponse(
            range=range_,
            slot_labels=labels,
            current=[0] * len(current_ranges),
            previous=[0] * len(previous_ranges),
        )

    current_daily_spend = (
        await _query_daily_expense(
            db, base_currency_account_ids,
            current_ranges[0][0], current_ranges[-1][1],
        )
        if current_ranges
        else {}
    )
    previous_daily_spend = (
        await _query_daily_expense(
            db, base_currency_account_ids,
            previous_ranges[0][0], previous_ranges[-1][1],
        )
        if previous_ranges
        else {}
    )

    current_slot_totals = [_sum_days(current_daily_spend, r[0], r[1]) for r in current_ranges]
    previous_slot_totals = [_sum_days(previous_daily_spend, r[0], r[1]) for r in previous_ranges]

    return SpendingComparisonResponse(
        range=range_,
        slot_labels=labels,
        current=_cumsum(current_slot_totals),
        previous=_cumsum(previous_slot_totals),
    )


# ---------------------------------------------------------------------------
# Spending / income breakdown (range-scoped)
# ---------------------------------------------------------------------------

def _current_period_bounds(range_: RangeKind, today: date) -> tuple[date, date]:
    """Return ``(start, today)`` bounds for the current ``range_``.

    Matches the current-period start used by ``_plan_spending_comparison`` so
    the breakdown widget's totals agree with the comparison chart's cumulative
    current-series endpoint.
    """
    if range_ == "WTD":
        return today - timedelta(days=today.weekday()), today
    if range_ == "MTD":
        return date(today.year, today.month, 1), today
    if range_ == "QTD":
        q_month = ((today.month - 1) // 3) * 3 + 1
        return date(today.year, q_month, 1), today
    return date(today.year, 1, 1), today


async def get_spending_breakdown(
    db: AsyncSession,
    base_currency_account_ids: list[uuid.UUID],
    range_: RangeKind,
    now: datetime,
) -> SpendingBreakdownResponse:
    """Return category-level expense and income totals for ``range_``.

    Aggregates transactions on base-currency accessible accounts between the
    range's current-period start and today. Expense amounts are flipped to
    positive minor units. Categories with zero totals are dropped; entries
    are sorted largest-first so the frontend can take the top N directly.
    """
    start, end = _current_period_bounds(range_, now.date())
    if not base_currency_account_ids:
        return SpendingBreakdownResponse(range=range_, expense=[], income=[])

    result = await db.execute(
        select(
            Category.id,
            Category.name,
            Category.kind,
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(base_currency_account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= start,
            Transaction.dt <= end,
        )
        .group_by(Category.id, Category.name, Category.kind),
    )

    expense: list[CategoryBreakdownEntry] = []
    income: list[CategoryBreakdownEntry] = []
    for row in result:
        amount = abs(int(row.total))
        if amount == 0:
            continue
        entry = CategoryBreakdownEntry(category_id=row.id, name=row.name, amount=amount)
        if row.kind == CategoryKind.EXPENSE:
            expense.append(entry)
        else:
            income.append(entry)

    expense.sort(key=lambda e: e.amount, reverse=True)
    income.sort(key=lambda e: e.amount, reverse=True)
    return SpendingBreakdownResponse(range=range_, expense=expense, income=income)
