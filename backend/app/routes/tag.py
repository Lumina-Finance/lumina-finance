import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.tag import Tag
from app.models.user import User
from app.schemas.tag import CreateTagRequest, TagResponse, UpdateTagRequest

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("", response_model=list[TagResponse])
async def list_tags(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return all tags owned by the authenticated user."""
    result = await db.execute(
        select(Tag).where(Tag.owner_id == user.id).order_by(Tag.name),
    )
    return result.scalars().all()


@router.get("/{tag_id}", response_model=TagResponse)
async def get_tag(
    tag_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single tag by ID. Must belong to the authenticated user."""
    result = await db.execute(
        select(Tag).where(Tag.id == tag_id, Tag.owner_id == user.id),
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    return tag


@router.post("", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
async def create_tag(
    data: CreateTagRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a new tag for the authenticated user."""
    # Reject duplicate name for the same user
    result = await db.execute(
        select(Tag).where(Tag.owner_id == user.id, Tag.name == data.name),
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tag with this name already exists")

    tag = Tag(owner_id=user.id, name=data.name)
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return tag


@router.patch("/{tag_id}", response_model=TagResponse)
async def update_tag(
    tag_id: uuid.UUID,
    data: UpdateTagRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a tag. Only provided fields are changed."""
    result = await db.execute(
        select(Tag).where(Tag.id == tag_id, Tag.owner_id == user.id),
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")

    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return tag

    for field, value in updates.items():
        setattr(tag, field, value)

    await db.commit()
    await db.refresh(tag)
    return tag


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(
    tag_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a tag. Must belong to the authenticated user."""
    result = await db.execute(
        select(Tag).where(Tag.id == tag_id, Tag.owner_id == user.id),
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")

    await db.delete(tag)
    await db.commit()
