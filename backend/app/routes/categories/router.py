"""Category routes"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.routes.categories.access_helpers import get_accessible_category_or_404
from app.routes.categories.creation_helpers import create_category_for_user
from app.routes.categories.deletion_helpers import delete_category_for_user
from app.routes.categories.listing_helpers import get_categories_for_user
from app.routes.categories.merge_helpers import merge_category_into_replacement_for_user
from app.routes.categories.update_helpers import update_category_for_user
from app.schemas.category import (
    CategoryResponse,
    CreateCategoryRequest,
    MergeCategoryRequest,
    UpdateCategoryRequest,
)

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
    category = await create_category_for_user(db, user.id, data)
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
    category = await update_category_for_user(db, category_id, user.id, data)
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
    await merge_category_into_replacement_for_user(db, category_id, data.replacement_category_id, user.id)


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
    await delete_category_for_user(db, category_id, user.id)
