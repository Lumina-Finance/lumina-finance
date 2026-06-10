"""Tag routes"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.routes.tags.access_helpers import (
    get_accessible_tag_or_404,
    require_group_tag_admin,
)
from app.routes.tags.merge_helpers import merge_tag_into_replacement_for_user
from app.routes.tags.tag_creation_helpers import create_tag_for_user
from app.routes.tags.tag_listing_helpers import get_tags_for_user
from app.routes.tags.tag_update_helpers import update_tag_for_user
from app.schemas.tag import CreateTagRequest, MergeTagRequest, TagResponse, UpdateTagRequest
from app.services.cache_state import mark_cache_changed_for_scope

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("", response_model=list[TagResponse])
async def list_tags(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    group_id: Annotated[uuid.UUID | None, Query()] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    limit: Annotated[int | None, Query(ge=1, le=50)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    """Return tags visible in the requested scope

    Args:
        user: Authenticated user requesting tags
        db: Active database session
        group_id: Optional group scope to include with personal tags
        q: Optional name search text
        limit: Optional maximum number of tags to return
        offset: Number of tags to skip before returning rows

    Returns:
        Tags ordered by name
    """
    tags = await get_tags_for_user(db, user.id, group_id, q, limit, offset)
    return tags


@router.get("/{tag_id}", response_model=TagResponse)
async def get_tag(
    tag_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a tag visible to the user

    Args:
        tag_id: Tag identifier from the route path
        user: Authenticated user requesting the tag
        db: Active database session

    Returns:
        Tag visible to the user
    """
    tag = await get_accessible_tag_or_404(db, tag_id, user.id)
    return tag


@router.post("", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
async def create_tag(
    data: CreateTagRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a personal or group tag

    Args:
        data: Tag creation payload
        user: Authenticated user creating the tag
        db: Active database session

    Returns:
        Newly created tag
    """
    tag = await create_tag_for_user(db, user.id, data)
    return tag


@router.patch("/{tag_id}", response_model=TagResponse)
async def update_tag(
    tag_id: uuid.UUID,
    data: UpdateTagRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a personal or group tag

    Group tags require admin access

    Args:
        tag_id: Tag identifier from the route path
        data: Tag update payload
        user: Authenticated user updating the tag
        db: Active database session

    Returns:
        Updated tag
    """
    tag = await update_tag_for_user(db, tag_id, user.id, data)
    return tag


@router.post("/{tag_id}/merge", status_code=status.HTTP_204_NO_CONTENT)
async def merge_tag(
    tag_id: uuid.UUID,
    data: MergeTagRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Merge a tag into a replacement tag

    Args:
        tag_id: Tag identifier from the route path
        data: Merge payload with the replacement tag
        user: Authenticated user merging the tag
        db: Active database session
    """
    await merge_tag_into_replacement_for_user(db, tag_id, data.replacement_tag_id, user.id)


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(
    tag_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a personal or group tag

    Group tags require admin access

    Args:
        tag_id: Tag identifier from the route path
        user: Authenticated user deleting the tag
        db: Active database session
    """
    tag = await get_accessible_tag_or_404(db, tag_id, user.id)
    await require_group_tag_admin(db, tag, user.id)

    # Delete the tag and let the database reject existing transaction references
    await db.delete(tag)

    # Surface tag reference conflicts as a domain response instead of a raw integrity error
    try:
        await mark_cache_changed_for_scope(db, user_id=tag.owner_id, group_id=tag.group_id)
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tag is referenced by existing transactions",
        ) from e
