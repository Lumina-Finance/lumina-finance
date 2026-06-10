"""Base budget permission access helpers"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import BaseBudget
from app.models.group import GroupMember


async def get_group_base_budget_or_404(
    db: AsyncSession,
    base_budget_id: uuid.UUID,
) -> BaseBudget:
    """Return a group base budget or raise a not-found response

    Personal base budgets also return not found so unauthorized callers cannot
    distinguish between missing and personal base budgets

    Args:
        db: Active database session
        base_budget_id: Base budget identifier from the route path

    Returns:
        Group-scoped base budget row

    Raises:
        HTTPException: Base budget is missing or personal
    """
    base_budget_query = select(BaseBudget).where(BaseBudget.id == base_budget_id)

    # Fetch the base budget row and reject personal budgets because permissions apply only to group budgets
    result = await db.execute(base_budget_query)
    base_budget = result.scalar_one_or_none()
    if not base_budget or not base_budget.group_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Base budget not found")
    return base_budget


async def get_base_budget_admin_membership_or_403(
    db: AsyncSession,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> GroupMember:
    """Return group membership when the user can manage base budget permissions

    Args:
        db: Active database session
        group_id: Group identifier for the base budget
        user_id: Authenticated user identifier

    Returns:
        Group membership for an admin user

    Raises:
        HTTPException: User is not a member or is not an admin
    """
    membership_query = select(GroupMember).where(
        GroupMember.group_id == group_id,
        GroupMember.user_id == user_id,
    )

    # Fetch the actor's group membership to enforce admin-only permission changes
    result = await db.execute(membership_query)
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Base budget not found")
    if not membership.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return membership
