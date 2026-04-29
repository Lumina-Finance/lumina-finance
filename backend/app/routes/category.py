import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.group import GroupMember
from app.models.user import User
from app.schemas.category import CategoryResponse, CreateCategoryRequest, UpdateCategoryRequest

router = APIRouter(prefix="/categories", tags=["categories"])

_VALID_KINDS = {e.value for e in CategoryKind}


def _personal_category_filter(user_id: uuid.UUID):
    return (Category.owner_id == user_id) & (Category.group_id.is_(None))


def _system_or_personal_category_filter(user_id: uuid.UUID):
    return Category.is_system.is_(True) | _personal_category_filter(user_id)


@router.get("", response_model=list[CategoryResponse])
async def list_categories(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    group_id: Annotated[uuid.UUID | None, Query()] = None,
):
    """Return system and personal categories, plus group categories when requested."""
    category_filter = _system_or_personal_category_filter(user.id)

    if group_id:
        member_result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user.id,
            ),
        )
        if not member_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")

        category_filter = category_filter | (Category.group_id == group_id)

    query = select(Category).where(category_filter)
    result = await db.execute(query.order_by(Category.name))
    return result.scalars().all()


@router.get("/{category_id}", response_model=CategoryResponse)
async def get_category(
    category_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single category the user can access."""
    group_ids = (
        select(GroupMember.group_id).where(GroupMember.user_id == user.id)
    ).scalar_subquery()

    result = await db.execute(
        select(Category).where(
            Category.id == category_id,
            _system_or_personal_category_filter(user.id) | (Category.group_id.in_(group_ids)),
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
    """Create a new category. Personal by default, or group-scoped if group_id is provided."""
    if data.kind not in _VALID_KINDS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid category kind")

    group_id = data.group_id
    if group_id:
        # Any group member can create group categories
        member_result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user.id,
            ),
        )
        if not member_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")

    dup_query = select(Category).where(Category.name == data.name)
    if group_id:
        dup_query = dup_query.where(Category.group_id == group_id)
    else:
        dup_query = dup_query.where(_personal_category_filter(user.id))
    if (await db.execute(dup_query)).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Category with this name already exists")

    category = Category(
        owner_id=None if group_id else user.id,
        group_id=group_id,
        name=data.name,
        kind=data.kind,
        icon=data.icon,
    )
    db.add(category)
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Category with this name already exists",
        ) from e
    await db.refresh(category)
    return category


@router.patch("/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: uuid.UUID,
    data: UpdateCategoryRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a personal or group category. System categories are immutable."""
    group_ids = (
        select(GroupMember.group_id).where(GroupMember.user_id == user.id)
    ).scalar_subquery()

    result = await db.execute(
        select(Category).where(
            Category.id == category_id,
            _system_or_personal_category_filter(user.id) | (Category.group_id.in_(group_ids)),
        ),
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    if category.is_system:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="System categories cannot be modified")

    if category.group_id is not None:
        member_result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == category.group_id,
                GroupMember.user_id == user.id,
            ),
        )
        member = member_result.scalar_one_or_none()
        if not member or not member.is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return category

    for field, value in updates.items():
        setattr(category, field, value)

    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Category with this name already exists",
        ) from e
    await db.refresh(category)
    return category


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    category_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a personal or group category. System categories are immutable."""
    group_ids = (
        select(GroupMember.group_id).where(GroupMember.user_id == user.id)
    ).scalar_subquery()

    result = await db.execute(
        select(Category).where(
            Category.id == category_id,
            _system_or_personal_category_filter(user.id) | (Category.group_id.in_(group_ids)),
        ),
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    if category.is_system:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="System categories cannot be deleted")

    if category.group_id is not None:
        member_result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == category.group_id,
                GroupMember.user_id == user.id,
            ),
        )
        member = member_result.scalar_one_or_none()
        if not member or not member.is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    await db.delete(category)
    # The FK from transactions.category_id uses RESTRICT; catch the violation
    # and surface it as 409 instead of a 500 from the raw IntegrityError.
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Category is referenced by existing transactions",
        ) from e
