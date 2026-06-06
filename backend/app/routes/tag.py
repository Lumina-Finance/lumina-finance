import uuid
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.database import get_db
from app.dependencies import get_current_user
from app.models.group import GroupMember
from app.models.tag import Tag, TransactionTag
from app.models.user import User
from app.schemas.tag import CreateTagRequest, MergeTagRequest, TagResponse, UpdateTagRequest
from app.services.cache_state import mark_cache_changed_for_scope

router = APIRouter(prefix="/tags", tags=["tags"])


def _personal_tag_filter(user_id: uuid.UUID):
    return (Tag.owner_id == user_id) & (Tag.group_id.is_(None))


def _accessible_tag_filter(user_id: uuid.UUID):
    group_ids = (
        select(GroupMember.group_id).where(GroupMember.user_id == user_id)
    ).scalar_subquery()
    return _personal_tag_filter(user_id) | (Tag.group_id.in_(group_ids))


def _escape_like(value: str) -> str:
    """Escape LIKE-special characters so user input is matched literally."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def _get_accessible_tag_or_404(db: AsyncSession, tag_id: uuid.UUID, user_id: uuid.UUID) -> Tag:
    result = await db.execute(
        select(Tag).where(
            Tag.id == tag_id,
            _accessible_tag_filter(user_id),
        ),
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    return tag


async def _require_group_tag_admin(db: AsyncSession, tag: Tag, user_id: uuid.UUID) -> None:
    if tag.group_id is None:
        return

    member_result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == tag.group_id,
            GroupMember.user_id == user_id,
        ),
    )
    member = member_result.scalar_one_or_none()
    if not member or not member.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")


async def _get_merge_replacement_tag(
    db: AsyncSession, source: Tag, replacement_tag_id: uuid.UUID, user_id: uuid.UUID,
) -> Tag:
    if source.id == replacement_tag_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Replacement tag must be different",
        )

    replacement_filter = Tag.id == replacement_tag_id
    if source.group_id is None:
        replacement_filter = replacement_filter & _personal_tag_filter(user_id)
    else:
        replacement_filter = replacement_filter & (Tag.group_id == source.group_id)

    replacement_result = await db.execute(select(Tag).where(replacement_filter))
    replacement = replacement_result.scalar_one_or_none()
    if not replacement:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Replacement tag not found",
        )
    return replacement


async def _move_tag_references(db: AsyncSession, source_id: uuid.UUID, replacement_id: uuid.UUID) -> None:
    replacement_link = aliased(TransactionTag)
    await db.execute(
        sa.delete(TransactionTag).where(
            TransactionTag.tag_id == source_id,
            sa.exists().where(
                replacement_link.transaction_id == TransactionTag.transaction_id,
                replacement_link.tag_id == replacement_id,
            ),
        ),
    )
    await db.execute(
        sa.update(TransactionTag)
        .where(TransactionTag.tag_id == source_id)
        .values(tag_id=replacement_id),
    )


@router.get("", response_model=list[TagResponse])
async def list_tags(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    group_id: Annotated[uuid.UUID | None, Query()] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    limit: Annotated[int | None, Query(ge=1, le=50)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    """Return tags the user can access. Personal only by default, or include a group's tags."""
    query = select(Tag).where(Tag.owner_id == user.id, Tag.group_id.is_(None))

    if group_id:
        # Verify membership
        member_result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user.id,
            ),
        )
        if not member_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")

        query = select(Tag).where(
            ((Tag.owner_id == user.id) & (Tag.group_id.is_(None))) | (Tag.group_id == group_id),
        )

    search = q.strip() if q else ""
    if search:
        query = query.where(Tag.name.ilike(f"%{_escape_like(search)}%", escape="\\"))

    query = query.order_by(Tag.name)
    if limit is not None:
        query = query.limit(limit).offset(offset)

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{tag_id}", response_model=TagResponse)
async def get_tag(
    tag_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single tag. Must be personal or from a group the user belongs to."""
    group_ids = (
        select(GroupMember.group_id).where(GroupMember.user_id == user.id)
    ).scalar_subquery()

    result = await db.execute(
        select(Tag).where(
            Tag.id == tag_id,
            ((Tag.owner_id == user.id) & (Tag.group_id.is_(None))) | (Tag.group_id.in_(group_ids)),
        ),
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
    """Create a new tag. Personal by default, or group-scoped if group_id is provided."""
    group_id = data.group_id
    if group_id:
        # Any group member can create group tags
        member_result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user.id,
            ),
        )
        if not member_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")

    # Reject duplicate name within the scope (group or personal)
    dup_query = select(Tag).where(Tag.name == data.name)
    if group_id:
        dup_query = dup_query.where(Tag.group_id == group_id)
    else:
        dup_query = dup_query.where(Tag.owner_id == user.id, Tag.group_id.is_(None))
    if (await db.execute(dup_query)).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tag with this name already exists")

    tag = Tag(owner_id=user.id, group_id=group_id, name=data.name)
    db.add(tag)
    await mark_cache_changed_for_scope(db, user_id=tag.owner_id, group_id=tag.group_id)
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
    """Update a tag. Group tags require admin role."""
    group_ids = (
        select(GroupMember.group_id).where(GroupMember.user_id == user.id)
    ).scalar_subquery()

    result = await db.execute(
        select(Tag).where(
            Tag.id == tag_id,
            ((Tag.owner_id == user.id) & (Tag.group_id.is_(None))) | (Tag.group_id.in_(group_ids)),
        ),
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")

    # Group tags require admin
    if tag.group_id is not None:
        member_result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == tag.group_id,
                GroupMember.user_id == user.id,
            ),
        )
        member = member_result.scalar_one_or_none()
        if not member or not member.is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return tag

    for field, value in updates.items():
        setattr(tag, field, value)

    try:
        await mark_cache_changed_for_scope(db, user_id=tag.owner_id, group_id=tag.group_id)
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tag with this name already exists",
        ) from e
    await db.refresh(tag)
    return tag


@router.post("/{tag_id}/merge", status_code=status.HTTP_204_NO_CONTENT)
async def merge_tag(
    tag_id: uuid.UUID,
    data: MergeTagRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Move transaction references to another tag, then delete the source tag."""
    tag = await _get_accessible_tag_or_404(db, tag_id, user.id)
    await _require_group_tag_admin(db, tag, user.id)
    replacement = await _get_merge_replacement_tag(db, tag, data.replacement_tag_id, user.id)
    await _move_tag_references(db, tag.id, replacement.id)
    await mark_cache_changed_for_scope(db, user_id=tag.owner_id, group_id=tag.group_id)
    await db.delete(tag)
    await db.commit()


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(
    tag_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a tag. Group tags require admin role."""
    group_ids = (
        select(GroupMember.group_id).where(GroupMember.user_id == user.id)
    ).scalar_subquery()

    result = await db.execute(
        select(Tag).where(
            Tag.id == tag_id,
            ((Tag.owner_id == user.id) & (Tag.group_id.is_(None))) | (Tag.group_id.in_(group_ids)),
        ),
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")

    # Only admins can delete group tags
    if tag.group_id is not None:
        member_result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == tag.group_id,
                GroupMember.user_id == user.id,
            ),
        )
        member = member_result.scalar_one_or_none()
        if not member or not member.is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    await db.delete(tag)
    try:
        await mark_cache_changed_for_scope(db, user_id=tag.owner_id, group_id=tag.group_id)
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Tag is referenced by existing transactions",
        ) from e
