import uuid
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.category import Category
from app.models.group import GroupMember
from app.models.merchant import Merchant
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.merchant import CreateMerchantRequest, MerchantResponse, MergeMerchantRequest, UpdateMerchantRequest

router = APIRouter(prefix="/merchants", tags=["merchants"])


def _personal_category_filter(user_id: uuid.UUID):
    return (Category.owner_id == user_id) & (Category.group_id.is_(None))


def _category_scope_filter(user_id: uuid.UUID, group_id: uuid.UUID | None):
    category_filter = Category.is_system.is_(True) | _personal_category_filter(user_id)
    if group_id is not None:
        category_filter = category_filter | (Category.group_id == group_id)
    return category_filter


def _personal_merchant_filter(user_id: uuid.UUID):
    return (Merchant.owner_id == user_id) & (Merchant.group_id.is_(None))


def _accessible_merchant_filter(user_id: uuid.UUID):
    group_ids = (
        select(GroupMember.group_id).where(GroupMember.user_id == user_id)
    ).scalar_subquery()
    return _personal_merchant_filter(user_id) | (Merchant.group_id.in_(group_ids))


async def _get_accessible_merchant_or_404(db: AsyncSession, merchant_id: uuid.UUID, user_id: uuid.UUID) -> Merchant:
    result = await db.execute(
        select(Merchant).where(
            Merchant.id == merchant_id,
            _accessible_merchant_filter(user_id),
        ),
    )
    merchant = result.scalar_one_or_none()
    if not merchant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Merchant not found")
    return merchant


async def _require_group_merchant_admin(db: AsyncSession, merchant: Merchant, user_id: uuid.UUID) -> None:
    if merchant.group_id is None:
        return

    member_result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == merchant.group_id,
            GroupMember.user_id == user_id,
        ),
    )
    member = member_result.scalar_one_or_none()
    if not member or not member.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")


async def _get_merge_replacement_merchant(
    db: AsyncSession, source: Merchant, replacement_merchant_id: uuid.UUID, user_id: uuid.UUID,
) -> Merchant:
    if source.id == replacement_merchant_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Replacement merchant must be different",
        )

    replacement_filter = Merchant.id == replacement_merchant_id
    if source.group_id is None:
        replacement_filter = replacement_filter & _personal_merchant_filter(user_id)
    else:
        replacement_filter = replacement_filter & (Merchant.group_id == source.group_id)

    replacement_result = await db.execute(select(Merchant).where(replacement_filter))
    replacement = replacement_result.scalar_one_or_none()
    if not replacement:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Replacement merchant not found",
        )
    return replacement


async def _move_merchant_references(db: AsyncSession, source_id: uuid.UUID, replacement_id: uuid.UUID) -> None:
    await db.execute(
        sa.update(Transaction)
        .where(Transaction.merchant_id == source_id)
        .values(merchant_id=replacement_id),
    )


@router.get("", response_model=list[MerchantResponse])
async def list_merchants(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    group_id: Annotated[uuid.UUID | None, Query()] = None,
):
    """Return merchants the user can access. Personal only by default, or include a group's merchants."""
    # Without a filter, only return personal merchants (group_id is null)
    query = select(Merchant).where(Merchant.owner_id == user.id, Merchant.group_id.is_(None))

    if group_id:
        member_result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user.id,
            ),
        )
        if not member_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")

        query = select(Merchant).where(
            ((Merchant.owner_id == user.id) & (Merchant.group_id.is_(None))) | (Merchant.group_id == group_id),
        )

    result = await db.execute(query.order_by(Merchant.name))
    return result.scalars().all()


@router.get("/{merchant_id}", response_model=MerchantResponse)
async def get_merchant(
    merchant_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single merchant. Must be personal or from a group the user belongs to."""
    group_ids = (
        select(GroupMember.group_id).where(GroupMember.user_id == user.id)
    ).scalar_subquery()

    result = await db.execute(
        select(Merchant).where(
            Merchant.id == merchant_id,
            ((Merchant.owner_id == user.id) & (Merchant.group_id.is_(None))) | (Merchant.group_id.in_(group_ids)),
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
    """Create a new merchant. Personal by default, or group-scoped if group_id is provided."""
    group_id = data.group_id
    if group_id:
        # Any group member can create group merchants
        member_result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user.id,
            ),
        )
        if not member_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")

    # Reject duplicate name within the scope (group or personal)
    dup_query = select(Merchant).where(Merchant.name == data.name)
    if group_id:
        dup_query = dup_query.where(Merchant.group_id == group_id)
    else:
        dup_query = dup_query.where(Merchant.owner_id == user.id, Merchant.group_id.is_(None))
    if (await db.execute(dup_query)).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Merchant with this name already exists")

    # Validate default_category_id (accept personal or same group categories)
    if data.default_category_id:
        cat_query = select(Category).where(
            Category.id == data.default_category_id,
            _category_scope_filter(user.id, group_id),
        )
        if not (await db.execute(cat_query)).scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")

    merchant = Merchant(
        owner_id=user.id,
        group_id=group_id,
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
    """Update a merchant. Group merchants require admin role."""
    group_ids = (
        select(GroupMember.group_id).where(GroupMember.user_id == user.id)
    ).scalar_subquery()

    result = await db.execute(
        select(Merchant).where(
            Merchant.id == merchant_id,
            ((Merchant.owner_id == user.id) & (Merchant.group_id.is_(None))) | (Merchant.group_id.in_(group_ids)),
        ),
    )
    merchant = result.scalar_one_or_none()
    if not merchant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Merchant not found")

    # Only admins can update group merchants
    if merchant.group_id is not None:
        member_result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == merchant.group_id,
                GroupMember.user_id == user.id,
            ),
        )
        member = member_result.scalar_one_or_none()
        if not member or not member.is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return merchant

    # Validate default_category_id (accept personal or same group categories)
    if "default_category_id" in updates and updates["default_category_id"] is not None:
        cat_query = select(Category).where(
            Category.id == updates["default_category_id"],
            _category_scope_filter(user.id, merchant.group_id),
        )
        if not (await db.execute(cat_query)).scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")

    for field, value in updates.items():
        setattr(merchant, field, value)

    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Merchant with this name already exists",
        ) from e
    await db.refresh(merchant)
    return merchant


@router.post("/{merchant_id}/merge", status_code=status.HTTP_204_NO_CONTENT)
async def merge_merchant(
    merchant_id: uuid.UUID,
    data: MergeMerchantRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Move transaction references to another merchant, then delete the source merchant."""
    merchant = await _get_accessible_merchant_or_404(db, merchant_id, user.id)
    await _require_group_merchant_admin(db, merchant, user.id)
    replacement = await _get_merge_replacement_merchant(db, merchant, data.replacement_merchant_id, user.id)
    await _move_merchant_references(db, merchant.id, replacement.id)
    await db.delete(merchant)
    await db.commit()


@router.delete("/{merchant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_merchant(
    merchant_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a merchant. Group merchants require admin role."""
    # Fetch merchant if the user owns it or is a member of its group
    group_ids = (
        select(GroupMember.group_id).where(GroupMember.user_id == user.id)
    ).scalar_subquery()

    result = await db.execute(
        select(Merchant).where(
            Merchant.id == merchant_id,
            ((Merchant.owner_id == user.id) & (Merchant.group_id.is_(None))) | (Merchant.group_id.in_(group_ids)),
        ),
    )
    merchant = result.scalar_one_or_none()
    if not merchant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Merchant not found")

    # Only admins can delete group merchants
    if merchant.group_id is not None:
        member_result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == merchant.group_id,
                GroupMember.user_id == user.id,
            ),
        )
        member = member_result.scalar_one_or_none()
        if not member or not member.is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    await db.delete(merchant)
    # The FK from transactions.merchant_id uses RESTRICT; catch the violation
    # and surface it as 409 instead of a 500 from the raw IntegrityError.
    try:
        await db.commit()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Merchant is referenced by existing transactions",
        ) from e
