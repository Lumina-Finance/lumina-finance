"""Insights aggregation endpoints"""

import uuid
from datetime import date
from datetime import datetime as DateTime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.saved_insights_range import SavedInsightsRange
from app.models.user import User
from app.schemas.insights import (
    InsightsCashFlowResponse,
    InsightsComparisonPeriod,
    InsightsFundFlowResponse,
    InsightsIncomeExpenseBreakdownResponse,
    InsightsMerchantDistributionResponse,
    InsightsMerchantRankingResponse,
    InsightsMerchantsResponse,
    InsightsNetWorthResponse,
    InsightsPeriodAtAGlanceResponse,
    InsightsSavingsRateTrendResponse,
    SavedInsightsRangeCreate,
    SavedInsightsRangeResponse,
)
from app.services.insights import (
    get_cash_flow,
    get_fund_flow,
    get_income_expense_breakdown,
    get_merchant_distribution,
    get_merchant_ranking,
    get_merchants,
    get_net_worth,
    get_period_at_a_glance,
    get_savings_rate_trend,
)

router = APIRouter(prefix="/insights", tags=["insights"])


def _validate_date_range(
    from_date: Annotated[date, Query()],
    to_date: Annotated[date, Query()],
) -> None:
    """Raise when an insights date range is invalid

    Args:
        from_date: Inclusive start date from the request query
        to_date: Inclusive end date from the request query

    Raises:
        HTTPException: Raised with 422 when ``from_date`` is after ``to_date``
    """
    if from_date > to_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Start date must be before end date",
        )


def _get_viewer_local_now(user: User) -> DateTime:
    """Return the viewer-local datetime used by insights routes

    Args:
        user: Authenticated user whose timezone anchors date windows

    Returns:
        Viewer-local datetime for the user's timezone
    """
    from app.routes import insights as insights_routes

    now = insights_routes.datetime.now(ZoneInfo(user.tz))
    return now


@router.get("/period-glance", response_model=InsightsPeriodAtAGlanceResponse, response_model_exclude_none=True)
async def get_period_at_a_glance_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date, Query()],
    to_date: Annotated[date, Query()],
    comparison_period: Annotated[InsightsComparisonPeriod, Query()] = "same_length",
):
    """Return compact metrics for the Period At A Glance card

    Args:
        user: Authenticated user requesting the insight
        db: Active database session
        from_date: Inclusive insight start date
        to_date: Inclusive insight end date
        comparison_period: Prior-period comparison mode

    Returns:
        Period At A Glance response for the requested date range

    Raises:
        HTTPException: Raised with 422 when ``from_date`` is after ``to_date``
    """
    _validate_date_range(from_date, to_date)
    return await get_period_at_a_glance(db, user, from_date, to_date, comparison_period)


@router.get("/fund-flow", response_model=InsightsFundFlowResponse)
async def get_fund_flow_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date, Query()],
    to_date: Annotated[date, Query()],
):
    """Return fund flow rows for the requested date range

    Args:
        user: Authenticated user requesting fund flow
        db: Active database session
        from_date: Inclusive insight start date
        to_date: Inclusive insight end date

    Returns:
        Fund flow response for the requested date range

    Raises:
        HTTPException: Raised with 422 when ``from_date`` is after ``to_date``
    """
    _validate_date_range(from_date, to_date)
    return await get_fund_flow(db, user, from_date, to_date)


@router.get("/income-expense-breakdown", response_model=InsightsIncomeExpenseBreakdownResponse)
async def get_income_expense_breakdown_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date, Query()],
    to_date: Annotated[date, Query()],
    comparison_period: Annotated[InsightsComparisonPeriod, Query()] = "same_length",
):
    """Return income and expense breakdown rows

    Args:
        user: Authenticated user requesting the breakdown
        db: Active database session
        from_date: Inclusive insight start date
        to_date: Inclusive insight end date
        comparison_period: Prior-period comparison mode

    Returns:
        Income and expense breakdown response for the requested date range

    Raises:
        HTTPException: Raised with 422 when ``from_date`` is after ``to_date``
    """
    _validate_date_range(from_date, to_date)
    return await get_income_expense_breakdown(db, user, from_date, to_date, comparison_period)


@router.get("/cash-flow", response_model=InsightsCashFlowResponse)
async def get_cash_flow_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date, Query()],
    to_date: Annotated[date, Query()],
):
    """Return cash flow buckets for the requested date range

    Args:
        user: Authenticated user requesting cash flow
        db: Active database session
        from_date: Inclusive insight start date
        to_date: Inclusive insight end date

    Returns:
        Cash flow response for the requested date range

    Raises:
        HTTPException: Raised with 422 when ``from_date`` is after ``to_date``
    """
    _validate_date_range(from_date, to_date)
    return await get_cash_flow(db, user, from_date, to_date)


@router.get("/net-worth", response_model=InsightsNetWorthResponse)
async def get_net_worth_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date, Query()],
    to_date: Annotated[date, Query()],
):
    """Return net worth group history for the requested date range

    Args:
        user: Authenticated user requesting net worth
        db: Active database session
        from_date: Inclusive insight start date
        to_date: Inclusive insight end date

    Returns:
        Net worth response for the requested date range

    Raises:
        HTTPException: Raised with 422 when ``from_date`` is after ``to_date``
    """
    _validate_date_range(from_date, to_date)
    return await get_net_worth(db, user, from_date, to_date)


@router.get("/savings-rate-trend", response_model=InsightsSavingsRateTrendResponse)
async def get_savings_rate_trend_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return savings-rate trend rows for the authenticated user

    Args:
        user: Authenticated user requesting savings-rate trend
        db: Active database session

    Returns:
        Savings-rate trend response anchored to the viewer-local current month
    """
    return await get_savings_rate_trend(db, user, _get_viewer_local_now(user))


@router.get("/merchant-distribution", response_model=InsightsMerchantDistributionResponse)
async def get_merchant_distribution_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date, Query()],
    to_date: Annotated[date, Query()],
    comparison_period: Annotated[InsightsComparisonPeriod, Query()] = "same_length",
):
    """Return merchant distribution rows for the requested date range

    Args:
        user: Authenticated user requesting merchant distribution
        db: Active database session
        from_date: Inclusive insight start date
        to_date: Inclusive insight end date
        comparison_period: Prior-period comparison mode

    Returns:
        Merchant distribution response for the requested date range

    Raises:
        HTTPException: Raised with 422 when ``from_date`` is after ``to_date``
    """
    _validate_date_range(from_date, to_date)
    return await get_merchant_distribution(db, user, from_date, to_date, comparison_period)


@router.get("/merchant-ranking", response_model=InsightsMerchantRankingResponse)
async def get_merchant_ranking_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date, Query()],
    to_date: Annotated[date, Query()],
    comparison_period: Annotated[InsightsComparisonPeriod, Query()] = "same_length",
):
    """Return merchant ranking rows for the requested date range

    Args:
        user: Authenticated user requesting merchant ranking
        db: Active database session
        from_date: Inclusive insight start date
        to_date: Inclusive insight end date
        comparison_period: Prior-period comparison mode

    Returns:
        Merchant ranking response for the requested date range

    Raises:
        HTTPException: Raised with 422 when ``from_date`` is after ``to_date``
    """
    _validate_date_range(from_date, to_date)
    return await get_merchant_ranking(db, user, from_date, to_date, comparison_period)


@router.get("/merchants", response_model=InsightsMerchantsResponse)
async def get_merchants_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date, Query()],
    to_date: Annotated[date, Query()],
    comparison_period: Annotated[InsightsComparisonPeriod, Query()] = "same_length",
):
    """Return shared merchant insight rows for the requested date range

    Args:
        user: Authenticated user requesting merchant insights
        db: Active database session
        from_date: Inclusive insight start date
        to_date: Inclusive insight end date
        comparison_period: Prior-period comparison mode

    Returns:
        Shared merchant insight response for the requested date range

    Raises:
        HTTPException: Raised with 422 when ``from_date`` is after ``to_date``
    """
    _validate_date_range(from_date, to_date)
    return await get_merchants(db, user, from_date, to_date, comparison_period)


@router.get("/saved-ranges", response_model=list[SavedInsightsRangeResponse])
async def list_saved_ranges_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the authenticated user's saved relative insights ranges

    Args:
        user: Authenticated user requesting their saved ranges
        db: Active database session

    Returns:
        Saved ranges ordered with the most recently created first
    """
    # Read the caller's saved ranges, newest first so the latest save surfaces at the top
    result = await db.execute(
        select(SavedInsightsRange)
        .where(SavedInsightsRange.user_id == user.id)
        .order_by(SavedInsightsRange.created_at.desc())
    )
    return result.scalars().all()


@router.post("/saved-ranges", response_model=SavedInsightsRangeResponse, status_code=status.HTTP_201_CREATED)
async def create_saved_range_route(
    data: SavedInsightsRangeCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Save a named relative insights range for the authenticated user

    Args:
        data: Saved range payload with a name, amount, and unit
        user: Authenticated user saving the range
        db: Active database session

    Returns:
        Newly saved range

    Raises:
        HTTPException: Raised with 409 when the user already has a saved range with the same name
    """
    saved_range = SavedInsightsRange(
        user_id=user.id,
        name=data.name,
        amount=data.amount,
        unit=data.unit,
    )
    db.add(saved_range)

    # Surface a duplicate name as a domain conflict instead of a raw integrity error
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A saved range with this name already exists",
        ) from e

    await db.refresh(saved_range)
    return saved_range


@router.delete("/saved-ranges/{range_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_saved_range_route(
    range_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete one of the authenticated user's saved relative insights ranges

    Args:
        range_id: Saved range identifier from the route path
        user: Authenticated user deleting the range
        db: Active database session

    Raises:
        HTTPException: Raised with 404 when the range does not belong to the user
    """
    result = await db.execute(
        delete(SavedInsightsRange).where(
            SavedInsightsRange.id == range_id,
            SavedInsightsRange.user_id == user.id,
        )
    )
    await db.commit()

    # A zero row count means the range is missing or owned by another user
    if result.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved range not found")
