"""Insights aggregation endpoints."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.insights import (
    InsightsIncomeExpenseBreakdownResponse,
    InsightsIncomeExpenseFlowResponse,
    InsightsPeriodGlanceResponse,
)
from app.services.insights import get_income_expense_breakdown, get_income_expense_flow, get_period_glance

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
