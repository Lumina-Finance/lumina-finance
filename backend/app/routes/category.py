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
from app.models.base import CategoryKind
from app.models.budget import BudgetTrackedCategory
from app.models.category import Category
from app.models.group import GroupMember
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.category import (
    CategoryResponse,
    CreateCategoryRequest,
    MergeCategoryRequest,
    UpdateCategoryRequest,
)
from app.services.cache_state import mark_cache_changed_for_scope

router = APIRouter(prefix="/categories", tags=["categories"])

_VALID_KINDS = {e.value for e in CategoryKind}


def _personal_category_filter(user_id: uuid.UUID):
    return (Category.owner_id == user_id) & (Category.group_id.is_(None))


def _system_or_personal_category_filter(user_id: uuid.UUID):
    return Category.is_system.is_(True) | _personal_category_filter(user_id)


def _accessible_category_filter(user_id: uuid.UUID):
    group_ids = (
        select(GroupMember.group_id).where(GroupMember.user_id == user_id)
    ).scalar_subquery()
    return _system_or_personal_category_filter(user_id) | (Category.group_id.in_(group_ids))


def _category_name_conflict_filter(name: str, user_id: uuid.UUID, group_id: uuid.UUID | None):
    scope_filter = Category.is_system.is_(True)
    if group_id:
        scope_filter = scope_filter | (Category.group_id == group_id)
    else:
        scope_filter = scope_filter | _personal_category_filter(user_id)

    return (sa.func.lower(Category.name) == name.casefold()) & scope_filter


async def _require_category_name_available(
    db: AsyncSession,
    name: str,
    user_id: uuid.UUID,
    group_id: uuid.UUID | None,
    exclude_category_id: uuid.UUID | None = None,
) -> None:
    conflict_query = select(Category.id).where(_category_name_conflict_filter(name, user_id, group_id)).limit(1)
    if exclude_category_id is not None:
        conflict_query = conflict_query.where(Category.id != exclude_category_id)

    if (await db.execute(conflict_query)).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Category with this name already exists")


async def _get_accessible_category_or_404(db: AsyncSession, category_id: uuid.UUID, user_id: uuid.UUID) -> Category:
    result = await db.execute(
        select(Category).where(
            Category.id == category_id,
            _accessible_category_filter(user_id),
        ),
    )
    category = result.scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    return category


async def _require_group_category_admin(db: AsyncSession, category: Category, user_id: uuid.UUID) -> None:
    if category.group_id is None:
        return

    member_result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == category.group_id,
            GroupMember.user_id == user_id,
        ),
    )
    member = member_result.scalar_one_or_none()
    if not member or not member.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")


async def _get_merge_replacement_category(
    db: AsyncSession, source: Category, replacement_category_id: uuid.UUID, user_id: uuid.UUID,
) -> Category:
    if source.id == replacement_category_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Replacement category must be different",
        )

    replacement_filter = Category.id == replacement_category_id
    if source.group_id is None:
        replacement_filter = replacement_filter & _system_or_personal_category_filter(user_id)
    else:
        replacement_filter = replacement_filter & (
            Category.is_system.is_(True) | (Category.group_id == source.group_id)
        )

    replacement_result = await db.execute(select(Category).where(replacement_filter))
    replacement = replacement_result.scalar_one_or_none()
    if not replacement:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Replacement category not found",
        )
    if replacement.kind != source.kind:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Replacement category kind must match",
        )
    return replacement


async def _move_category_references(db: AsyncSession, source_id: uuid.UUID, replacement_id: uuid.UUID) -> None:
    replacement_tracked = aliased(BudgetTrackedCategory)
    await db.execute(
        sa.delete(BudgetTrackedCategory).where(
            BudgetTrackedCategory.category_id == source_id,
            BudgetTrackedCategory.removed_at.is_(None),
            sa.exists().where(
                replacement_tracked.base_budget_id == BudgetTrackedCategory.base_budget_id,
                replacement_tracked.category_id == replacement_id,
                replacement_tracked.removed_at.is_(None),
            ),
        ),
    )
    await db.execute(
        sa.update(Transaction)
        .where(Transaction.category_id == source_id)
        .values(category_id=replacement_id),
    )
    await db.execute(
        sa.update(Merchant)
        .where(Merchant.default_category_id == source_id)
        .values(default_category_id=replacement_id),
    )
    await db.execute(
        sa.update(BudgetTrackedCategory)
        .where(BudgetTrackedCategory.category_id == source_id)
        .values(category_id=replacement_id),
    )


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

    await _require_category_name_available(db, data.name, user.id, group_id)

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

    if "name" in updates and updates["name"] is not None:
        await _require_category_name_available(db, updates["name"], user.id, category.group_id, category.id)

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
    """Move references to another category, then delete the source category."""
    category = await _get_accessible_category_or_404(db, category_id, user.id)
    if category.is_system:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="System categories cannot be deleted")

    await _require_group_category_admin(db, category, user.id)
    replacement = await _get_merge_replacement_category(db, category, data.replacement_category_id, user.id)
    await _move_category_references(db, category.id, replacement.id)
    await mark_cache_changed_for_scope(db, user_id=category.owner_id, group_id=category.group_id)
    await db.delete(category)
    await db.commit()


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
        await mark_cache_changed_for_scope(db, user_id=category.owner_id, group_id=category.group_id)
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Category is referenced by existing transactions",
        ) from e
