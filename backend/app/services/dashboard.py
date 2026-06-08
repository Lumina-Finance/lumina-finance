"""Data helpers for the dashboard aggregation endpoints

Each public function in this module builds one widget of the dashboard
payload. Helpers take the signed-in user (or a derived account list) plus
a reference time ``now`` and derive any further date boundaries internally,
so callers don't have to plumb window-start/window-end timestamps through

Scoping rules mirror the default aggregate/list endpoints:
- accessible accounts = readable personal + group admin + explicit per-account permission
- accessible budgets  = same pattern against base budgets
so the dashboard never surfaces data the user couldn't read elsewhere

Currency rule: dashboard money widgets convert foreign-currency account values
to the user's base currency. Recent activity keeps transaction rows as-is
"""
import calendar
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import DASHBOARD_SAVINGS_HISTORY_MONTHS
from app.models.account import Account, AccountPermission
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.group import GroupMember
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.dashboard import (
    CategoryBreakdownEntry,
    MonthlyIncomeExpense,
    RangeKind,
    SpendingBreakdownResponse,
    SpendingComparisonResponse,
)
from app.schemas.fx import FxStatus
from app.services.fx import FxConverter

DASHBOARD_BREAKDOWN_CATEGORY_LIMIT = 6

# ---------------------------------------------------------------------------
# Helpers for dashboard widgets (date & math)
# ---------------------------------------------------------------------------

def _first_of_current_month(now: datetime) -> date:
    """Return the first of ``now``'s month as a ``date``"""
    return date(now.year, now.month, 1)


def _months_before(now: datetime, n: int) -> date:
    """Return the first of the month ``n`` full months before ``now``'s month"""
    year, month = now.year, now.month
    for _ in range(n):
        if month == 1:
            year -= 1
            month = 12
        else:
            month -= 1
    return date(year, month, 1)


def _first_of_next_month(now: datetime) -> date:
    """Return the first of the month immediately after ``now``'s month"""
    if now.month == 12:
        return date(now.year + 1, 1, 1)
    return date(now.year, now.month + 1, 1)


def _cumsum(values: list[int]) -> list[int]:
    """Return the running cumulative sum of ``values``"""
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
    db: AsyncSession, user: User, *, include_archived: bool = True,
) -> list[Account]:
    """Return accounts the user can read, including archived accounts by default"""
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
    if not include_archived:
        query = query.where(Account.is_archived.is_(False))

    result = await db.execute(
        query,
    )
    return list(result.scalars().unique().all())


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Load minor-unit exponents for currency codes

    Args:
        db: Active database session
        currencies: Currency codes to load

    Returns:
        Mapping from currency code to minor-unit exponent
    """
    result = await db.execute(select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)))
    return {row.id: row.minor_unit_exponent for row in result}


async def get_savings_rate_history(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    now: datetime,
) -> tuple[list[MonthlyIncomeExpense], FxStatus]:
    """Return per-month income / expense totals for the savings-rate chart

    The series covers ``DASHBOARD_SAVINGS_HISTORY_MONTHS`` calendar months
    ending with the current (in-progress) month, ordered oldest-first. Months
    with no activity are emitted as zeros so every chart slot has a value
    Income/expense categories are netted per category within each month, then
    positive category totals count as income and negative category totals count
    as expenses. Transfers are excluded
    """
    months_count = DASHBOARD_SAVINGS_HISTORY_MONTHS
    first_month = _months_before(now, months_count - 1)
    window_end = _first_of_next_month(now)

    # Build the month sequence up front so missing months still appear as zeros
    months: list[date] = []
    year, month = first_month.year, first_month.month
    for _ in range(months_count):
        months.append(date(year, month, 1))
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1

    empty_history = [MonthlyIncomeExpense(month=m, income=0, expenses=0) for m in months]
    if not accounts:
        return empty_history, FxStatus()

    account_by_id = {account.id: account for account in accounts}
    result = await db.execute(
        select(
            Transaction.dt,
            Transaction.account_id,
            Category.id.label("category_id"),
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(list(account_by_id)),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= first_month,
            Transaction.dt < window_end,
        )
        .group_by(Transaction.dt, Transaction.account_id, Category.id),
    )
    rows = list(result)
    if not rows:
        return empty_history, FxStatus()

    row_currencies = {account_by_id[row.account_id].currency for row in rows}
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *row_currencies},
        ),
    )
    for currency in sorted(row_currencies - {base_currency}):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=first_month,
            end_date=window_end - timedelta(days=1),
        )

    totals = {m: {"income": 0, "expenses": 0} for m in months}
    category_totals: dict[tuple[date, uuid.UUID], int] = {}
    for row in rows:
        # Transaction.amount is stored in the account currency; Transaction.currency is receipt metadata
        total = await converter.convert_minor_units(
            int(row.total or 0),
            base=account_by_id[row.account_id].currency,
            quote=base_currency,
            rate_date=row.dt,
        )
        if total is None:
            continue

        key = (date(row.dt.year, row.dt.month, 1), row.category_id)
        category_totals[key] = category_totals.get(key, 0) + total

    for (month, _category_id), total in category_totals.items():
        if total > 0:
            totals[month]["income"] += total
        elif total < 0:
            totals[month]["expenses"] += -total

    return (
        [
            MonthlyIncomeExpense(
                month=m,
                income=totals[m]["income"],
                expenses=totals[m]["expenses"],
            )
            for m in months
        ],
        converter.get_status(),
    )


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
    """Build x-axis slot labels and per-slot date ranges for ``range_``

    A slot is one spot on the chart's x-axis — a day for WTD/MTD, a week for
    QTD, a month for YTD. ``labels`` covers the full current period (drives
    the x-axis). ``current_ranges`` and ``previous_ranges`` only include
    slots that have real data — ``current`` stops at today, ``previous``
    stops at the prior period's last day (capped at ``len(labels)``)
    """
    if range_ == "WTD":
        # Full Monday-Sunday week drives the x-axis; current fills up to today
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
        # Cap at the x-axis length so previous never extends past the chart
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
        # Weekly slots; the last one may be short (e.g., Q1 non-leap = 90 days, W13 has 6 days)
        n_weeks = (days_in_quarter + 6) // 7
        quarter_last_day = next_q_start - timedelta(days=1)
        labels = [f"W{i + 1}" for i in range(n_weeks)]
        # Current weeks run from quarter start up to the one containing today
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
        # Cap at n_weeks so previous never extends past the chart
        previous_ranges = []
        for i in range(min(prev_weeks, n_weeks)):
            slot_start = prev_quarter_start + timedelta(days=7 * i)
            slot_end = min(slot_start + timedelta(days=6), prev_last_day)
            previous_ranges.append((slot_start, slot_end))
        return labels, current_ranges, previous_ranges

    # YTD — twelve monthly slots; current fills up to today's month
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
    account_by_id: dict[uuid.UUID, Account],
    base_currency: str,
    start: date,
    end: date,
    converter: FxConverter,
) -> dict[date, int]:
    """Return ``{dt: positive_expense_minor_units}`` for ``[start, end]`` inclusive

    Expenses are stored as negative amounts; the mapping flips sign so
    callers can cumsum into positive display values directly
    """
    result = await db.execute(
        select(
            Transaction.dt,
            Transaction.account_id,
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(list(account_by_id)),
            Category.kind == CategoryKind.EXPENSE,
            Transaction.dt >= start,
            Transaction.dt <= end,
        )
        .group_by(Transaction.dt, Transaction.account_id),
    )
    rows = list(result)
    for currency in sorted({account_by_id[row.account_id].currency for row in rows if account_by_id[row.account_id].currency != base_currency}):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=start,
            end_date=end,
        )

    daily: dict[date, int] = {}
    for row in rows:
        # Transaction.amount is stored in the account currency; Transaction.currency is receipt metadata
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=account_by_id[row.account_id].currency,
            quote=base_currency,
            rate_date=row.dt,
        )
        if converted_total is None:
            continue

        daily[row.dt] = daily.get(row.dt, 0) - converted_total
    return daily


def _sum_days(daily: dict[date, int], start: date, end: date) -> int:
    """Sum ``daily`` totals across every date in ``[start, end]`` inclusive"""
    total = 0
    d = start
    while d <= end:
        total += daily.get(d, 0)
        d += timedelta(days=1)
    return total


async def get_spending_comparison(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    range_: RangeKind,
    now: datetime,
) -> SpendingComparisonResponse:
    """Return current-vs-prior cumulative expense series for ``range_``

    See :class:`SpendingComparisonResponse` for payload shape. ``current``
    and ``previous`` only include slots with real data — the frontend zips
    by index and treats missing trailing entries as no data
    """
    labels, current_ranges, previous_ranges = _plan_spending_comparison(range_, now.date())

    if not accounts:
        return SpendingComparisonResponse(
            range=range_,
            slot_labels=labels,
            current=[0] * len(current_ranges),
            previous=[0] * len(previous_ranges),
            fx_status=FxStatus(),
        )

    account_by_id = {account.id: account for account in accounts}
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts)},
        ),
    )
    current_daily_spend = (
        await _query_daily_expense(
            db,
            account_by_id,
            base_currency,
            current_ranges[0][0],
            current_ranges[-1][1],
            converter,
        )
        if current_ranges
        else {}
    )
    previous_daily_spend = (
        await _query_daily_expense(
            db,
            account_by_id,
            base_currency,
            previous_ranges[0][0],
            previous_ranges[-1][1],
            converter,
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
        fx_status=converter.get_status(),
    )


# ---------------------------------------------------------------------------
# Spending / income breakdown (range-scoped)
# ---------------------------------------------------------------------------

def _current_period_bounds(range_: RangeKind, today: date) -> tuple[date, date]:
    """Return ``(start, today)`` bounds for the current ``range_``

    Matches the current-period start used by ``_plan_spending_comparison`` so
    the dashboard widgets share the same calendar window
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
    accounts: list[Account],
    base_currency: str,
    range_: RangeKind,
    now: datetime,
) -> SpendingBreakdownResponse:
    """Return category-level expense and income totals for ``range_``

    Aggregates transactions on accessible accounts between the range's
    current-period start and today. Foreign-currency account activity is
    converted at transaction-date granularity. Negative category totals render
    as spending, and positive category totals render as income. The original
    category kind is preserved so the frontend can mark flipped categories
    Categories with zero totals are dropped; entries are sorted largest-first
    and compacted into an Other slice when the dashboard donut has too many
    small categories. Flipped categories stay visible so their badge context
    is never swallowed by Other
    """
    start, end = _current_period_bounds(range_, now.date())
    if not accounts:
        return SpendingBreakdownResponse(
            range=range_,
            expense=[],
            income=[],
            expense_total=0,
            income_total=0,
            fx_status=FxStatus(),
        )

    account_by_id = {account.id: account for account in accounts}
    result = await db.execute(
        select(
            Transaction.dt,
            Transaction.account_id,
            Category.id,
            Category.name,
            Category.kind,
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .where(
            Transaction.account_id.in_(list(account_by_id)),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= start,
            Transaction.dt <= end,
        )
        .group_by(Transaction.dt, Transaction.account_id, Category.id, Category.name, Category.kind),
    )
    rows = list(result)
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts)},
        ),
    )
    for currency in sorted({account_by_id[row.account_id].currency for row in rows if account_by_id[row.account_id].currency != base_currency}):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=start,
            end_date=end,
        )

    category_totals: dict[uuid.UUID, tuple[str, CategoryKind, int]] = {}
    for row in rows:
        # Transaction.amount is stored in the account currency; Transaction.currency is receipt metadata
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=account_by_id[row.account_id].currency,
            quote=base_currency,
            rate_date=row.dt,
        )
        if converted_total is None:
            continue

        name, kind, current_total = category_totals.get(row.id, (row.name, row.kind, 0))
        category_totals[row.id] = (name, kind, current_total + converted_total)

    expense: list[CategoryBreakdownEntry] = []
    income: list[CategoryBreakdownEntry] = []
    for category_id, (name, kind, total) in category_totals.items():
        if total < 0:
            expense.append(CategoryBreakdownEntry(
                category_id=category_id,
                name=name,
                category_kind=kind,
                amount=-total,
            ))
            continue

        if total > 0:
            income.append(CategoryBreakdownEntry(
                category_id=category_id,
                name=name,
                category_kind=kind,
                amount=total,
            ))

    expense.sort(key=lambda e: (-e.amount, e.name))
    income.sort(key=lambda e: (-e.amount, e.name))
    expense_refunds = sum(entry.amount for entry in income if entry.category_kind == CategoryKind.EXPENSE)
    income_losses = sum(entry.amount for entry in expense if entry.category_kind == CategoryKind.INCOME)
    return SpendingBreakdownResponse(
        range=range_,
        expense=_dashboard_breakdown_entries(expense, CategoryKind.EXPENSE),
        income=_dashboard_breakdown_entries(income, CategoryKind.INCOME),
        expense_total=max(sum(entry.amount for entry in expense) - expense_refunds, 0),
        income_total=max(sum(entry.amount for entry in income) - income_losses, 0),
        fx_status=converter.get_status(),
    )


def _dashboard_breakdown_entries(
    entries: list[CategoryBreakdownEntry],
    kind: CategoryKind,
) -> list[CategoryBreakdownEntry]:
    """Return visible dashboard slices plus one Other slice for same-kind hidden rows"""
    visible = entries[:DASHBOARD_BREAKDOWN_CATEGORY_LIMIT]
    hidden = entries[DASHBOARD_BREAKDOWN_CATEGORY_LIMIT:]
    flipped_hidden = [entry for entry in hidden if entry.category_kind != kind]
    other_amount = sum(entry.amount for entry in hidden if entry.category_kind == kind)
    if other_amount <= 0:
        return [*visible, *flipped_hidden]

    return [
        *visible,
        *flipped_hidden,
        CategoryBreakdownEntry(
            category_id=uuid.uuid5(uuid.NAMESPACE_URL, f"dashboard-{kind.value}-other"),
            name="Other",
            category_kind=kind,
            amount=other_amount,
        ),
    ]
