import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountPermission
from app.models.base import PermissionLevel
from app.models.budget import Budget, BudgetPermission
from app.models.household import HouseholdMember
from app.models.transaction import Transaction

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
        if perm:
            if _LEVEL_RANK[perm.level] >= _LEVEL_RANK[required_level]:
                return account
            # User has some access but not enough — 403 since they know it exists
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")


async def check_transaction_access(
    db: AsyncSession, transaction_id: uuid.UUID, user_id: uuid.UUID, required_level: PermissionLevel,
) -> Transaction:
    """Verify the user can access a transaction via its parent account.

    Args:
        db: Async database session.
        transaction_id: UUID of the transaction.
        user_id: UUID of the requesting user.
        required_level: Minimum permission level needed on the parent account.

    Returns:
        The Transaction row.

    Raises:
        HTTPException 404: Transaction not found or user lacks access to its account.
    """
    result = await db.execute(select(Transaction).where(Transaction.id == transaction_id))
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found")

    await check_account_access(db, txn.account_id, user_id, required_level)
    return txn


async def check_budget_access(
    db: AsyncSession, budget_id: uuid.UUID, user_id: uuid.UUID, required_level: PermissionLevel,
) -> Budget:
    """Verify the user can access a budget at the required permission level.

    Resolution order:
    1. Personal owner → full access
    2. Household admin → implicit full access
    3. Explicit BudgetPermission row → check level is sufficient

    Args:
        db: Async database session.
        budget_id: UUID of the budget.
        user_id: UUID of the requesting user.
        required_level: Minimum permission level needed.

    Returns:
        The Budget row.

    Raises:
        HTTPException 404: Budget not found or user lacks access.
        HTTPException 403: User has some access but insufficient level.
    """
    result = await db.execute(select(Budget).where(Budget.id == budget_id))
    budget = result.scalar_one_or_none()
    if not budget:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found")

    # Personal budget — owner has full access
    if budget.owner_id == user_id:
        return budget

    # Household budget — check membership
    if budget.household_id:
        member_result = await db.execute(
            select(HouseholdMember).where(
                HouseholdMember.household_id == budget.household_id,
                HouseholdMember.user_id == user_id,
            ),
        )
        budget_member = member_result.scalar_one_or_none()
        if not budget_member:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found")

        # Admins have implicit full access
        if budget_member.is_admin:
            return budget

        # Check explicit permission row
        perm_result = await db.execute(
            select(BudgetPermission).where(
                BudgetPermission.budget_id == budget_id,
                BudgetPermission.user_id == user_id,
            ),
        )
        perm = perm_result.scalar_one_or_none()
        if perm:
            if _LEVEL_RANK[perm.level] >= _LEVEL_RANK[required_level]:
                return budget
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found")
