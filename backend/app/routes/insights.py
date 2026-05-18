"""Insights aggregation endpoints."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.insights import InsightsPeriodGlanceResponse
from app.services.insights import get_period_glance

router = APIRouter(prefix="/insights", tags=["insights"])


@router.get("/period-glance", response_model=InsightsPeriodGlanceResponse, response_model_exclude_none=True)
async def get_period_glance_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date, Query()],
    to_date: Annotated[date, Query()],
):
    """Return compact metrics for the insights top summary card."""
    if from_date > to_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Start date must be before end date",
        )

    return await get_period_glance(db, user, from_date, to_date)
