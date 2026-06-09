"""Period glance service for the insights page."""

import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.fx import FxStatus
from app.schemas.insights import InsightsComparisonPeriod, InsightsPeriodGlanceResponse
from app.services.dashboard import get_accessible_accounts
from app.services.fx import FxConverter
from app.services.insights.common import comparison_period_bounds
from app.services.insights.period_glance_category_highlights import (
    CategoryNetTotals,
    get_period_glance_biggest_category_change,
    get_period_glance_top_category,
)
from app.services.insights.period_glance_net_worth import get_period_glance_net_worth_change


async def _query_period_totals(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
) -> tuple[int, int, FxStatus]:
    """Return sign-directed income and expense totals converted to base currency."""
    if not accounts:
        return 0, 0, FxStatus()

    account_ids = [account.id for account in accounts]
    result = await db.execute(
        select(
            Category.id,
            Transaction.account_id,
            Transaction.dt.label("date"),
            Account.currency.label("account_currency"),
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= from_date,
            Transaction.dt <= to_date,
        )
        .group_by(Category.id, Transaction.account_id, Transaction.dt, Account.currency),
    )
    rows = result.all()
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts)},
        ),
    )
    await _prefetch_period_total_rates(
        converter,
        rows=rows,
        base_currency=base_currency,
    )

    category_totals: dict[uuid.UUID, int] = {}
    for row in rows:
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=row.account_currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_total is None:
            continue
        category_totals[row.id] = category_totals.get(row.id, 0) + converted_total

    income = 0
    expenses = 0
    for total in category_totals.values():
        if total > 0:
            income += total
        elif total < 0:
            expenses += -total

    return income, expenses, converter.get_status()


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    return {row.id: row.minor_unit_exponent for row in result}


async def _prefetch_period_total_rates(
    converter: FxConverter,
    *,
    rows,
    base_currency: str,
) -> None:
    ranges: dict[str, tuple[date, date]] = {}
    for row in rows:
        currency = row.account_currency
        if currency == base_currency:
            continue
        start, end = ranges.get(currency, (row.date, row.date))
        ranges[currency] = (min(start, row.date), max(end, row.date))

    for currency, (start_date, end_date) in sorted(ranges.items()):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=start_date,
            end_date=end_date,
        )


async def _query_category_net_totals(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
    converter: FxConverter,
) -> CategoryNetTotals:
    """Return converted signed category totals keyed by category id for an inclusive period."""
    if not accounts:
        return {}

    account_ids = [account.id for account in accounts]
    result = await db.execute(
        select(
            Category.id,
            Category.name,
            Category.kind,
            Transaction.account_id,
            Transaction.dt.label("date"),
            Account.currency.label("account_currency"),
            func.sum(Transaction.amount).label("total"),
        )
        .join(Category, Transaction.category_id == Category.id)
        .join(Account, Transaction.account_id == Account.id)
        .where(
            Transaction.account_id.in_(account_ids),
            Category.kind.in_([CategoryKind.INCOME, CategoryKind.EXPENSE]),
            Transaction.dt >= from_date,
            Transaction.dt <= to_date,
        )
        .group_by(Category.id, Category.name, Category.kind, Transaction.account_id, Transaction.dt, Account.currency),
    )
    rows = result.all()
    await _prefetch_period_total_rates(
        converter,
        rows=rows,
        base_currency=base_currency,
    )

    raw_totals: dict[uuid.UUID, tuple[str, CategoryKind, int]] = {}
    for row in rows:
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=row.account_currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_total is None:
            continue
        name, kind, current_total = raw_totals.get(row.id, (row.name, row.kind, 0))
        raw_totals[row.id] = (name, kind, current_total + converted_total)

    return {
        category_id: (name, kind, amount)
        for category_id, (name, kind, amount) in raw_totals.items()
        if amount
    }


async def get_period_glance(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
    comparison_period: InsightsComparisonPeriod = "same_length",
) -> InsightsPeriodGlanceResponse:
    """Return compact insight totals for the top period-glance card."""
    previous_from_date, previous_to_date = comparison_period_bounds(from_date, to_date, comparison_period)
    all_accounts = await get_accessible_accounts(db, user)

    if not all_accounts:
        return InsightsPeriodGlanceResponse(
            income=0,
            expenses=0,
            net_worth_change=0,
        )

    income, expenses, income_expense_fx_status = await _query_period_totals(
        db,
        all_accounts,
        user.base_currency,
        from_date,
        to_date,
    )
    top_category_converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {user.base_currency, *(account.currency for account in all_accounts)},
        ),
    )
    current_top_category_net_totals = await _query_category_net_totals(
        db,
        all_accounts,
        user.base_currency,
        from_date,
        to_date,
        top_category_converter,
    )
    biggest_change_converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {user.base_currency, *(account.currency for account in all_accounts)},
        ),
    )
    current_category_net_totals = await _query_category_net_totals(
        db,
        all_accounts,
        user.base_currency,
        from_date,
        to_date,
        biggest_change_converter,
    )
    previous_category_net_totals = await _query_category_net_totals(
        db,
        all_accounts,
        user.base_currency,
        previous_from_date,
        previous_to_date,
        biggest_change_converter,
    )
    net_worth_change, net_worth_change_fx_status = await get_period_glance_net_worth_change(
        db,
        all_accounts,
        user.base_currency,
        from_date,
        to_date,
    )
    top_category = get_period_glance_top_category(current_top_category_net_totals)
    top_category_fx_status = top_category_converter.get_status()
    biggest_change = get_period_glance_biggest_category_change(current_category_net_totals, previous_category_net_totals)
    biggest_change_fx_status = biggest_change_converter.get_status()

    return InsightsPeriodGlanceResponse(
        income=income,
        expenses=expenses,
        income_expense_fx_status=income_expense_fx_status,
        net_worth_change=net_worth_change,
        net_worth_change_fx_status=net_worth_change_fx_status,
        top_category_name=top_category[0] if top_category else None,
        top_category_share_pct=top_category[1] if top_category else None,
        top_category_fx_status=top_category_fx_status,
        biggest_change_name=biggest_change[0] if biggest_change else None,
        biggest_change_amount=biggest_change[1] if biggest_change else None,
        biggest_change_pct=biggest_change[2] if biggest_change else None,
        biggest_change_fx_status=biggest_change_fx_status,
    )
