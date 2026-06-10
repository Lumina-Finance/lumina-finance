"""Category routes"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.category import Category
from app.models.user import User
from app.routes.categories.access_helpers import (
    get_accessible_category_or_404,
    is_valid_category_kind,
    require_category_name_available,
    require_group_category_admin,
    require_group_member,
)
from app.routes.categories.category_listing_helpers import get_categories_for_user
from app.routes.categories.merge_helpers import get_merge_replacement_category, move_category_references
from app.schemas.category import (
    CategoryResponse,
    CreateCategoryRequest,
    MergeCategoryRequest,
    UpdateCategoryRequest,
)
from app.services.cache_state import mark_cache_changed_for_scope

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategoryResponse])
async def list_categories(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    group_id: Annotated[uuid.UUID | None, Query()] = None,
):
    """Return categories visible in the requested scope

    Args:
        user: Authenticated user requesting categories
        db: Active database session
        group_id: Optional group scope to include with system and personal categories

    Returns:
        Categories ordered by name
    """
    categories = await get_categories_for_user(db, user.id, group_id)
    return categories


@router.get("/{category_id}", response_model=CategoryResponse)
async def get_category(
    category_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a category visible to the user

    Args:
        category_id: Category identifier from the route path
        user: Authenticated user requesting the category
        db: Active database session

    Returns:
        Category visible to the user
    """
    category = await get_accessible_category_or_404(db, category_id, user.id)
    return category


@router.post("", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(
    data: CreateCategoryRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a personal or group category

    Args:
        data: Category creation payload
        user: Authenticated user creating the category
        db: Active database session

    Returns:
        Newly created category
    """
    if not is_valid_category_kind(data.kind):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid category kind")

    group_id = data.group_id
    if group_id:
        await require_group_member(db, group_id, user.id)

    await require_category_name_available(db, data.name, user.id, group_id)

    category = Category(
        owner_id=None if group_id else user.id,
        group_id=group_id,
        name=data.name,
        kind=data.kind,
        icon=data.icon,
    )
    db.add(category)
    try:
        await mark_cache_changed_for_scope(db, user_id=category.owner_id, group_id=category.group_id)
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
    """Update a personal or group category

    System categories are immutable, and group categories require admin access

    Args:
        category_id: Category identifier from the route path
        data: Category update payload
        user: Authenticated user updating the category
        db: Active database session

    Returns:
        Updated category
    """
    category = await get_accessible_category_or_404(db, category_id, user.id)

    if category.is_system:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="System categories cannot be modified")

    await require_group_category_admin(db, category, user.id)

    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return category

    if "name" in updates and updates["name"] is not None:
        await require_category_name_available(db, updates["name"], user.id, category.group_id, category.id)

    for field, value in updates.items():
        setattr(category, field, value)

    try:
        await mark_cache_changed_for_scope(db, user_id=category.owner_id, group_id=category.group_id)
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Category with this name already exists",
        ) from e
    await db.refresh(category)
    return category


@router.post("/{category_id}/merge", status_code=status.HTTP_204_NO_CONTENT)
async def merge_category(
    category_id: uuid.UUID,
    data: MergeCategoryRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Merge a category into a replacement category

    Args:
        category_id: Category identifier from the route path
        data: Merge payload with the replacement category
        user: Authenticated user merging the category
        db: Active database session
    """
    category = await get_accessible_category_or_404(db, category_id, user.id)
    if category.is_system:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="System categories cannot be deleted")

    await require_group_category_admin(db, category, user.id)
    replacement = await get_merge_replacement_category(db, category, data.replacement_category_id, user.id)
    await move_category_references(db, category.id, replacement.id)
    await mark_cache_changed_for_scope(db, user_id=category.owner_id, group_id=category.group_id)

    # Delete the source category after all category references point to the replacement
    await db.delete(category)
    await db.commit()


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(
    category_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a personal or group category

    System categories are immutable, and group categories require admin access

    Args:
        category_id: Category identifier from the route path
        user: Authenticated user deleting the category
        db: Active database session
    """
    category = await get_accessible_category_or_404(db, category_id, user.id)

    if category.is_system:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="System categories cannot be deleted")

    await require_group_category_admin(db, category, user.id)

    # Delete the category and let the database reject existing transaction references
    await db.delete(category)

    # Surface category reference conflicts as a domain response instead of a raw integrity error
    try:
        await mark_cache_changed_for_scope(db, user_id=category.owner_id, group_id=category.group_id)
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Category is referenced by existing transactions",
        ) from e
