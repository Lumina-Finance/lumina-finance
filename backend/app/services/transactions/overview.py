"""Transaction overview aggregation service"""
import uuid
from datetime import date

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.transaction import TransactionsOverview
from app.services.fx import FxConverter
from app.services.transactions.access import accessible_account_ids_subquery
from app.services.transactions.overview_cash_flow import (
    convert_overview_daily_cash_flow,
    sum_overview_net_flow,
)
from app.services.transactions.overview_categories import convert_overview_top_categories
from app.services.transactions.overview_outliers import convert_overview_outliers
from app.services.transactions.overview_queries import (
    get_overview_cash_flow_rows,
    get_overview_category_total_rows,
    get_overview_outlier_candidate_rows,
)


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
    shared_converter = FxConverter(
        currency_exponents=await _get_currency_exponents(
            db,
            {user.base_currency, *(account.currency for account in accounts_by_id.values())},
        ),
    )
    # Prefetch rates once, then clone converter state so each panel reports its own FX status
    await _prefetch_overview_rates(
        shared_converter,
        conversion_rows=currency_conversion_rows,
        accounts_by_id=accounts_by_id,
        base_currency=user.base_currency,
    )
    top_categories, top_categories_fx_status = await convert_overview_top_categories(
        category_total_rows=category_total_rows,
        accounts_by_id=accounts_by_id,
        converter=_clone_overview_converter(shared_converter),
        base_currency=user.base_currency,
    )
    daily_cash_flow, daily_cash_flow_fx_status = await convert_overview_daily_cash_flow(
        cash_flow_rows=cash_flow_rows,
        accounts_by_id=accounts_by_id,
        converter=_clone_overview_converter(shared_converter),
        base_currency=user.base_currency,
        from_date=from_date,
        to_date=to_date,
    )
    total_inflow, total_outflow = sum_overview_net_flow(daily_cash_flow)
    outliers, outliers_fx_status = await convert_overview_outliers(
        category_total_rows=category_total_rows,
        outlier_candidate_rows=outlier_candidate_rows,
        accounts_by_id=accounts_by_id,
        converter=_clone_overview_converter(shared_converter),
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
    """Return minor-unit exponents for currency codes

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
    """Return accounts required for overview currency conversion

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
    if not conversion_rows:
        return

    start_date = min(row.date for row in conversion_rows)
    end_date = max(row.date for row in conversion_rows)

    # Prefetch each distinct account-currency to base-currency range once for the overview
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


def _clone_overview_converter(converter: FxConverter) -> FxConverter:
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
