"""Transaction overview aggregation service"""
import uuid
from datetime import date, timedelta
from typing import Literal

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.fx import FxStatus
from app.schemas.transaction import DailyCashFlow, OutlierTransaction, TopCategorySpend, TransactionsOverview
from app.services.fx import FxConverter
from app.services.transactions.access import accessible_account_ids_subquery
from app.services.transactions.overview_queries import (
    get_overview_cash_flow_rows,
    get_overview_category_total_rows,
    get_overview_outlier_candidate_rows,
)

OverviewCashFlowGranularity = Literal["day", "week", "month"]
_MONTHLY_RANGE_DAY_COUNT = 31
_HALF_YEAR_DAY_COUNT = 183


async def get_transactions_overview(
    db: AsyncSession,
    user: User,
    *,
    from_date: date | None = None,
    to_date: date | None = None,
    account_id: uuid.UUID | None = None,
) -> TransactionsOverview:
    """Return aggregated transaction metrics for the user's accessible accounts

    The service builds a shared transaction scope, runs separate aggregate
    queries for each overview panel, and reuses prefetched FX rates while each
    panel reports its own conversion status

    Args:
        db: Active database session
        user: Authenticated user requesting the overview
        from_date: Optional inclusive start date for the transaction window
        to_date: Optional inclusive end date for the transaction window
        account_id: Optional account filter applied within the user's accessible accounts

    Returns:
        Aggregated inflow, outflow, category, cash-flow, and outlier metrics for
        the selected transaction window

    Raises:
        HTTPException: Raised with 422 when ``from_date`` is after ``to_date``
    """
    if from_date is not None and to_date is not None and from_date > to_date:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Start date must be before end date")

    accessible_account_ids_query = accessible_account_ids_subquery(user.id)

    transaction_query = select(Transaction).where(Transaction.account_id.in_(accessible_account_ids_query))
    if account_id is not None:
        transaction_query = transaction_query.where(Transaction.account_id == account_id)
    if from_date is not None:
        transaction_query = transaction_query.where(Transaction.dt >= from_date)
    if to_date is not None:
        transaction_query = transaction_query.where(Transaction.dt <= to_date)

    transaction_filters = transaction_query.whereclause

    matching_transaction_query = select(sa.literal(1)).where(transaction_filters).limit(1)
    # Check for any matching transaction before running the heavier overview aggregate queries
    if (await db.execute(matching_transaction_query)).scalar_one_or_none() is None:
        return TransactionsOverview(
            total_inflow=None,
            total_outflow=None,
            top_categories=None,
            daily_cash_flow=None,
            outliers=None,
        )

    # Each overview panel uses the same transaction scope but needs a different aggregate shape
    cash_flow_rows = await get_overview_cash_flow_rows(db, transaction_filters)
    category_total_rows = await get_overview_category_total_rows(db, transaction_filters)
    outlier_candidate_rows = await get_overview_outlier_candidate_rows(db, transaction_filters)
    currency_conversion_rows = [*cash_flow_rows, *category_total_rows, *outlier_candidate_rows]
    accounts_by_id = await _get_overview_accounts_by_id(db, currency_conversion_rows)
    shared_converter = await _get_overview_converter(
        db,
        accounts_by_id=accounts_by_id,
        base_currency=user.base_currency,
    )
    # Prefetch rates once, then fork converter state so each panel reports its own FX status
    await _prefetch_overview_rates(
        shared_converter,
        conversion_rows=currency_conversion_rows,
        accounts_by_id=accounts_by_id,
        base_currency=user.base_currency,
    )
    top_categories, top_categories_fx_status = await _convert_overview_top_categories(
        category_total_rows=category_total_rows,
        accounts_by_id=accounts_by_id,
        converter=_fork_overview_converter(shared_converter),
        base_currency=user.base_currency,
    )
    daily_cash_flow, daily_cash_flow_fx_status = await _convert_overview_daily_cash_flow(
        cash_flow_rows=cash_flow_rows,
        accounts_by_id=accounts_by_id,
        converter=_fork_overview_converter(shared_converter),
        base_currency=user.base_currency,
        from_date=from_date,
        to_date=to_date,
    )
    total_inflow, total_outflow = _sum_overview_net_flow(daily_cash_flow)
    outliers, outliers_fx_status = await _convert_overview_outliers(
        category_total_rows=category_total_rows,
        outlier_candidate_rows=outlier_candidate_rows,
        accounts_by_id=accounts_by_id,
        converter=_fork_overview_converter(shared_converter),
        base_currency=user.base_currency,
    )

    return TransactionsOverview(
        total_inflow=total_inflow,
        total_outflow=total_outflow,
        net_flow_fx_status=daily_cash_flow_fx_status,
        top_categories=top_categories,
        top_categories_fx_status=top_categories_fx_status,
        daily_cash_flow=daily_cash_flow,
        daily_cash_flow_fx_status=daily_cash_flow_fx_status,
        outliers=outliers,
        outliers_fx_status=outliers_fx_status,
    )


async def _get_currency_exponents(db: AsyncSession, currencies: set[str]) -> dict[str, int]:
    """Load minor-unit exponents for currency codes

    Overview conversion uses these exponents to interpret aggregate values in
    minor units before converting them to the user's base currency

    Args:
        db: Active database session
        currencies: Currency codes to load

    Returns:
        Mapping from currency code to minor-unit exponent
    """
    # Load exponent metadata for every currency needed by overview conversions
    currency_result = await db.execute(
        select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currencies)),
    )
    return {row.id: row.minor_unit_exponent for row in currency_result}


async def _get_overview_accounts_by_id(db: AsyncSession, conversion_rows) -> dict[uuid.UUID, Account]:
    """Load accounts required for overview currency conversion

    Aggregate rows keep account IDs instead of account models, so this helper
    batches parent account loading and returns the account currency lookup used
    by every overview converter

    Args:
        db: Active database session
        conversion_rows: Overview query rows that reference account IDs

    Returns:
        Account rows keyed by account ID
    """
    account_ids = {row.account_id for row in conversion_rows}
    # Fetch accounts referenced by aggregate rows so conversion uses the account currency
    accounts = (
        (await db.execute(select(Account).where(Account.id.in_(account_ids)))).scalars().all()
        if account_ids
        else []
    )
    return {account.id: account for account in accounts}


async def _get_overview_converter(
    db: AsyncSession,
    *,
    accounts_by_id: dict[uuid.UUID, Account],
    base_currency: str,
) -> FxConverter:
    """Create an FX converter for overview account currencies

    Args:
        db: Active database session
        accounts_by_id: Account rows keyed by account ID
        base_currency: User base currency used for overview metrics

    Returns:
        FX converter loaded with the required currency exponents
    """
    return FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {base_currency, *(account.currency for account in accounts_by_id.values())},
        ),
    )


async def _prefetch_overview_rates(
    converter: FxConverter,
    *,
    conversion_rows,
    accounts_by_id: dict[uuid.UUID, Account],
    base_currency: str,
) -> None:
    """Prefetch FX rates needed for overview conversion rows

    Args:
        converter: Request-scoped FX converter that caches prefetched rates
        conversion_rows: Overview query rows that need currency conversion
        accounts_by_id: Account rows keyed by account ID
        base_currency: User base currency used for overview metrics

    Returns:
        None
    """
    if conversion_rows:
        start_date = min(row.date for row in conversion_rows)
        end_date = max(row.date for row in conversion_rows)
        for currency in sorted({
            accounts_by_id[row.account_id].currency
            for row in conversion_rows
            if accounts_by_id[row.account_id].currency != base_currency
        }):
            await converter.prefetch_rates(
                base=currency,
                quote=base_currency,
                start_date=start_date,
                end_date=end_date,
            )


def _fork_overview_converter(converter: FxConverter) -> FxConverter:
    """Clone a converter's cached state for an overview metric

    Args:
        converter: Shared overview converter with prefetched rates

    Returns:
        New converter instance with copied rate and failure caches
    """
    cloned_converter = FxConverter(
        provider=converter.provider,
        currency_exponents=converter.currency_exponents,
    )
    cloned_converter.rates = converter.rates.copy()
    cloned_converter.failed_rates = converter.failed_rates.copy()
    return cloned_converter


def _get_overview_cash_flow_granularity(from_date: date, to_date: date) -> OverviewCashFlowGranularity:
    """Choose the cash-flow bucket granularity for a date range

    Args:
        from_date: Inclusive start date for the overview window
        to_date: Inclusive end date for the overview window

    Returns:
        Bucket granularity used for cash-flow chart rows
    """
    day_count = (to_date - from_date).days + 1
    if day_count <= _MONTHLY_RANGE_DAY_COUNT:
        return "day"
    if day_count <= _HALF_YEAR_DAY_COUNT:
        return "week"
    return "month"


def _overview_cash_flow_bucket_key(
    target: date,
    granularity: OverviewCashFlowGranularity,
) -> tuple[int, ...]:
    """Build a comparable bucket key for a cash-flow date

    Args:
        target: Date being assigned to a cash-flow bucket
        granularity: Bucket granularity selected for the overview range

    Returns:
        Tuple key identifying the date's day, week, or month bucket
    """
    if granularity == "day":
        return (target.year, target.month, target.day)
    if granularity == "week":
        iso_year, iso_week, _weekday = target.isocalendar()
        return (iso_year, iso_week)
    return (target.year, target.month)


def _build_overview_cash_flow_buckets(from_date: date, to_date: date) -> list[tuple[date, date]]:
    """Build contiguous cash-flow buckets for an overview range

    Args:
        from_date: Inclusive start date for the overview window
        to_date: Inclusive end date for the overview window

    Returns:
        Ordered list of inclusive bucket start and end dates
    """
    granularity = _get_overview_cash_flow_granularity(from_date, to_date)
    buckets: list[tuple[date, date]] = []
    bucket_start = from_date
    current_key = _overview_cash_flow_bucket_key(from_date, granularity)
    current_date = from_date

    # Walk by day so partial first and last weeks/months stay inside the requested range
    while current_date <= to_date:
        bucket_key = _overview_cash_flow_bucket_key(current_date, granularity)
        if bucket_key != current_key:
            buckets.append((bucket_start, current_date - timedelta(days=1)))
            bucket_start = current_date
            current_key = bucket_key
        current_date += timedelta(days=1)

    buckets.append((bucket_start, to_date))
    return buckets


def _bucket_overview_daily_cash_flow(
    daily_totals: dict[date, tuple[int, int]],
    *,
    from_date: date,
    to_date: date,
) -> list[DailyCashFlow]:
    """Aggregate daily cash-flow totals into overview buckets

    Args:
        daily_totals: Mapping from date to inflow and outflow totals
        from_date: Inclusive start date for the overview window
        to_date: Inclusive end date for the overview window

    Returns:
        Cash-flow rows grouped into the selected bucket size
    """
    daily_cash_flow: list[DailyCashFlow] = []
    for bucket_start, bucket_end in _build_overview_cash_flow_buckets(from_date, to_date):
        inflow = 0
        outflow = 0
        current_date = bucket_start
        while current_date <= bucket_end:
            day_inflow, day_outflow = daily_totals.get(current_date, (0, 0))
            inflow += day_inflow
            outflow += day_outflow
            current_date += timedelta(days=1)
        daily_cash_flow.append(DailyCashFlow(
            date=bucket_start,
            end_date=bucket_end,
            inflow=inflow,
            outflow=outflow,
        ))
    return daily_cash_flow


async def _convert_overview_daily_cash_flow(
    *,
    cash_flow_rows,
    accounts_by_id: dict[uuid.UUID, Account],
    converter: FxConverter,
    base_currency: str,
    from_date: date | None,
    to_date: date | None,
) -> tuple[list[DailyCashFlow], FxStatus]:
    """Convert cash-flow query rows into response rows

    Args:
        cash_flow_rows: Query rows containing account-level inflow and outflow totals
        accounts_by_id: Account rows keyed by account ID
        converter: Request-scoped FX converter
        base_currency: User base currency used for overview metrics
        from_date: Optional inclusive start date for the overview window
        to_date: Optional inclusive end date for the overview window

    Returns:
        Converted cash-flow response rows and FX status for the conversion
    """
    daily_totals: dict[date, tuple[int, int]] = {}
    for row in cash_flow_rows:
        currency = accounts_by_id[row.account_id].currency
        row_inflow = int(row.inflow or 0)
        row_outflow = int(row.outflow or 0)
        converted_inflow = await converter.convert_minor_units(
            row_inflow,
            base=currency,
            quote=base_currency,
            rate_date=row.date,
        )
        converted_outflow = await converter.convert_minor_units(
            row_outflow,
            base=currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if (
            (row_inflow == 0 or converted_inflow is None)
            and (row_outflow == 0 or converted_outflow is None)
        ):
            continue
        # Keep partial rows when one side converts and the other side is zero or unavailable
        inflow, outflow = daily_totals.get(row.date, (0, 0))
        daily_totals[row.date] = (
            inflow + (converted_inflow or 0),
            outflow + (converted_outflow or 0),
        )

    if not daily_totals:
        return [], converter.get_status()

    period_start = from_date or min(daily_totals)
    period_end = to_date or max(daily_totals)
    daily_cash_flow = _bucket_overview_daily_cash_flow(
        daily_totals,
        from_date=period_start,
        to_date=period_end,
    )
    return daily_cash_flow, converter.get_status()


def _sum_overview_net_flow(daily_cash_flow: list[DailyCashFlow]) -> tuple[int, int]:
    """Sum net inflow and outflow from converted cash-flow rows

    Args:
        daily_cash_flow: Converted cash-flow response rows

    Returns:
        Total inflow and outflow for the overview window
    """
    return (
        sum(day.inflow for day in daily_cash_flow),
        sum(day.outflow for day in daily_cash_flow),
    )


async def _convert_overview_outliers(
    *,
    category_total_rows,
    outlier_candidate_rows,
    accounts_by_id: dict[uuid.UUID, Account],
    converter: FxConverter,
    base_currency: str,
) -> tuple[list[OutlierTransaction], FxStatus]:
    """Convert and rank overview outlier transactions

    Args:
        category_total_rows: Category total rows used to cap outlier contribution
        outlier_candidate_rows: Candidate transaction rows eligible for outlier ranking
        accounts_by_id: Account rows keyed by account ID
        converter: Request-scoped FX converter
        base_currency: User base currency used for overview metrics

    Returns:
        Top converted outlier response rows and FX status for the conversion
    """
    category_totals: dict[uuid.UUID, int] = {}
    for row in category_total_rows:
        currency = accounts_by_id[row.account_id].currency
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_total is None:
            continue

        category_totals[row.category_id] = category_totals.get(row.category_id, 0) + converted_total

    # Cap each category's outlier contribution at that category's converted spend total
    remaining_by_category = {
        category_id: -total
        for category_id, total in category_totals.items()
        if total < 0
    }

    converted_outlier_candidates = []
    for row in outlier_candidate_rows:
        currency = accounts_by_id[row.account_id].currency
        converted_amount = await converter.convert_minor_units(
            int(row.amount),
            base=currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_amount is None or converted_amount >= 0:
            continue

        converted_outlier_candidates.append((row, converted_amount))

    outliers = []
    for row, converted_amount in sorted(converted_outlier_candidates, key=lambda item: item[1]):
        remaining = remaining_by_category.get(row.category_id, 0)
        if remaining <= 0:
            continue
        amount = -min(-converted_amount, remaining)
        remaining_by_category[row.category_id] = remaining + amount
        outliers.append(OutlierTransaction(
            id=row.id,
            merchant_name=row.merchant_name,
            notes=row.notes,
            amount=int(row.amount),
            currency=accounts_by_id[row.account_id].currency,
            dt=row.date,
        ))

    return outliers[:3], converter.get_status()


async def _convert_overview_top_categories(
    *,
    category_total_rows,
    accounts_by_id: dict[uuid.UUID, Account],
    converter: FxConverter,
    base_currency: str,
) -> tuple[list[TopCategorySpend], FxStatus]:
    """Convert and rank top spending categories for the overview

    Args:
        category_total_rows: Category total rows grouped by account and date
        accounts_by_id: Account rows keyed by account ID
        converter: Request-scoped FX converter
        base_currency: User base currency used for overview metrics

    Returns:
        Top converted category response rows and FX status for the conversion
    """
    category_totals: dict[uuid.UUID, tuple[str, int]] = {}
    for row in category_total_rows:
        currency = accounts_by_id[row.account_id].currency
        converted_total = await converter.convert_minor_units(
            int(row.total or 0),
            base=currency,
            quote=base_currency,
            rate_date=row.date,
        )
        if converted_total is None:
            continue

        name, current_total = category_totals.get(row.category_id, (row.category_name, 0))
        category_totals[row.category_id] = (name, current_total + converted_total)

    top_categories = [
        TopCategorySpend(category_id=category_id, category_name=name, total=total)
        for category_id, (name, total) in category_totals.items()
        if total < 0
    ]
    top_categories.sort(key=lambda category: category.total)
    return top_categories[:5], converter.get_status()
