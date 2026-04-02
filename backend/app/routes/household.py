import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.base import HouseholdRole
from app.models.household import Household, HouseholdMember
from app.models.user import User
from app.schemas.household import (
    AddHouseholdMemberRequest,
    CreateHouseholdRequest,
    HouseholdMemberResponse,
    HouseholdResponse,
    UpdateHouseholdMemberRoleRequest,
    UpdateHouseholdRequest,
)

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


async def _check_admin_or_403(
    db: AsyncSession, household_id: uuid.UUID, user_id: uuid.UUID,
) -> HouseholdMember:
    """Return the user's membership or raise 403 if they are not an admin.

    Args:
        db: Async database session.
        household_id: UUID of the household.
        user_id: UUID of the user.

    Returns:
        The HouseholdMember row.

    Raises:
        HTTPException 404: User is not a member of the household.
        HTTPException 403: User is a member but not an admin.
    """
    membership = await _check_membership_or_404(db, household_id, user_id)
    if membership.role != HouseholdRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return membership


@router.get("", response_model=list[HouseholdResponse])
async def list_households(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    include_archived: Annotated[bool, Query()] = False,
):
    """Return all households the authenticated user is a member of."""
    query = (
        select(Household)
        .join(HouseholdMember, HouseholdMember.household_id == Household.id)
        .where(HouseholdMember.user_id == user.id)
    )
    if not include_archived:
        query = query.where(Household.is_archived.is_(False))
    result = await db.execute(query.order_by(Household.name))
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


@router.patch("/{household_id}", response_model=HouseholdResponse)
async def update_household(
    household_id: uuid.UUID,
    data: UpdateHouseholdRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a household. Only admins can update."""
    await _check_admin_or_403(db, household_id, user.id)

    result = await db.execute(
        select(Household).where(Household.id == household_id),
    )
    household = result.scalar_one()

    changed_fields = data.model_dump(exclude_unset=True)
    if not changed_fields:
        return household

    for field, value in changed_fields.items():
        setattr(household, field, value)

    await db.commit()
    await db.refresh(household)
    return household


@router.delete("/{household_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_household(
    household_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a household. Only the owner can delete."""
    await _check_membership_or_404(db, household_id, user.id)

    result = await db.execute(
        select(Household).where(Household.id == household_id),
    )
    household = result.scalar_one()

    if household.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can delete this household")

    await db.delete(household)
    await db.commit()


@router.get("/{household_id}/members", response_model=list[HouseholdMemberResponse])
async def list_members(
    household_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """List all members of a household. User must be a member."""
    await _check_membership_or_404(db, household_id, user.id)
    result = await db.execute(
        select(HouseholdMember).where(HouseholdMember.household_id == household_id),
    )
    return result.scalars().all()


@router.post("/{household_id}/members", response_model=HouseholdMemberResponse, status_code=status.HTTP_201_CREATED)
async def add_member(
    household_id: uuid.UUID,
    data: AddHouseholdMemberRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Add a user to a household. Only admins can add members."""
    await _check_admin_or_403(db, household_id, user.id)

    # Verify target user exists
    target_user = await db.execute(
        select(User).where(User.id == data.user_id),
    )
    if not target_user.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="User not found")

    # Check if already a member
    existing = await db.execute(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household_id,
            HouseholdMember.user_id == data.user_id,
        ),
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User is already a member")

    member = HouseholdMember(
        household_id=household_id, user_id=data.user_id, role=data.role,
    )
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return member


@router.patch("/{household_id}/members/{member_id}", response_model=HouseholdMemberResponse)
async def update_member_role(
    household_id: uuid.UUID,
    member_id: uuid.UUID,
    data: UpdateHouseholdMemberRoleRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a member's role. Only admins can change roles. Cannot demote the owner."""
    await _check_admin_or_403(db, household_id, user.id)

    target_membership = await db.execute(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household_id,
            HouseholdMember.user_id == member_id,
        ),
    )
    target = target_membership.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    # Prevent demoting the household owner
    result = await db.execute(
        select(Household.owner_id).where(Household.id == household_id),
    )
    if member_id == result.scalar_one() and data.role != HouseholdRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot change the owner's role")

    target.role = data.role
    await db.commit()
    await db.refresh(target)
    return target


@router.delete("/{household_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    household_id: uuid.UUID,
    member_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Remove a member from a household. Admins can remove others; any member can leave.

    The owner cannot be removed — they must delete the household instead.
    """
    caller = await _check_membership_or_404(db, household_id, user.id)

    # Any member can self-leave, but only admins can remove others
    is_self = member_id == user.id
    if not is_self and caller.role != HouseholdRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    # Prevent removing the owner
    result = await db.execute(
        select(Household.owner_id).where(Household.id == household_id),
    )
    if member_id == result.scalar_one():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot remove the owner")

    if is_self:
        target = caller
    else:
        target_result = await db.execute(
            select(HouseholdMember).where(
                HouseholdMember.household_id == household_id,
                HouseholdMember.user_id == member_id,
            ),
        )
        target = target_result.scalar_one_or_none()
        if not target:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    await db.delete(target)
    await db.commit()


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
