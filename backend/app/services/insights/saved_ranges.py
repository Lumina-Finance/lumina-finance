"""Saving a named relative insights range"""

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.allowance_hook import AllowanceKind
from app.models.saved_insights_range import SavedInsightsRange
from app.models.user import User
from app.schemas.insights import SavedInsightsRangeCreate
from app.services.allowance.require import require_allowance
from app.services.cache_state import mark_user_cache_changed


async def create_saved_range(db: AsyncSession, user: User, data: SavedInsightsRangeCreate) -> SavedInsightsRange:
    """Save a named relative insights range for a user

    Args:
        db: Active database session
        user: Authenticated user saving the range
        data: Saved range payload

    Returns:
        The saved range

    Raises:
        HTTPException: 403 when the allowance check refuses the user another saved range, and 409
            when the user already has a saved range with the same name
    """
    await require_allowance(db, user.id, AllowanceKind.SAVED_INSIGHTS_RANGE)
    saved_range = SavedInsightsRange(
        user_id=user.id,
        name=data.name,
        amount=data.amount,
        unit=data.unit,
        qualifier=data.qualifier,
    )
    db.add(saved_range)

    # Surface a duplicate name as a domain conflict instead of a raw integrity error
    try:
        await db.flush()
        await mark_user_cache_changed(db, user.id)
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A saved range with this name already exists",
        ) from e

    await db.refresh(saved_range)
    return saved_range
