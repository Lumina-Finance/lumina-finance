import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.household import HouseholdMember
from app.models.user import User
from app.schemas.category import CategoryResponse, CreateCategoryRequest, UpdateCategoryRequest

router = APIRouter(prefix="/categories", tags=["categories"])

_VALID_KINDS = {e.value for e in CategoryKind}


@router.get("", response_model=list[CategoryResponse])
async def list_categories(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    household_id: Annotated[uuid.UUID | None, Query()] = None,
):
    """Return categories the user can access. Personal only by default, or include a household's categories."""
    # Without a filter, only return personal categories (household_id is null)
    query = select(Category).where(Category.owner_id == user.id, Category.household_id.is_(None))

    if household_id:
        # Verify membership
        member_result = await db.execute(
            select(HouseholdMember).where(
                HouseholdMember.household_id == household_id,
                HouseholdMember.user_id == user.id,
            ),
        )
        if not member_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Household not found")

        query = select(Category).where(
            (Category.owner_id == user.id) | (Category.household_id == household_id),
        )

    result = await db.execute(query.order_by(Category.name))
    return result.scalars().all()


@router.get("/{category_id}", response_model=CategoryResponse)
async def get_category(
    category_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single category. Must be personal or from a household the user belongs to."""
    household_ids = (
        select(HouseholdMember.household_id).where(HouseholdMember.user_id == user.id)
    ).scalar_subquery()

    result = await db.execute(
        select(Category).where(
            Category.id == category_id,
            (Category.owner_id == user.id) | (Category.household_id.in_(household_ids)),
        ),
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    return category


@router.post("", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(
    data: CreateCategoryRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a new category. Personal by default, or household-scoped if household_id is provided."""
    if data.kind not in _VALID_KINDS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid category kind")

    household_id = data.household_id
    if household_id:
        # Any household member can create household categories
        member_result = await db.execute(
            select(HouseholdMember).where(
                HouseholdMember.household_id == household_id,
                HouseholdMember.user_id == user.id,
            ),
        )
        if not member_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Household not found")

    # Reject duplicate name + kind within the scope (household or personal)
    dup_query = select(Category).where(Category.name == data.name, Category.kind == data.kind)
    if household_id:
        dup_query = dup_query.where(Category.household_id == household_id)
    else:
        dup_query = dup_query.where(Category.owner_id == user.id)
    if (await db.execute(dup_query)).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Category with this name and kind already exists")

    # Validate parent exists and is accessible (personal or same household)
    if data.parent_id:
        parent_query = select(Category).where(Category.id == data.parent_id)
        if household_id:
            parent_query = parent_query.where(
                (Category.owner_id == user.id) | (Category.household_id == household_id),
            )
        else:
            parent_query = parent_query.where(Category.owner_id == user.id)
        if not (await db.execute(parent_query)).scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Parent category not found")

    category = Category(
        owner_id=user.id,
        household_id=household_id,
        name=data.name,
        kind=data.kind,
        parent_id=data.parent_id,
    )
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


@router.patch("/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: uuid.UUID,
    data: UpdateCategoryRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a category. Household categories require admin role."""
    household_ids = (
        select(HouseholdMember.household_id).where(HouseholdMember.user_id == user.id)
    ).scalar_subquery()

    result = await db.execute(
        select(Category).where(
            Category.id == category_id,
            (Category.owner_id == user.id) | (Category.household_id.in_(household_ids)),
        ),
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    # Household categories require admin
    if category.household_id:
        member_result = await db.execute(
            select(HouseholdMember).where(
                HouseholdMember.household_id == category.household_id,
                HouseholdMember.user_id == user.id,
            ),
        )
        member = member_result.scalar_one_or_none()
        if not member or not member.is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return category

    # Validate parent exists and is accessible (personal or same household)
    if "parent_id" in updates and updates["parent_id"] is not None:
        parent_query = select(Category).where(Category.id == updates["parent_id"])
        if category.household_id:
            parent_query = parent_query.where(
                (Category.owner_id == user.id) | (Category.household_id == category.household_id),
            )
        else:
            parent_query = parent_query.where(Category.owner_id == user.id)
        if not (await db.execute(parent_query)).scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Parent category not found")

    for field, value in updates.items():
        setattr(category, field, value)

    await db.commit()
    await db.refresh(category)
    return category


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    category_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a category. Household categories require admin role."""
    # Fetch category if the user owns it or is a member of its household
    household_ids = (
        select(HouseholdMember.household_id).where(HouseholdMember.user_id == user.id)
    ).scalar_subquery()

    result = await db.execute(
        select(Category).where(
            Category.id == category_id,
            (Category.owner_id == user.id) | (Category.household_id.in_(household_ids)),
        ),
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    # Only admins can delete household categories
    if category.household_id:
        member_result = await db.execute(
            select(HouseholdMember).where(
                HouseholdMember.household_id == category.household_id,
                HouseholdMember.user_id == user.id,
            ),
        )
        member = member_result.scalar_one_or_none()
        if not member or not member.is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    await db.delete(category)
    await db.commit()
