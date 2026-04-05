import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountPermission
from app.models.base import PermissionLevel
from app.models.household import HouseholdMember

# Ordered mapping for level comparison (higher = more access)
_LEVEL_RANK = {PermissionLevel.READ: 0, PermissionLevel.WRITE: 1, PermissionLevel.ADMIN: 2}


async def check_account_access(
    db: AsyncSession, account_id: uuid.UUID, user_id: uuid.UUID, required_level: PermissionLevel,
) -> Account:
    """Verify the user can access an account at the required permission level.

    Resolution order:
    1. Personal owner → full access
    2. Household admin → implicit full access
    3. Explicit permission row → check level is sufficient

    Args:
        db: Async database session.
        account_id: UUID of the account.
        user_id: UUID of the requesting user.
        required_level: Minimum permission level needed.

    Returns:
        The Account row.

    Raises:
        HTTPException 404: Account not found or user lacks access.
    """
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    # Personal account — owner has full access
    if account.owner_id == user_id:
        return account

    # Household account — check membership
    if account.household_id:
        member_result = await db.execute(
            select(HouseholdMember).where(
                HouseholdMember.household_id == account.household_id,
                HouseholdMember.user_id == user_id,
            ),
        )
        member = member_result.scalar_one_or_none()
        if not member:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

        # Admins have implicit full access
        if member.is_admin:
            return account

        # Check explicit permission row
        perm_result = await db.execute(
            select(AccountPermission).where(
                AccountPermission.account_id == account_id,
                AccountPermission.user_id == user_id,
            ),
        )
        perm = perm_result.scalar_one_or_none()
        if perm and _LEVEL_RANK[perm.level] >= _LEVEL_RANK[required_level]:
            return account

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
