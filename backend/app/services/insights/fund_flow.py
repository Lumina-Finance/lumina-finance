"""Fund Flow service for the insights page."""

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
from app.schemas.insights import InsightsFundFlowResponse
from app.services.dashboard import get_accessible_accounts
from app.services.fx import FxConverter

FlowCategoryTotals = dict[uuid.UUID, tuple[str, CategoryKind, int]]


async def _query_flow_entries(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
) -> tuple[
    list[tuple[str, int]],
    list[tuple[str, int]],
    list[tuple[str, int]],
    list[tuple[str, int]],
    FxStatus,
]:
    """Return sign-directed category totals converted to the user's base currency."""
    if not accounts:
        return [], [], [], [], FxStatus()

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
    converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts)},
        ),
    )
    await _prefetch_flow_rates(
        converter,
        rows=rows,
        base_currency=base_currency,
    )

    category_totals = await _convert_flow_totals(
        rows=rows,
        converter=converter,
        base_currency=base_currency,
    )
    inflows: list[tuple[str, int]] = []
    outflows: list[tuple[str, int]] = []
    expense_inflows: list[tuple[str, int]] = []
    income_outflows: list[tuple[str, int]] = []
    for name, kind, total in category_totals.values():
        if total > 0:
            inflows.append((name, total))
            if kind == CategoryKind.EXPENSE:
                expense_inflows.append((name, total))
        elif total < 0:
            amount = -total
            outflows.append((name, amount))
            if kind == CategoryKind.INCOME:
                income_outflows.append((name, amount))

    def sorted_entries(entries: list[tuple[str, int]]) -> list[tuple[str, int]]:
        return sorted(entries, key=lambda entry: (-entry[1], entry[0]))

    return (
        sorted_entries(inflows),
        sorted_entries(outflows),
        sorted_entries(income_outflows),
        sorted_entries(expense_inflows),
        converter.get_status(),
    )


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    return {row.id: row.minor_unit_exponent for row in result}


async def _prefetch_flow_rates(
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


async def _convert_flow_totals(
    *,
    rows,
    converter: FxConverter,
    base_currency: str,
) -> FlowCategoryTotals:
    totals: FlowCategoryTotals = {}
    for row in rows:
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=row.account_currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_total is None:
            continue

        name, kind, current_total = totals.get(row.id, (row.name, row.kind, 0))
        totals[row.id] = (name, kind, current_total + converted_total)

    return {
        category_id: (name, kind, amount)
        for category_id, (name, kind, amount) in totals.items()
        if amount
    }


async def get_fund_flow(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsFundFlowResponse:
    """Return all converted positive entries for the Fund Flow card."""
    accounts = await get_accessible_accounts(db, user)

    if not accounts:
        return InsightsFundFlowResponse(
            income_sources=[],
            expense_categories=[],
            income_outflows=[],
            expense_inflows=[],
            income_source_count=0,
            expense_category_count=0,
        )

    income_sources, expense_categories, income_outflows, expense_inflows, fx_status = await _query_flow_entries(
        db,
        accounts,
        user.base_currency,
        from_date,
        to_date,
    )

    return InsightsFundFlowResponse(
        income_sources=income_sources,
        expense_categories=expense_categories,
        income_outflows=income_outflows,
        expense_inflows=expense_inflows,
        income_source_count=len(income_sources),
        expense_category_count=len(expense_categories),
        fx_status=fx_status,
    )
