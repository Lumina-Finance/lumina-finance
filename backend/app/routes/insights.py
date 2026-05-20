"""Insights aggregation endpoints."""

from datetime import date, datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.insights import (
    InsightsCashFlowResponse,
    InsightsIncomeExpenseBreakdownResponse,
    InsightsIncomeExpenseFlowResponse,
    InsightsMerchantDistributionResponse,
    InsightsMerchantRankingResponse,
    InsightsNetWorthResponse,
    InsightsPeriodGlanceResponse,
    InsightsSavingsRateTrendResponse,
)
from app.services.insights import (
    get_cash_flow,
    get_income_expense_breakdown,
    get_income_expense_flow,
    get_merchant_distribution,
    get_merchant_ranking,
    get_net_worth,
    get_period_glance,
    get_savings_rate_trend,
)

router = APIRouter(prefix="/insights", tags=["insights"])


def _validate_date_range(
    from_date: Annotated[date, Query()],
    to_date: Annotated[date, Query()],
) -> None:
    if from_date > to_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Start date must be before end date",
        )


@router.get("/period-glance", response_model=InsightsPeriodGlanceResponse, response_model_exclude_none=True)
async def get_period_glance_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date, Query()],
    to_date: Annotated[date, Query()],
):
    """Return compact metrics for the insights top summary card."""
    _validate_date_range(from_date, to_date)
    return await get_period_glance(db, user, from_date, to_date)


@router.get("/income-expense-flow", response_model=InsightsIncomeExpenseFlowResponse)
async def get_income_expense_flow_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date, Query()],
    to_date: Annotated[date, Query()],
):
    """Return income and expense entries for the insights Sankey card."""
    _validate_date_range(from_date, to_date)
    return await get_income_expense_flow(db, user, from_date, to_date)


@router.get("/income-expense-breakdown", response_model=InsightsIncomeExpenseBreakdownResponse)
async def get_income_expense_breakdown_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date, Query()],
    to_date: Annotated[date, Query()],
):
    """Return category breakdown and trend rows for the insights breakdown card."""
    _validate_date_range(from_date, to_date)
    return await get_income_expense_breakdown(db, user, from_date, to_date)


@router.get("/cash-flow", response_model=InsightsCashFlowResponse)
async def get_cash_flow_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date, Query()],
    to_date: Annotated[date, Query()],
):
    """Return cash-flow buckets for the insights cash-flow card."""
    _validate_date_range(from_date, to_date)
    return await get_cash_flow(db, user, from_date, to_date)


@router.get("/net-worth", response_model=InsightsNetWorthResponse)
async def get_net_worth_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date, Query()],
    to_date: Annotated[date, Query()],
):
    """Return signed asset/debt group history for the insights net-worth card."""
    _validate_date_range(from_date, to_date)
    return await get_net_worth(db, user, from_date, to_date)


@router.get("/savings-rate-trend", response_model=InsightsSavingsRateTrendResponse)
async def get_savings_rate_trend_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return monthly income and expense totals for the insights savings-rate trend card."""
    return await get_savings_rate_trend(db, user, datetime.now(ZoneInfo(user.tz)))


@router.get("/merchant-distribution", response_model=InsightsMerchantDistributionResponse)
async def get_merchant_distribution_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date, Query()],
    to_date: Annotated[date, Query()],
):
    """Return merchant spend rows for the insights merchant distribution card."""
    _validate_date_range(from_date, to_date)
    return await get_merchant_distribution(db, user, from_date, to_date)


@router.get("/merchant-ranking", response_model=InsightsMerchantRankingResponse)
async def get_merchant_ranking_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date, Query()],
    to_date: Annotated[date, Query()],
):
    """Return merchant ranking rows for the insights merchant ranking card."""
    _validate_date_range(from_date, to_date)
    return await get_merchant_ranking(db, user, from_date, to_date)
