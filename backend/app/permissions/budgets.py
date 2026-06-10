"""Budget permission checks"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.models.budget import BaseBudget, Budget, BudgetPermission
from app.models.group import GroupMember
from app.permissions.levels import is_permission_level_at_least


async def check_base_budget_access(
    db: AsyncSession,
    base_budget_id: uuid.UUID,
    user_id: uuid.UUID,
    required_level: PermissionLevel,
) -> BaseBudget:
    """Return a base budget when the user has the required access level

    The check grants full access to personal owners and group admins before
    checking explicit budget permissions

    Args:
        db: Active database session
        base_budget_id: Base budget identifier to check
        user_id: User requesting access
        required_level: Minimum permission level required by the operation

    Returns:
        Base budget row

    Raises:
        HTTPException: Base budget is missing, inaccessible, or below the required permission level
    """
    base_budget = await _get_base_budget_or_404(db, base_budget_id)
    if base_budget.owner_id == user_id:
        return base_budget

    if base_budget.group_id:
        has_group_access = await _is_group_base_budget_access_allowed(
            db,
            base_budget_id,
            base_budget.group_id,
            user_id,
            required_level,
        )
        if has_group_access:
            return base_budget

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found")


async def check_budget_access(
    db: AsyncSession,
    budget_id: uuid.UUID,
    user_id: uuid.UUID,
    required_level: PermissionLevel,
) -> tuple[Budget, BaseBudget]:
    """Return a budget instance and base budget when the user has access

    Budget instances inherit permissions from their base budget. Returning both
    rows gives callers the period row and the long-lived budget metadata

    Args:
        db: Active database session
        budget_id: Budget instance identifier to check
        user_id: User requesting access
        required_level: Minimum permission level required on the base budget

    Returns:
        Budget instance and owning base budget

    Raises:
        HTTPException: Budget is missing, inaccessible, or below the required permission level
    """
    budget = await _get_budget_or_404(db, budget_id)
    base_budget = await check_base_budget_access(db, budget.base_budget_id, user_id, required_level)
    return budget, base_budget


async def _get_base_budget_or_404(db: AsyncSession, base_budget_id: uuid.UUID) -> BaseBudget:
    """Return a base budget or raise not found

    Args:
        db: Active database session
        base_budget_id: Base budget identifier to fetch

    Returns:
        Base budget row

    Raises:
        HTTPException: Base budget does not exist
    """
    base_budget_query = select(BaseBudget).where(BaseBudget.id == base_budget_id)

    # Fetch the base budget before applying personal, group, and explicit permission rules
    result = await db.execute(base_budget_query)
    base_budget = result.scalar_one_or_none()
    if not base_budget:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found")
    return base_budget


async def _get_budget_or_404(db: AsyncSession, budget_id: uuid.UUID) -> Budget:
    """Return a budget instance or raise not found

    Args:
        db: Active database session
        budget_id: Budget instance identifier to fetch

    Returns:
        Budget instance row

    Raises:
        HTTPException: Budget does not exist
    """
    budget_query = select(Budget).where(Budget.id == budget_id)

    # Fetch the budget instance so access can be delegated to its base budget
    result = await db.execute(budget_query)
    budget = result.scalar_one_or_none()
    if not budget:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found")
    return budget


async def _is_group_base_budget_access_allowed(
    db: AsyncSession,
    base_budget_id: uuid.UUID,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
    required_level: PermissionLevel,
) -> bool:
    """Return whether group membership or permission allows base budget access

    Args:
        db: Active database session
        base_budget_id: Base budget identifier to check
        group_id: Group that owns the base budget
        user_id: User requesting access
        required_level: Minimum permission level required by the operation

    Returns:
        Whether the user has access through group admin status or an explicit permission

    Raises:
        HTTPException: User is not a group member or has insufficient explicit access
    """
    membership = await _get_group_membership_for_base_budget(db, group_id, user_id)
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found")
    if membership.is_admin:
        return True

    budget_permission = await _get_budget_permission(db, base_budget_id, user_id)
    if not budget_permission:
        return False
    if is_permission_level_at_least(budget_permission.level, required_level):
        return True

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")


async def _get_group_membership_for_base_budget(
    db: AsyncSession,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> GroupMember | None:
    """Return the user's membership in a base-budget-owning group

    Args:
        db: Active database session
        group_id: Group that owns the base budget
        user_id: User requesting access

    Returns:
        Group membership row when the user belongs to the group
    """
    membership_query = select(GroupMember).where(
        GroupMember.group_id == group_id,
        GroupMember.user_id == user_id,
    )

    # Fetch the group membership so non-members see the base budget as not found
    result = await db.execute(membership_query)
    membership = result.scalar_one_or_none()
    return membership


async def _get_budget_permission(
    db: AsyncSession,
    base_budget_id: uuid.UUID,
    user_id: uuid.UUID,
) -> BudgetPermission | None:
    """Return an explicit base budget permission for a user

    Args:
        db: Active database session
        base_budget_id: Base budget identifier to check
        user_id: User requesting access

    Returns:
        Explicit budget permission row when one exists
    """
    permission_query = select(BudgetPermission).where(
        BudgetPermission.base_budget_id == base_budget_id,
        BudgetPermission.user_id == user_id,
    )

    # Fetch the explicit base budget permission used for non-admin group members
    result = await db.execute(permission_query)
    budget_permission = result.scalar_one_or_none()
    return budget_permission
