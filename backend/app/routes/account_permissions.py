"""Account permission route handlers"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.account import Account, AccountPermission
from app.models.group import GroupMember
from app.models.user import User
from app.schemas.permission import AccountPermissionResponse, GrantAccountPermissionRequest
from app.services.cache_state import mark_group_cache_changed

router = APIRouter()


async def _get_group_account_or_404(db: AsyncSession, account_id: uuid.UUID) -> Account:
    """Return a group-scoped account or raise 404

    Args:
        db: Active database session
        account_id: Account identifier from the route path

    Returns:
        Group-scoped account row

    Raises:
        HTTPException: Account is missing or personal
    """
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account or not account.group_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return account


async def _is_group_account_admin(db: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """Return whether a user is an admin for the account group

    Args:
        db: Active database session
        group_id: Group identifier for the account
        user_id: Authenticated user identifier

    Returns:
        True when the user is a group admin

    Raises:
        HTTPException: User is not a group member
    """
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id,
        ),
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return membership.is_admin


@router.post("/{account_id}/permissions", response_model=AccountPermissionResponse, status_code=status.HTTP_201_CREATED)
async def grant_account_permission(
    account_id: uuid.UUID,
    data: GrantAccountPermissionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Grant or update a member's access level on a group account

    Args:
        account_id: Account identifier from the route path
        data: Requested member and permission level
        user: Authenticated user making the change
        db: Active database session

    Returns:
        Created or updated account permission row

    Raises:
        HTTPException: Account is not group-scoped, actor is not admin, or target member is invalid
    """
    account = await _get_group_account_or_404(db, account_id)
    if not await _is_group_account_admin(db, account.group_id, user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    target_result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == account.group_id,
            GroupMember.user_id == data.user_id,
        ),
    )
    target_member = target_result.scalar_one_or_none()
    if not target_member:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="User is not a member of this group")
    if target_member.is_admin:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Admins have implicit full access")

    existing_result = await db.execute(
        select(AccountPermission).where(
            AccountPermission.group_id == account.group_id,
            AccountPermission.user_id == data.user_id,
            AccountPermission.account_id == account_id,
        ),
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        existing.level = data.level
        await mark_group_cache_changed(db, account.group_id)
        await db.commit()
        await db.refresh(existing)
        return existing

    account_permission = AccountPermission(
        group_id=account.group_id,
        user_id=data.user_id,
        account_id=account_id,
        level=data.level,
    )
    db.add(account_permission)
    await mark_group_cache_changed(db, account.group_id)
    await db.commit()
    await db.refresh(account_permission)
    return account_permission


@router.delete("/{account_id}/permissions/{permission_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_account_permission(
    account_id: uuid.UUID,
    permission_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Revoke a member's access to a group account

    Args:
        account_id: Account identifier from the route path
        permission_id: Permission identifier from the route path
        user: Authenticated user making the change
        db: Active database session

    Raises:
        HTTPException: Account is not group-scoped, actor is not admin, or permission is missing
    """
    account = await _get_group_account_or_404(db, account_id)
    if not await _is_group_account_admin(db, account.group_id, user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    result = await db.execute(
        select(AccountPermission).where(
            AccountPermission.id == permission_id,
            AccountPermission.account_id == account_id,
        ),
    )
    account_permission = result.scalar_one_or_none()
    if not account_permission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Permission not found")

    await db.delete(account_permission)
    await mark_group_cache_changed(db, account.group_id)
    await db.commit()


@router.get("/{account_id}/permissions", response_model=list[AccountPermissionResponse])
async def list_account_permissions(
    account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: uuid.UUID | None = None,
):
    """List permissions for a group account

    Args:
        account_id: Account identifier from the route path
        user: Authenticated user making the request
        db: Active database session
        user_id: Optional user filter for permission rows

    Returns:
        Account permission rows ordered by creation time

    Raises:
        HTTPException: Account is not group-scoped or actor is not admin
    """
    account = await _get_group_account_or_404(db, account_id)
    if not await _is_group_account_admin(db, account.group_id, user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    query = select(AccountPermission).where(AccountPermission.account_id == account_id)
    if user_id:
        query = query.where(AccountPermission.user_id == user_id)

    result = await db.execute(query.order_by(AccountPermission.created_at))
    return result.scalars().all()
