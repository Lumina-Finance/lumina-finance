import uuid
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.base import PermissionLevel
from app.models.budget import BaseBudget, BudgetPermission, BudgetTrackedCategory
from app.models.category import Category
from app.models.group import GroupMember
from app.models.user import User
from app.permissions import check_base_budget_access
from app.schemas.budget import BaseBudgetResponse, CreateBaseBudgetRequest, UpdateBaseBudgetRequest

router = APIRouter(prefix="/base-budgets", tags=["base-budgets"])


async def _check_group_admin_or_403(
    db: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID,
) -> GroupMember:
    """Return the user's membership or raise 403 if they lack admin access on the group."""
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id,
        ),
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    if not membership.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can manage base budgets")
    return membership


async def _validate_category_ids(
    db: AsyncSession, category_ids: list[uuid.UUID], user_id: uuid.UUID, group_id: uuid.UUID | None,
) -> list[uuid.UUID]:
    """Verify all category IDs exist and are in scope for the base budget. Returns deduplicated list.

    Scope rules:
    - Personal base budget (group_id is None): only the user's own personal categories
    - Group base budget: only categories owned by the same group

    Mixing scopes (e.g., a group base budget tracking a personal category) is rejected
    so every group member sees the same tracked-category set and the same totals.

    Note: `Category.owner_id` is the creator and is set even on group categories,
    so the personal branch also checks `group_id IS NULL` to keep group categories
    the user happens to have created out of personal base budgets.
    """
    if not category_ids:
        return []
    unique_ids = list(set(category_ids))
    query = select(Category.id).where(Category.id.in_(unique_ids))
    if group_id:
        query = query.where(Category.group_id == group_id)
    else:
        query = query.where(Category.owner_id == user_id, Category.group_id.is_(None))
    result = await db.execute(query)
    found = set(result.scalars().all())
    if found != set(unique_ids):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Category not found")
    return unique_ids


async def _build_base_budget_response(
    db: AsyncSession, base_budget: BaseBudget,
) -> BaseBudgetResponse:
    """Build a BaseBudgetResponse with currently-active tracked category IDs populated."""
    cat_result = await db.execute(
        select(BudgetTrackedCategory.category_id).where(
            BudgetTrackedCategory.base_budget_id == base_budget.id,
            BudgetTrackedCategory.removed_at.is_(None),
        ),
    )
    active_category_ids = list(cat_result.scalars().all())
    response = BaseBudgetResponse.model_validate(base_budget)
    response.category_ids = active_category_ids
    return response


@router.patch("/{base_budget_id}", response_model=BaseBudgetResponse)
async def update_base_budget(
    base_budget_id: uuid.UUID,
    data: UpdateBaseBudgetRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a base budget. Requires ADMIN access."""
    base_budget = await check_base_budget_access(db, base_budget_id, user.id, PermissionLevel.ADMIN)

    changed_fields = data.model_dump(exclude_unset=True)
    if not changed_fields:
        return await _build_base_budget_response(db, base_budget)

    # Handle tracked categories separately from simple field updates
    new_category_ids = changed_fields.pop("category_ids", None)

    for field, value in changed_fields.items():
        setattr(base_budget, field, value)

    # Update tracked categories if provided — soft-delete removed, insert new
    if new_category_ids is not None:
        validated = set(await _validate_category_ids(db, new_category_ids, user.id, base_budget.group_id))
        current_result = await db.execute(
            select(BudgetTrackedCategory.category_id).where(
                BudgetTrackedCategory.base_budget_id == base_budget_id,
                BudgetTrackedCategory.removed_at.is_(None),
            ),
        )
        current = set(current_result.scalars().all())

        # Soft-delete categories no longer tracked
        removed = current - validated
        if removed:
            await db.execute(
                sa.update(BudgetTrackedCategory)
                .where(
                    BudgetTrackedCategory.base_budget_id == base_budget_id,
                    BudgetTrackedCategory.category_id.in_(removed),
                    BudgetTrackedCategory.removed_at.is_(None),
                )
                .values(removed_at=sa.func.now()),
            )

        # Insert newly added categories
        added = validated - current
        for cat_id in added:
            db.add(BudgetTrackedCategory(base_budget_id=base_budget_id, category_id=cat_id))

    await db.commit()
    await db.refresh(base_budget)
    return await _build_base_budget_response(db, base_budget)


@router.delete("/{base_budget_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_base_budget(
    base_budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a base budget. Cascades to period instances, tracked categories, and permissions. Requires ADMIN access."""
    base_budget = await check_base_budget_access(db, base_budget_id, user.id, PermissionLevel.ADMIN)
    await db.delete(base_budget)
    await db.commit()


@router.get("/{base_budget_id}", response_model=BaseBudgetResponse)
async def get_base_budget(
    base_budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single base budget. Requires READ access."""
    base_budget = await check_base_budget_access(db, base_budget_id, user.id, PermissionLevel.READ)
    return await _build_base_budget_response(db, base_budget)


@router.get("", response_model=list[BaseBudgetResponse])
async def list_base_budgets(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return all base budgets the user owns or has access to via permissions."""
    query = (
        select(BaseBudget)
        .outerjoin(GroupMember, BaseBudget.group_id == GroupMember.group_id)
        .outerjoin(
            BudgetPermission,
            (BudgetPermission.base_budget_id == BaseBudget.id) & (BudgetPermission.user_id == user.id),
        )
        .where(
            (BaseBudget.owner_id == user.id)
            | ((GroupMember.user_id == user.id) & (GroupMember.is_admin.is_(True)))
            | (BudgetPermission.user_id == user.id),
        )
        .order_by(BaseBudget.name)
    )
    result = await db.execute(query)
    base_budgets = result.scalars().unique().all()
    return [await _build_base_budget_response(db, base_budget) for base_budget in base_budgets]


@router.post("", response_model=BaseBudgetResponse, status_code=status.HTTP_201_CREATED)
async def create_base_budget(
    data: CreateBaseBudgetRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a new base budget with optional tracked categories."""
    # Determine ownership
    owner_id = user.id
    group_id = data.group_id
    if group_id:
        await _check_group_admin_or_403(db, group_id, user.id)
        owner_id = None

    # Validate tracked category IDs
    validated_cat_ids = await _validate_category_ids(db, data.category_ids, user.id, group_id)

    base_budget = BaseBudget(
        owner_id=owner_id,
        group_id=group_id,
        name=data.name,
        currency=data.currency,
        recurrence_freq=data.recurrence_freq,
        recurrence_interval=data.recurrence_interval,
    )
    db.add(base_budget)
    await db.flush()

    # Link tracked categories
    for cat_id in validated_cat_ids:
        db.add(BudgetTrackedCategory(base_budget_id=base_budget.id, category_id=cat_id))

    await db.commit()
    await db.refresh(base_budget)
    return await _build_base_budget_response(db, base_budget)
