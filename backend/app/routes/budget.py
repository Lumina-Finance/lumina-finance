import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.account import Account
from app.models.base import PermissionLevel
from app.models.budget import BaseBudget, Budget, BudgetPermission, BudgetTrackedCategory
from app.models.group import GroupMember
from app.models.transaction import Transaction
from app.models.user import User
from app.permissions import check_budget_access
from app.schemas.budget import (
    BaseBudgetResponse,
    BudgetCategoryUtilization,
    BudgetResponse,
    BudgetUtilizationResponse,
    UpdateBudgetRequest,
)
from app.schemas.permission import BudgetPermissionResponse, GrantBudgetPermissionRequest

router = APIRouter(prefix="/budgets", tags=["budgets"])


async def _build_budget_response(
    db: AsyncSession, budget: Budget, base_budget: BaseBudget,
) -> BudgetResponse:
    """Build a BudgetResponse with the parent base and its currently-active tracked categories embedded."""
    cat_result = await db.execute(
        select(BudgetTrackedCategory.category_id).where(
            BudgetTrackedCategory.base_budget_id == base_budget.id,
            BudgetTrackedCategory.removed_at.is_(None),
        ),
    )
    active_category_ids = list(cat_result.scalars().all())
    base_response = BaseBudgetResponse.model_validate(base_budget)
    base_response.category_ids = active_category_ids
    return BudgetResponse(
        id=budget.id,
        base_budget_id=budget.base_budget_id,
        period_start=budget.period_start,
        period_end=budget.period_end,
        overall_limit=budget.overall_limit,
        created_at=budget.created_at,
        base_budget=base_response,
    )


@router.get("/{budget_id}", response_model=BudgetResponse)
async def get_budget(
    budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single budget instance. Requires READ access on the base budget."""
    budget, base_budget = await check_budget_access(db, budget_id, user.id, PermissionLevel.READ)
    return await _build_budget_response(db, budget, base_budget)


@router.get("/{budget_id}/utilization", response_model=BudgetUtilizationResponse)
async def get_budget_utilization(
    budget_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return per-category spending totals for the budget instance's period.

    Requires READ on the base budget; access to the underlying accounts is not required.
    The tracked-category set is reconstructed as of period_end using added_at/removed_at,
    so past periods stay frozen when the base is edited after they ended. Mid-period
    additions count for the full period retroactively; mid-period removals exclude the
    category from the whole period.
    """
    budget, base_budget = await check_budget_access(db, budget_id, user.id, PermissionLevel.READ)

    # Categories active as of period_end — the historical-accuracy predicate. Past
    # periods stay pinned because period_end is fixed; current periods reduce to
    # "currently active" because period_end is in the future.
    added_at_day = cast(func.timezone("UTC", BudgetTrackedCategory.added_at), Date)
    removed_at_day = cast(func.timezone("UTC", BudgetTrackedCategory.removed_at), Date)
    tracked_result = await db.execute(
        select(BudgetTrackedCategory.category_id)
        .where(
            BudgetTrackedCategory.base_budget_id == base_budget.id,
            added_at_day <= budget.period_end,
            (BudgetTrackedCategory.removed_at.is_(None)) | (removed_at_day > budget.period_end),
        )
        .distinct(),
    )
    tracked_category_ids = list(tracked_result.scalars().all())

    # Sum amounts per category for transactions whose UTC date falls in the period.
    # Transaction.amount is stored in the parent account's currency, so we restrict the
    # join to accounts whose currency matches the base's currency — this keeps multi-
    # currency users from mixing e.g. USD and CAD totals when the same category crosses
    # accounts. Scope is also constrained to accounts the base budget actually owns
    # so cross-scope spending never bleeds in.
    spend_map: dict[uuid.UUID, int] = {}
    if tracked_category_ids:
        ts_day = cast(func.timezone("UTC", Transaction.ts), Date)
        scope_filter = (
            Account.group_id == base_budget.group_id
            if base_budget.group_id
            else Account.owner_id == base_budget.owner_id
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
                Account.currency == base_budget.currency,
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
    """Delete a budget instance. Requires ADMIN access on the base budget."""
    budget, _ = await check_budget_access(db, budget_id, user.id, PermissionLevel.ADMIN)
    await db.delete(budget)
    await db.commit()


@router.patch("/{budget_id}", response_model=BudgetResponse)
async def update_budget(
    budget_id: uuid.UUID,
    data: UpdateBudgetRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a budget instance's period or overall_limit. Requires ADMIN access on the base budget."""
    budget, base_budget = await check_budget_access(db, budget_id, user.id, PermissionLevel.ADMIN)

    changed_fields = data.model_dump(exclude_unset=True)
    if not changed_fields:
        return await _build_budget_response(db, budget, base_budget)

    # Validate period if either date is being changed
    if "period_start" in changed_fields or "period_end" in changed_fields:
        new_start = changed_fields.get("period_start", budget.period_start)
        new_end = changed_fields.get("period_end", budget.period_end)
        if new_start > new_end:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Period start must not be after period end")

    for field, value in changed_fields.items():
        setattr(budget, field, value)

    await db.commit()
    await db.refresh(budget)
    return await _build_budget_response(db, budget, base_budget)


@router.get("", response_model=list[BudgetResponse])
async def list_budgets(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return all budget instances the user owns or has access to via their base budget."""
    query = (
        select(Budget, BaseBudget)
        .join(BaseBudget, Budget.base_budget_id == BaseBudget.id)
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
        .order_by(Budget.period_end.desc(), BaseBudget.name)
    )
    result = await db.execute(query)
    rows = result.unique().all()

    return [await _build_budget_response(db, budget, base) for budget, base in rows]


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
