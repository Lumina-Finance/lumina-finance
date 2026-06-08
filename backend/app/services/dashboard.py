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
import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountPermission
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.group import GroupMember
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.dashboard import (
    CategoryBreakdownEntry,
    RangeKind,
    SpendingBreakdownResponse,
)
from app.schemas.fx import FxStatus
from app.services.fx import FxConverter

DASHBOARD_BREAKDOWN_CATEGORY_LIMIT = 6

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


# ---------------------------------------------------------------------------
# Spending / income breakdown (range-scoped)
# ---------------------------------------------------------------------------

def _current_period_bounds(range_: RangeKind, today: date) -> tuple[date, date]:
    """Return ``(start, today)`` bounds for the current ``range_``

    Matches the calendar windows used by the spending-comparison widget so
    dashboard totals stay aligned
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
    Categories with zero totals are dropped, and entries are sorted largest-first
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
        # Transaction.amount uses the account currency, while Transaction.currency is receipt metadata
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
