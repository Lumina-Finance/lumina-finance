import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.base import HouseholdRole
from app.models.household import Household, HouseholdMember
from app.models.user import User
from app.schemas.household import CreateHouseholdRequest, HouseholdResponse

router = APIRouter(prefix="/households", tags=["households"])


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
