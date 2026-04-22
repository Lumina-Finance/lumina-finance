"""Account data enrichment helpers.

Helpers here run as part of the detail-shape endpoints (`GET /accounts/{id}`,
`POST /accounts`, `PATCH /accounts/{id}`) to attach derived fields to an
Account instance before Pydantic serializes it. They live outside the route
module so the SQL stays testable and the route handlers stay lean.
"""
import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, TaxAdvantagedConfig
from app.models.base import CategoryKind, TaxTreatment
from app.models.category import Category
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.schemas.account import (
    AccountSpendingBreakdown,
    AccountTopCategory,
    AccountTopMerchant,
)
from app.schemas.dashboard import RangeKind

_TOP_N = 5


async def attach_tax_advantaged_tallies(db: AsyncSession, accounts: Sequence[Account]) -> None:
    """Set ytd/lifetime contribution and withdrawal tallies on each account in place.

    Sources the tallies from transfer-kind transactions (``Category.kind == TRANSFER``)
    on the account: positive amounts sum into contributions, negative amounts sum
    (absolute) into withdrawals. YTD uses the current UTC calendar year.

    Gating, applied per-account in Python:
    - ``tax_treatment == TAXABLE`` — all four fields set to None, no SQL issued.
    - Otherwise — YTD fields populated (zero if no activity).
    - Lifetime fields populated only when ``lifetime_contribution_limit`` is set; null otherwise.
    """
    if not accounts:
        return

    tax_advantaged = [a for a in accounts if a.tax_treatment != TaxTreatment.TAXABLE]

    tallies: dict[uuid.UUID, dict[str, int]] = {}
    if tax_advantaged:
        current_year = datetime.now(UTC).year
        year_start = date(current_year, 1, 1)
        year_end = date(current_year + 1, 1, 1)

        in_year = (Transaction.dt >= year_start) & (Transaction.dt < year_end)
        positive = Transaction.amount > 0
        negative = Transaction.amount < 0

        result = await db.execute(
            select(
                Transaction.account_id,
                func.coalesce(
                    func.sum(case((in_year & positive, Transaction.amount), else_=0)),
                    0,
                ).label("ytd_contributions"),
                func.coalesce(
                    func.sum(case((in_year & negative, -Transaction.amount), else_=0)),
                    0,
                ).label("ytd_withdrawals"),
                func.coalesce(
                    func.sum(case((positive, Transaction.amount), else_=0)),
                    0,
                ).label("lifetime_contributions"),
                func.coalesce(
                    func.sum(case((negative, -Transaction.amount), else_=0)),
                    0,
                ).label("lifetime_withdrawals"),
            )
            .join(Category, Transaction.category_id == Category.id)
            .where(
                Transaction.account_id.in_([a.id for a in tax_advantaged]),
                Category.kind == CategoryKind.TRANSFER,
            )
            .group_by(Transaction.account_id),
        )
        for row in result:
            tallies[row.account_id] = {
                "ytd_contributions": row.ytd_contributions,
                "ytd_withdrawals": row.ytd_withdrawals,
                "lifetime_contributions": row.lifetime_contributions,
                "lifetime_withdrawals": row.lifetime_withdrawals,
            }

    for account in accounts:
        if account.tax_treatment == TaxTreatment.TAXABLE:
            account.ytd_contributions = None
            account.ytd_withdrawals = None
            account.lifetime_contributions = None
            account.lifetime_withdrawals = None
            continue

        row = tallies.get(account.id)
        account.ytd_contributions = row["ytd_contributions"] if row else 0
        account.ytd_withdrawals = row["ytd_withdrawals"] if row else 0
        if account.lifetime_contribution_limit is not None:
            account.lifetime_contributions = row["lifetime_contributions"] if row else 0
            account.lifetime_withdrawals = row["lifetime_withdrawals"] if row else 0
        else:
            account.lifetime_contributions = None
            account.lifetime_withdrawals = None


async def attach_current_year_tax_limits(db: AsyncSession, accounts: Sequence[Account]) -> None:
    """Set current-year contribution/withdrawal limits on each account in place.

    Sources the limits from ``TaxAdvantagedConfig`` rows whose ``year`` matches
    the current UTC calendar year. Taxable accounts short-circuit to None without
    issuing SQL. For tax-advantaged accounts with no config row for the year,
    both fields are set to None.
    """
    if not accounts:
        return

    tax_advantaged = [a for a in accounts if a.tax_treatment != TaxTreatment.TAXABLE]

    limits: dict[uuid.UUID, tuple[int, int | None]] = {}
    if tax_advantaged:
        current_year = datetime.now(UTC).year
        result = await db.execute(
            select(
                TaxAdvantagedConfig.account_id,
                TaxAdvantagedConfig.contribution_limit,
                TaxAdvantagedConfig.withdrawal_limit,
            ).where(
                TaxAdvantagedConfig.account_id.in_([a.id for a in tax_advantaged]),
                TaxAdvantagedConfig.year == current_year,
            ),
        )
        for row in result:
            limits[row.account_id] = (row.contribution_limit, row.withdrawal_limit)

    for account in accounts:
        if account.tax_treatment == TaxTreatment.TAXABLE:
            account.current_year_contribution_limit = None
            account.current_year_withdrawal_limit = None
            continue

        row = limits.get(account.id)
        if row is None:
            account.current_year_contribution_limit = None
            account.current_year_withdrawal_limit = None
        else:
            account.current_year_contribution_limit = row[0]
            account.current_year_withdrawal_limit = row[1]


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
