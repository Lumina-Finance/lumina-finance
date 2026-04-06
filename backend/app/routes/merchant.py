import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.category import Category
from app.models.household import HouseholdMember
from app.models.merchant import Merchant
from app.models.user import User
from app.schemas.merchant import CreateMerchantRequest, MerchantResponse, UpdateMerchantRequest

router = APIRouter(prefix="/merchants", tags=["merchants"])


@router.get("", response_model=list[MerchantResponse])
async def list_merchants(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    household_id: Annotated[uuid.UUID | None, Query()] = None,
):
    """Return merchants the user can access. Personal only by default, or include a household's merchants."""
    # Without a filter, only return personal merchants (household_id is null)
    query = select(Merchant).where(Merchant.owner_id == user.id, Merchant.household_id.is_(None))

    if household_id:
        member_result = await db.execute(
            select(HouseholdMember).where(
                HouseholdMember.household_id == household_id,
                HouseholdMember.user_id == user.id,
            ),
        )
        if not member_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Household not found")

        query = select(Merchant).where(
            (Merchant.owner_id == user.id) | (Merchant.household_id == household_id),
        )

    result = await db.execute(query.order_by(Merchant.name))
    return result.scalars().all()


@router.get("/{merchant_id}", response_model=MerchantResponse)
async def get_merchant(
    merchant_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single merchant. Must be personal or from a household the user belongs to."""
    household_ids = (
        select(HouseholdMember.household_id).where(HouseholdMember.user_id == user.id)
    ).scalar_subquery()

    result = await db.execute(
        select(Merchant).where(
            Merchant.id == merchant_id,
            (Merchant.owner_id == user.id) | (Merchant.household_id.in_(household_ids)),
        ),
    )
    merchant = result.scalar_one_or_none()
    if not merchant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Merchant not found")
    return merchant


@router.post("", response_model=MerchantResponse, status_code=status.HTTP_201_CREATED)
async def create_merchant(
    data: CreateMerchantRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a new merchant. Personal by default, or household-scoped if household_id is provided."""
    household_id = data.household_id
    if household_id:
        # Any household member can create household merchants
        member_result = await db.execute(
            select(HouseholdMember).where(
                HouseholdMember.household_id == household_id,
                HouseholdMember.user_id == user.id,
            ),
        )
        if not member_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Household not found")

    # Reject duplicate name within the scope (household or personal)
    dup_query = select(Merchant).where(Merchant.name == data.name)
    if household_id:
        dup_query = dup_query.where(Merchant.household_id == household_id)
    else:
        dup_query = dup_query.where(Merchant.owner_id == user.id, Merchant.household_id.is_(None))
    if (await db.execute(dup_query)).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Merchant with this name already exists")

    # Validate default_category_id (accept personal or same household categories)
    if data.default_category_id:
        cat_query = select(Category).where(Category.id == data.default_category_id)
        if household_id:
            cat_query = cat_query.where(
                (Category.owner_id == user.id) | (Category.household_id == household_id),
            )
        else:
            cat_query = cat_query.where(Category.owner_id == user.id)
        if not (await db.execute(cat_query)).scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")

    merchant = Merchant(
        owner_id=user.id,
        household_id=household_id,
        name=data.name,
        default_category_id=data.default_category_id,
    )
    db.add(merchant)
    await db.commit()
    await db.refresh(merchant)
    return merchant


@router.patch("/{merchant_id}", response_model=MerchantResponse)
async def update_merchant(
    merchant_id: uuid.UUID,
    data: UpdateMerchantRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a merchant. Household merchants require admin role."""
    household_ids = (
        select(HouseholdMember.household_id).where(HouseholdMember.user_id == user.id)
    ).scalar_subquery()

    result = await db.execute(
        select(Merchant).where(
            Merchant.id == merchant_id,
            (Merchant.owner_id == user.id) | (Merchant.household_id.in_(household_ids)),
        ),
    )
    merchant = result.scalar_one_or_none()
    if not merchant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Merchant not found")

    # Only admins can update household merchants
    if merchant.household_id is not None:
        member_result = await db.execute(
            select(HouseholdMember).where(
                HouseholdMember.household_id == merchant.household_id,
                HouseholdMember.user_id == user.id,
            ),
        )
        member = member_result.scalar_one_or_none()
        if not member or not member.is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return merchant

    # Validate default_category_id (accept personal or same household categories)
    if "default_category_id" in updates and updates["default_category_id"] is not None:
        cat_query = select(Category).where(Category.id == updates["default_category_id"])
        if merchant.household_id is not None:
            cat_query = cat_query.where(
                (Category.owner_id == user.id) | (Category.household_id == merchant.household_id),
            )
        else:
            cat_query = cat_query.where(Category.owner_id == user.id)
        if not (await db.execute(cat_query)).scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")

    for field, value in updates.items():
        setattr(merchant, field, value)

    await db.commit()
    await db.refresh(merchant)
    return merchant


@router.delete("/{merchant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_merchant(
    merchant_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a merchant. Household merchants require admin role."""
    # Fetch merchant if the user owns it or is a member of its household
    household_ids = (
        select(HouseholdMember.household_id).where(HouseholdMember.user_id == user.id)
    ).scalar_subquery()

    result = await db.execute(
        select(Merchant).where(
            Merchant.id == merchant_id,
            (Merchant.owner_id == user.id) | (Merchant.household_id.in_(household_ids)),
        ),
    )
    merchant = result.scalar_one_or_none()
    if not merchant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Merchant not found")

    # Only admins can delete household merchants
    if merchant.household_id is not None:
        member_result = await db.execute(
            select(HouseholdMember).where(
                HouseholdMember.household_id == merchant.household_id,
                HouseholdMember.user_id == user.id,
            ),
        )
        member = member_result.scalar_one_or_none()
        if not member or not member.is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    await db.delete(merchant)
    await db.commit()
