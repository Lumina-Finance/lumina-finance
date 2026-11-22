"""Limits on how many budgets a person keeps and how many categories a budget tracks"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import BaseBudget
from app.schemas.budget import MAX_BASE_BUDGETS, MAX_BUDGET_CATEGORIES


async def ensure_room_for_base_budgets(db: AsyncSession, user_id: uuid.UUID, adding: int) -> None:
    """Raise when adding budgets would take a person past the most they keep

    Archived budgets count and group budgets do not. Someone already past the limit keeps
    everything and adds nothing

    Args:
        db: Active database session
        user_id: Authenticated user identifier
        adding: Number of budgets about to be added

    Raises:
        HTTPException: Raised with 422 when the person would keep more than the limit
    """
    owned_query = select(func.count()).select_from(BaseBudget).where(BaseBudget.owner_id == user_id, BaseBudget.group_id.is_(None))
    owned = (await db.execute(owned_query)).scalar_one()
    if owned + adding > MAX_BASE_BUDGETS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"You can keep up to {MAX_BASE_BUDGETS} budgets",
        )


def ensure_category_count_within_limit(category_count: int) -> None:
    """Raise when a budget would track more than the most categories it may

    Args:
        category_count: Number of distinct categories the budget would track

    Raises:
        HTTPException: Raised with 422 when the count is past the limit
    """
    if category_count > MAX_BUDGET_CATEGORIES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"A budget can track up to {MAX_BUDGET_CATEGORIES} categories",
        )
