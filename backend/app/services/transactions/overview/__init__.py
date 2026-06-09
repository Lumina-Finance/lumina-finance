"""Transaction overview aggregation service"""
import uuid
from datetime import date

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.transaction import TransactionsOverview
from app.services.fx import FxConverter
from app.services.transactions.overview.cash_flow import (
    convert_overview_daily_cash_flow,
    sum_overview_net_flow,
)
from app.services.transactions.overview.categories import convert_overview_top_categories
from app.services.transactions.overview.conversion import (
    clone_overview_converter,
    get_overview_accounts_by_id,
    get_overview_currency_exponents,
    prefetch_overview_rates,
)
from app.services.transactions.overview.outliers import convert_overview_outliers
from app.services.transactions.overview.queries import (
    build_overview_transaction_filters,
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

    transaction_filters = build_overview_transaction_filters(
        user.id,
        from_date=from_date,
        to_date=to_date,
        account_id=account_id,
    )

    # Check for any matching transaction before running the heavier overview aggregate queries
    matching_transaction_query = select(sa.literal(1)).where(transaction_filters).limit(1)
    has_matching_transactions = (await db.execute(matching_transaction_query)).scalar_one_or_none() is not None
    if not has_matching_transactions:
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
    accounts_by_id = await get_overview_accounts_by_id(db, currency_conversion_rows)
    shared_converter = FxConverter(
        currency_exponents=await get_overview_currency_exponents(
            db,
            {user.base_currency, *(account.currency for account in accounts_by_id.values())},
        ),
    )
    # Prefetch rates once, then clone converter state so each panel reports its own FX status
    await prefetch_overview_rates(
        shared_converter,
        conversion_rows=currency_conversion_rows,
        accounts_by_id=accounts_by_id,
        base_currency=user.base_currency,
    )
    top_categories, top_categories_fx_status = await convert_overview_top_categories(
        category_total_rows=category_total_rows,
        accounts_by_id=accounts_by_id,
        converter=clone_overview_converter(shared_converter),
        base_currency=user.base_currency,
    )
    daily_cash_flow, daily_cash_flow_fx_status = await convert_overview_daily_cash_flow(
        cash_flow_rows=cash_flow_rows,
        accounts_by_id=accounts_by_id,
        converter=clone_overview_converter(shared_converter),
        base_currency=user.base_currency,
        from_date=from_date,
        to_date=to_date,
    )
    total_inflow, total_outflow = sum_overview_net_flow(daily_cash_flow)
    outliers, outliers_fx_status = await convert_overview_outliers(
        category_total_rows=category_total_rows,
        outlier_candidate_rows=outlier_candidate_rows,
        accounts_by_id=accounts_by_id,
        converter=clone_overview_converter(shared_converter),
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
