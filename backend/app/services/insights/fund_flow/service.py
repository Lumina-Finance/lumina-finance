"""Fund-flow service for the insights page"""

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
FlowEntry = tuple[str, int]
FundFlowEntryGroups = tuple[
    list[FlowEntry],
    list[FlowEntry],
    list[FlowEntry],
    list[FlowEntry],
    FxStatus,
]


async def _get_fund_flow_entries(
    db: AsyncSession,
    accounts: list[Account],
    base_currency: str,
    from_date: date,
    to_date: date,
) -> FundFlowEntryGroups:
    """Return converted fund-flow entry groups for the selected date range

    Args:
        db: Active database session
        accounts: Accounts included in the fund-flow insight
        base_currency: User base currency used for converted values
        from_date: Inclusive fund-flow range start date
        to_date: Inclusive fund-flow range end date

    Returns:
        Income sources, expense categories, income outflows, expense inflows, and FX status
    """
    if not accounts:
        fx_status = FxStatus()
        return [], [], [], [], fx_status

    account_ids = [account.id for account in accounts]

    # Load category totals grouped by account currency and date for FX conversion
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
    inflows: list[FlowEntry] = []
    outflows: list[FlowEntry] = []
    expense_inflows: list[FlowEntry] = []
    income_outflows: list[FlowEntry] = []

    # Split signed category totals into the four response groups
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

    fx_status = converter.get_status()
    entry_groups = (
        _get_sorted_flow_entries(inflows),
        _get_sorted_flow_entries(outflows),
        _get_sorted_flow_entries(income_outflows),
        _get_sorted_flow_entries(expense_inflows),
        fx_status,
    )
    return entry_groups


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Return minor-unit exponents keyed by currency code

    Args:
        db: Active database session
        currencies: Currency codes needed for conversion

    Returns:
        Minor-unit exponent keyed by currency code
    """
    # Load currency precision so FX conversion can convert minor units correctly
    result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    exponents_by_currency = {row.id: row.minor_unit_exponent for row in result}
    return exponents_by_currency


async def _prefetch_flow_rates(
    converter: FxConverter,
    *,
    rows,
    base_currency: str,
) -> None:
    """Prefetch FX rates required by fund-flow rows

    Args:
        converter: FX converter used by the fund-flow insight calculation
        rows: Grouped fund-flow transaction rows that may require FX conversion
        base_currency: User base currency used for converted values

    Returns:
        None
    """
    ranges: dict[str, tuple[date, date]] = {}

    # Build one date range per foreign currency to avoid prefetching each row individually
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
    """Return converted fund-flow category totals keyed by category ID

    Args:
        rows: Grouped fund-flow transaction rows
        converter: FX converter used by the fund-flow insight calculation
        base_currency: User base currency used for converted values

    Returns:
        Non-zero converted category totals keyed by category ID
    """
    totals: FlowCategoryTotals = {}

    # Convert each grouped total and merge rows by category before sign classification
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

    category_totals = {
        category_id: (name, kind, amount)
        for category_id, (name, kind, amount) in totals.items()
        if amount
    }
    return category_totals


def _get_sorted_flow_entries(entries: list[FlowEntry]) -> list[FlowEntry]:
    """Return fund-flow entries sorted by amount and name

    Args:
        entries: Fund-flow entries to sort

    Returns:
        Entries sorted by descending amount and then ascending name
    """
    sorted_entries = sorted(entries, key=lambda entry: (-entry[1], entry[0]))
    return sorted_entries


async def get_fund_flow(
    db: AsyncSession,
    user: User,
    from_date: date,
    to_date: date,
) -> InsightsFundFlowResponse:
    """Return all converted entries for the Fund Flow card

    Args:
        db: Active database session
        user: User requesting the fund-flow insight
        from_date: Inclusive fund-flow range start date
        to_date: Inclusive fund-flow range end date

    Returns:
        Fund-flow response payload
    """
    # Load accounts the user can read before aggregating fund-flow totals
    accounts = await get_accessible_accounts(db, user)

    if not accounts:
        response = InsightsFundFlowResponse(
            income_sources=[],
            expense_categories=[],
            income_outflows=[],
            expense_inflows=[],
            income_source_count=0,
            expense_category_count=0,
        )
        return response

    income_sources, expense_categories, income_outflows, expense_inflows, fx_status = await _get_fund_flow_entries(
        db,
        accounts,
        user.base_currency,
        from_date,
        to_date,
    )

    response = InsightsFundFlowResponse(
        income_sources=income_sources,
        expense_categories=expense_categories,
        income_outflows=income_outflows,
        expense_inflows=expense_inflows,
        income_source_count=len(income_sources),
        expense_category_count=len(expense_categories),
        fx_status=fx_status,
    )
    return response
