import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.account import Account, AccountPermission
from app.models.base import PermissionLevel
from app.models.budget import BaseBudget, Budget, BudgetPermission
from app.models.group import GroupMember
from app.models.transaction import Transaction

# Ordered mapping for level comparison (higher = more access)
_LEVEL_RANK = {PermissionLevel.READ: 0, PermissionLevel.WRITE: 1, PermissionLevel.ADMIN: 2}


async def check_account_access(
    db: AsyncSession,
    account_id: uuid.UUID,
    user_id: uuid.UUID,
    required_level: PermissionLevel,
    *,
    require_open: bool = False,
) -> Account:
    """Verify the user can access an account at the required permission level.

    Resolution order:
    1. Personal owner → full access
    2. Group admin → implicit full access
    3. Explicit permission row → check level is sufficient

    Args:
        db: Async database session.
        account_id: UUID of the account.
        user_id: UUID of the requesting user.
        required_level: Minimum permission level needed.
        require_open: If True, raise 422 when the account is closed. Should be set
            on write paths (create/update transactions, move to a new account).

    Returns:
        The Account row.

    Raises:
        HTTPException 404: Account not found or user lacks access.
        HTTPException 403: User has some access but insufficient level.
        HTTPException 422: Account is closed and require_open=True.
    """
    # Eager-load the institution so AccountResponse callers can serialize it without
    # triggering a lazy-load (which raises in async context — Account.institution is lazy="raise").
    result = await db.execute(
        select(Account).where(Account.id == account_id).options(selectinload(Account.institution)),
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    # Personal account — owner has full access
    authorized = account.owner_id == user_id

    # Group account — check membership then admin/permission
    if not authorized and account.group_id:
        member_result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == account.group_id,
                GroupMember.user_id == user_id,
            ),
        )
        member = member_result.scalar_one_or_none()
        if not member:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

        if member.is_admin:
            # Admins have implicit full access
            authorized = True
        else:
            perm_result = await db.execute(
                select(AccountPermission).where(
                    AccountPermission.account_id == account_id,
                    AccountPermission.user_id == user_id,
                ),
            )
            perm = perm_result.scalar_one_or_none()
            if perm:
                if _LEVEL_RANK[perm.level] >= _LEVEL_RANK[required_level]:
                    authorized = True
                else:
                    # User has some access but not enough — 403 since they know it exists
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    if not authorized:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    if require_open and account.closed_at is not None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Account is closed")

    return account


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


async def check_base_budget_access(
    db: AsyncSession, base_budget_id: uuid.UUID, user_id: uuid.UUID, required_level: PermissionLevel,
) -> BaseBudget:
    """Verify the user can access a base budget at the required permission level.

    Resolution order:
    1. Personal owner → full access
    2. Group admin → implicit full access
    3. Explicit BudgetPermission row → check level is sufficient

    Args:
        db: Async database session.
        base_budget_id: UUID of the base budget.
        user_id: UUID of the requesting user.
        required_level: Minimum permission level needed.

    Returns:
        The BaseBudget row.

    Raises:
        HTTPException 404: Base budget not found or user lacks access.
        HTTPException 403: User has some access but insufficient level.
    """
    result = await db.execute(select(BaseBudget).where(BaseBudget.id == base_budget_id))
    base_budget = result.scalar_one_or_none()
    if not base_budget:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found")

    # Personal base budget — owner has full access
    if base_budget.owner_id == user_id:
        return base_budget

    # Group base budget — check membership then admin/permission
    if base_budget.group_id:
        member_result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == base_budget.group_id,
                GroupMember.user_id == user_id,
            ),
        )
        budget_member = member_result.scalar_one_or_none()
        if not budget_member:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found")

        # Admins have implicit full access
        if budget_member.is_admin:
            return base_budget

        # Check explicit permission row
        perm_result = await db.execute(
            select(BudgetPermission).where(
                BudgetPermission.base_budget_id == base_budget_id,
                BudgetPermission.user_id == user_id,
            ),
        )
        perm = perm_result.scalar_one_or_none()
        if perm:
            if _LEVEL_RANK[perm.level] >= _LEVEL_RANK[required_level]:
                return base_budget
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found")


async def check_budget_access(
    db: AsyncSession, budget_id: uuid.UUID, user_id: uuid.UUID, required_level: PermissionLevel,
) -> tuple[Budget, BaseBudget]:
    """Verify the user can access a budget instance at the required permission level.

    Instances inherit scope and permissions from their BaseBudget. This function looks up
    the instance, then hands the access check off to check_base_budget_access. Returns both
    rows so callers have the period data (instance) and the long-lived metadata (currency,
    scope, name) without a second query.

    Args:
        db: Async database session.
        budget_id: UUID of the budget instance.
        user_id: UUID of the requesting user.
        required_level: Minimum permission level needed on the base budget.

    Returns:
        A tuple of (Budget, BaseBudget).

    Raises:
        HTTPException 404: Budget not found or user lacks access.
        HTTPException 403: User has some access but insufficient level.
    """
    result = await db.execute(select(Budget).where(Budget.id == budget_id))
    budget = result.scalar_one_or_none()
    if not budget:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Budget not found")

    base_budget = await check_base_budget_access(db, budget.base_budget_id, user_id, required_level)
    return budget, base_budget
