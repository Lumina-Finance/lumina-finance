import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.base import HouseholdRole
from app.models.household import Household, HouseholdMember
from app.models.user import User
from app.schemas.household import CreateHouseholdRequest, HouseholdResponse

router = APIRouter(prefix="/households", tags=["households"])


async def _check_membership_or_404(
    db: AsyncSession, household_id: uuid.UUID, user_id: uuid.UUID,
) -> HouseholdMember:
    """Return the user's membership or raise 404 if they are not a member.

    Args:
        db: Async database session.
        household_id: UUID of the household.
        user_id: UUID of the user.

    Returns:
        The HouseholdMember row.

    Raises:
        HTTPException 404: User is not a member of the household.
    """
    result = await db.execute(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household_id,
            HouseholdMember.user_id == user_id,
        ),
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Household not found")
    return membership


@router.get("", response_model=list[HouseholdResponse])
async def list_households(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return all households the authenticated user is a member of."""
    result = await db.execute(
        select(Household)
        .join(HouseholdMember, HouseholdMember.household_id == Household.id)
        .where(HouseholdMember.user_id == user.id)
        .order_by(Household.name),
    )
    return result.scalars().all()


@router.get("/{household_id}", response_model=HouseholdResponse)
async def get_household(
    household_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single household. User must be a member."""
    await _check_membership_or_404(db, household_id, user.id)
    result = await db.execute(
        select(Household).where(Household.id == household_id),
    )
    return result.scalar_one()


@router.post("", response_model=HouseholdResponse, status_code=status.HTTP_201_CREATED)
async def create_household(
    data: CreateHouseholdRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a new household. The creator becomes the owner and is auto-added as admin."""
    household_id = uuid.uuid4()
    household = Household(id=household_id, owner_id=user.id, name=data.name, profile_pic=data.profile_pic)
    member = HouseholdMember(
        household_id=household_id, user_id=user.id, role=HouseholdRole.ADMIN,
    )
    db.add(household)
    db.add(member)
    await db.commit()
    await db.refresh(household)
    return household
