import uuid
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.account import Account
from app.models.base import PermissionLevel
from app.models.budget import Budget, BudgetPermission, BudgetTrackedCategory
from app.models.category import Category
from app.models.group import GroupMember
from app.models.transaction import Transaction
from app.models.user import User
from app.permissions import check_budget_access
from app.schemas.budget import (
    BudgetCategoryUtilization,
    BudgetResponse,
    BudgetUtilizationResponse,
    CreateBudgetRequest,
    UpdateBudgetRequest,
)
from app.schemas.permission import BudgetPermissionResponse, GrantBudgetPermissionRequest

router = APIRouter(prefix="/budgets", tags=["budgets"])


async def _check_group_admin_or_403(
    db: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID,
) -> GroupMember:
    """Return the user's membership or raise 403 if they lack admin access.

    Args:
        db: Async database session.
        group_id: UUID of the group.
        user_id: UUID of the user.

    Returns:
        The GroupMember row.

    Raises:
        HTTPException 404: User is not a member of the group.
        HTTPException 403: User is not an admin.
    """
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
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can manage budgets")
    return membership


async def _validate_category_ids(
    db: AsyncSession, category_ids: list[uuid.UUID], user_id: uuid.UUID, group_id: uuid.UUID | None,
) -> list[uuid.UUID]:
    """Verify all category IDs exist and are in scope for the budget. Returns deduplicated list.

    Scope rules:
    - Personal budget (group_id is None): only the user's own personal categories
    - Group budget: only categories owned by the same group
    Mixing scopes (e.g., a group budget tracking a personal category) is rejected
    so every group member sees the same tracked-category set and the same totals.
    Otherwise members would see UUIDs they don't own and their own transactions
    wouldn't reconcile across the group.

    Note: `Category.owner_id` is the creator and is set even on group categories,
    so the personal branch must also check `group_id IS NULL` to keep group
    categories the user happens to have created out of personal budgets.

    Args:
        db: Async database session.
        category_ids: List of category UUIDs to validate.
        user_id: UUID of the requesting user.
        group_id: UUID of the group, or None for personal budgets.

    Returns:
        Deduplicated list of valid category IDs.

    Raises:
        HTTPException 422: One or more categories not found or out of scope.
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


async def _get_active_category_ids(db: AsyncSession, budget_id: uuid.UUID) -> list[uuid.UUID]:
    """Fetch currently active tracked category IDs for a budget (removed_at is null).

    Args:
        db: Async database session.
        budget_id: UUID of the budget.

    Returns:
        List of active category UUIDs.
    """
    result = await db.execute(
        select(BudgetTrackedCategory.category_id).where(
            BudgetTrackedCategory.budget_id == budget_id,
            BudgetTrackedCategory.removed_at.is_(None),
        ),
    )
    return list(result.scalars().all())


async def _build_budget_response(db: AsyncSession, budget: Budget) -> BudgetResponse:
    """Build a BudgetResponse with tracked category IDs.

    Args:
        db: Async database session.
        budget: The Budget model instance.

    Returns:
        BudgetResponse with category_ids populated.
    """
    category_ids = await _get_active_category_ids(db, budget.id)
    resp = BudgetResponse.model_validate(budget)
    resp.category_ids = category_ids
    return resp


@router.get("/{budget_id}", response_model=BudgetResponse)
async def get_budget(
    budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single budget. Requires READ access."""
    budget = await check_budget_access(db, budget_id, user.id, PermissionLevel.READ)
    return await _build_budget_response(db, budget)


@router.get("/{budget_id}/utilization", response_model=BudgetUtilizationResponse)
async def get_budget_utilization(
    budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return per-category spending totals for the budget's period.

    Requires READ on the budget; access to the underlying accounts is not
    required. This enables privacy-respecting monitoring (e.g., a group
    admin sees category totals without individual transactions on accounts
    they don't have read permission on).

    Currently-active tracked categories are always included, even with zero
    spend, so the frontend can render every tracked category.
    """
    budget = await check_budget_access(db, budget_id, user.id, PermissionLevel.READ)

    # Currently-tracked categories (soft-deleted ones are excluded)
    tracked_result = await db.execute(
        select(BudgetTrackedCategory.category_id).where(
            BudgetTrackedCategory.budget_id == budget_id,
            BudgetTrackedCategory.removed_at.is_(None),
        ),
    )
    tracked_category_ids = list(tracked_result.scalars().all())

    # Sum amounts per category for transactions whose UTC date falls in the period.
    # Transaction.amount is stored in the parent account's currency, so we restrict
    # the join to accounts whose currency matches the budget's, which prevents a
    # multi-currency user from mixing e.g. USD and CAD totals when the same
    # category is used across accounts of different currencies.
    # Scope is also constrained to accounts the budget actually owns (the user's
    # personal accounts for personal budgets, the group's accounts for group
    # budgets) so cross-scope spending never bleeds in.
    spend_map: dict[uuid.UUID, int] = {}
    if tracked_category_ids:
        ts_day = cast(func.timezone("UTC", Transaction.ts), Date)
        scope_filter = (
            Account.group_id == budget.group_id
            if budget.group_id
            else Account.owner_id == budget.owner_id
        )
        spend_result = await db.execute(
            select(
                Transaction.category_id,
                func.sum(Transaction.amount).label("amount_sum"),
            )
            .join(Account, Transaction.account_id == Account.id)
            .where(
                Transaction.category_id.in_(tracked_category_ids),
                ts_day >= budget.period_start,
                ts_day <= budget.period_end,
                Account.currency == budget.currency,
                scope_filter,
            )
            .group_by(Transaction.category_id),
        )
        spend_map = {row.category_id: row.amount_sum for row in spend_result}

    # Build per-category utilization (positive = net outflow)
    categories = [
        BudgetCategoryUtilization(category_id=cat_id, spent=-spend_map.get(cat_id, 0))
        for cat_id in tracked_category_ids
    ]
    total_spent = sum(c.spent for c in categories)

    return BudgetUtilizationResponse(
        budget_id=budget.id,
        period_start=budget.period_start,
        period_end=budget.period_end,
        overall_limit=budget.overall_limit,
        total_spent=total_spent,
        categories=categories,
    )


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_budget(
    budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a budget. Requires ADMIN access."""
    budget = await check_budget_access(db, budget_id, user.id, PermissionLevel.ADMIN)
    await db.delete(budget)
    await db.commit()


@router.patch("/{budget_id}", response_model=BudgetResponse)
async def update_budget(
    budget_id: uuid.UUID,
    data: UpdateBudgetRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a budget. Requires ADMIN access."""
    budget = await check_budget_access(db, budget_id, user.id, PermissionLevel.ADMIN)

    changed_fields = data.model_dump(exclude_unset=True)
    if not changed_fields:
        return await _build_budget_response(db, budget)

    # Validate period if either date is being changed
    if "period_start" in changed_fields or "period_end" in changed_fields:
        new_start = changed_fields.get("period_start", budget.period_start)
        new_end = changed_fields.get("period_end", budget.period_end)
        if new_start > new_end:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Period start must not be after period end")

    # Handle tracked categories separately
    new_category_ids = changed_fields.pop("category_ids", None)

    for field, value in changed_fields.items():
        setattr(budget, field, value)

    # Update tracked categories if provided — soft-delete removed, insert new
    if new_category_ids is not None:
        validated = set(await _validate_category_ids(db, new_category_ids, user.id, budget.group_id))
        current = set(await _get_active_category_ids(db, budget_id))

        # Soft-delete categories that are no longer tracked
        removed = current - validated
        if removed:
            await db.execute(
                sa.update(BudgetTrackedCategory)
                .where(
                    BudgetTrackedCategory.budget_id == budget_id,
                    BudgetTrackedCategory.category_id.in_(removed),
                    BudgetTrackedCategory.removed_at.is_(None),
                )
                .values(removed_at=sa.func.now()),
            )

        # Insert newly added categories
        added = validated - current
        for cat_id in added:
            db.add(BudgetTrackedCategory(budget_id=budget_id, category_id=cat_id))

    await db.commit()
    await db.refresh(budget)
    return await _build_budget_response(db, budget)


@router.get("", response_model=list[BudgetResponse])
async def list_budgets(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return all budgets the user owns or has access to via permissions."""
    # Personal budgets + group budgets where user is admin or has explicit permission
    query = (
        select(Budget)
        .outerjoin(GroupMember, Budget.group_id == GroupMember.group_id)
        .outerjoin(
            BudgetPermission,
            (BudgetPermission.budget_id == Budget.id) & (BudgetPermission.user_id == user.id),
        )
        .where(
            (Budget.owner_id == user.id)
            | ((GroupMember.user_id == user.id) & (GroupMember.is_admin.is_(True)))
            | (BudgetPermission.user_id == user.id),
        )
        .order_by(Budget.period_end.desc(), Budget.name)
    )
    result = await db.execute(query)
    budgets = result.scalars().unique().all()

    # Batch fetch active tracked categories for all budgets
    budget_ids = [b.id for b in budgets]
    cat_map: dict[uuid.UUID, list[uuid.UUID]] = {b_id: [] for b_id in budget_ids}
    if budget_ids:
        cat_result = await db.execute(
            select(BudgetTrackedCategory).where(
                BudgetTrackedCategory.budget_id.in_(budget_ids),
                BudgetTrackedCategory.removed_at.is_(None),
            ),
        )
        for row in cat_result.scalars().all():
            cat_map[row.budget_id].append(row.category_id)

    responses = []
    for budget in budgets:
        resp = BudgetResponse.model_validate(budget)
        resp.category_ids = cat_map[budget.id]
        responses.append(resp)
    return responses


@router.post("", response_model=BudgetResponse, status_code=status.HTTP_201_CREATED)
async def create_budget(
    data: CreateBudgetRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a new budget with optional tracked categories."""
    # Validate period
    if data.period_start > data.period_end:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Period start must not be after period end")

    # Determine ownership
    owner_id = user.id
    group_id = data.group_id
    if group_id:
        await _check_group_admin_or_403(db, group_id, user.id)
        owner_id = None

    # Validate base budget if this is a recurring instance
    if data.base_budget_id:
        base_query = select(Budget).where(Budget.id == data.base_budget_id)
        if group_id:
            base_query = base_query.where(Budget.group_id == group_id)
        else:
            base_query = base_query.where(Budget.owner_id == user.id)
        base_result = await db.execute(base_query)
        if not base_result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Base budget not found")

    # Validate tracked category IDs
    validated_cat_ids = await _validate_category_ids(db, data.category_ids, user.id, group_id)

    # Generate ID in Python to avoid intermediate flush
    budget_id = uuid.uuid4()
    budget = Budget(
        id=budget_id,
        owner_id=owner_id,
        group_id=group_id,
        base_budget_id=data.base_budget_id,
        name=data.name,
        period_start=data.period_start,
        period_end=data.period_end,
        recurrence_freq=data.recurrence_freq,
        recurrence_interval=data.recurrence_interval,
        overall_limit=data.overall_limit,
        currency=data.currency,
    )
    db.add(budget)

    # Link tracked categories
    for cat_id in validated_cat_ids:
        db.add(BudgetTrackedCategory(budget_id=budget_id, category_id=cat_id))

    await db.commit()
    await db.refresh(budget)
    return await _build_budget_response(db, budget)


# --- Budget permissions ---


async def _get_group_budget_or_404(
    db: AsyncSession, budget_id: uuid.UUID,
) -> Budget:
    """Fetch a budget that belongs to a group, or raise 404.

    Personal budgets also return 404 (not 422) so that unauthorized
    callers cannot distinguish between nonexistent and personal budgets.

    Args:
        db: Async database session.
        budget_id: UUID of the budget.

    Returns:
        The Budget row with group_id set.

    Raises:
        HTTPException 404: Budget not found or is a personal budget.
    """
    result = await db.execute(select(Budget).where(Budget.id == budget_id))
    budget = result.scalar_one_or_none()
    if not budget or not budget.group_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found")
    return budget


async def _check_budget_admin_or_403(
    db: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID,
) -> GroupMember:
    """Verify the user is an admin of the budget's group.

    Args:
        db: Async database session.
        group_id: UUID of the group.
        user_id: UUID of the user.

    Returns:
        The GroupMember row.

    Raises:
        HTTPException 404: User is not a member of the group.
        HTTPException 403: User is not an admin.
    """
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id,
        ),
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found")
    if not membership.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return membership


@router.post("/{budget_id}/permissions", response_model=BudgetPermissionResponse, status_code=status.HTTP_201_CREATED)
async def grant_budget_permission(
    budget_id: uuid.UUID,
    data: GrantBudgetPermissionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Grant or update a member's access level on a group budget. Requires admin."""
    budget = await _get_group_budget_or_404(db, budget_id)
    await _check_budget_admin_or_403(db, budget.group_id, user.id)

    # Target must be a non-admin group member (admins have implicit full access)
    target_result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == budget.group_id,
            GroupMember.user_id == data.user_id,
        ),
    )
    target_member = target_result.scalar_one_or_none()
    if not target_member:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="User is not a member of this group")
    if target_member.is_admin:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Admins have implicit full access")

    # Update level if permission already exists, otherwise create a new one
    existing_result = await db.execute(
        select(BudgetPermission).where(
            BudgetPermission.group_id == budget.group_id,
            BudgetPermission.user_id == data.user_id,
            BudgetPermission.budget_id == budget_id,
        ),
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        existing.level = data.level
        await db.commit()
        await db.refresh(existing)
        return existing

    budget_permission = BudgetPermission(
        group_id=budget.group_id,
        user_id=data.user_id,
        budget_id=budget_id,
        level=data.level,
    )
    db.add(budget_permission)
    await db.commit()
    await db.refresh(budget_permission)
    return budget_permission


@router.delete("/{budget_id}/permissions/{permission_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_budget_permission(
    budget_id: uuid.UUID,
    permission_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Revoke a member's access to a group budget. Requires admin."""
    budget = await _get_group_budget_or_404(db, budget_id)
    await _check_budget_admin_or_403(db, budget.group_id, user.id)

    result = await db.execute(
        select(BudgetPermission).where(
            BudgetPermission.id == permission_id,
            BudgetPermission.budget_id == budget_id,
        ),
    )
    budget_permission = result.scalar_one_or_none()
    if not budget_permission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Permission not found")

    await db.delete(budget_permission)
    await db.commit()


@router.get("/{budget_id}/permissions", response_model=list[BudgetPermissionResponse])
async def list_budget_permissions(
    budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: uuid.UUID | None = None,
):
    """List permissions for a group budget. Requires admin."""
    budget = await _get_group_budget_or_404(db, budget_id)
    await _check_budget_admin_or_403(db, budget.group_id, user.id)

    query = select(BudgetPermission).where(BudgetPermission.budget_id == budget_id)
    if user_id:
        query = query.where(BudgetPermission.user_id == user_id)

    result = await db.execute(query.order_by(BudgetPermission.created_at))
    return result.scalars().all()
