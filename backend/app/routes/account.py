import uuid
from datetime import UTC, datetime, time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.account import Account, AccountBalanceSnapshot, AccountPermission
from app.models.base import ACCOUNT_KIND_BY_TYPE, AccountKind, AccountType, PermissionLevel, TaxTreatment
from app.models.currency import Currency
from app.models.group import GroupMember
from app.models.institution import Institution
from app.models.user import User
from app.permissions import check_account_access
from app.schemas.account import (
    AccountBalanceSnapshotResponse,
    AccountResponse,
    CreateAccountRequest,
    UpdateAccountRequest,
)
from app.schemas.permission import AccountPermissionResponse, GrantAccountPermissionRequest

router = APIRouter(prefix="/accounts", tags=["accounts"])

# Valid enum values for request validation
_VALID_ACCOUNT_KINDS = {e.value for e in AccountKind}
_VALID_ACCOUNT_TYPES = {e.value for e in AccountType}
_VALID_TAX_TREATMENTS = {e.value for e in TaxTreatment}


@router.get("", response_model=list[AccountResponse])
async def list_accounts(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return all accounts the user can access: personal, group admin, or explicit permission."""
    # Personal accounts OR group accounts where user is admin OR has explicit permission
    query = (
        select(Account)
        .outerjoin(GroupMember, Account.group_id == GroupMember.group_id)
        .outerjoin(
            AccountPermission,
            (AccountPermission.account_id == Account.id) & (AccountPermission.user_id == user.id),
        )
        .where(
            (Account.owner_id == user.id)
            | ((GroupMember.user_id == user.id) & (GroupMember.is_admin.is_(True)))
            | (AccountPermission.user_id == user.id),
        )
        .order_by(Account.created_at)
    )
    result = await db.execute(query)
    return result.scalars().unique().all()


@router.get("/{account_id}", response_model=AccountResponse)
async def get_account(
    account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single account by ID. Requires read access."""
    return await check_account_access(db, account_id, user.id, PermissionLevel.READ)


@router.get("/{account_id}/snapshots", response_model=list[AccountBalanceSnapshotResponse])
async def list_account_balance_snapshots(
    account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[datetime | None, Query()] = None,
    to_date: Annotated[datetime | None, Query()] = None,
):
    """Return the account's daily balance snapshots, ordered ascending by ts.

    Snapshots back the historical balance chart on the account detail page and
    feed the group net-worth aggregation. Requires read access on the
    account.
    """
    await check_account_access(db, account_id, user.id, PermissionLevel.READ)

    if from_date is not None and to_date is not None and from_date > to_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Start date must be before end date",
        )

    query = select(AccountBalanceSnapshot).where(AccountBalanceSnapshot.account_id == account_id)
    if from_date is not None:
        query = query.where(AccountBalanceSnapshot.ts >= from_date)
    if to_date is not None:
        query = query.where(AccountBalanceSnapshot.ts <= to_date)
    query = query.order_by(AccountBalanceSnapshot.ts)

    result = await db.execute(query)
    return result.scalars().all()


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
async def create_account(
    data: CreateAccountRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a new account. Personal by default, or group-scoped if group_id is provided.

    Args:
        data: Account details.
        user: The authenticated user.
        db: Async database session.

    Returns:
        The created account.

    Raises:
        HTTPException 422: Invalid account_type, tax_treatment, currency, or institution.
        HTTPException 403: User is not an admin of the group.
        HTTPException 404: User is not a member of the group.
    """
    if data.account_kind not in _VALID_ACCOUNT_KINDS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid account kind")
    if data.account_type not in _VALID_ACCOUNT_TYPES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid account type")
    if ACCOUNT_KIND_BY_TYPE[AccountType(data.account_type)] != AccountKind(data.account_kind):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Account kind does not match account type",
        )
    if data.tax_treatment not in _VALID_TAX_TREATMENTS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid tax treatment")

    # Validate currency exists
    result = await db.execute(select(Currency).where(Currency.id == data.currency))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid currency code")

    # Validate institution exists if provided
    if data.institution_id:
        result = await db.execute(select(Institution).where(Institution.id == data.institution_id))
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Institution not found")

    # Determine ownership
    owner_id = user.id
    group_id = data.group_id
    if group_id:
        membership_result = await db.execute(
            select(GroupMember).where(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user.id,
            ),
        )
        membership = membership_result.scalar_one_or_none()
        if not membership:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
        if not membership.is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can create group accounts")
        owner_id = None

    account = Account(
        owner_id=owner_id,
        group_id=group_id,
        account_kind=data.account_kind,
        account_type=data.account_type,
        tax_treatment=data.tax_treatment,
        name=data.name,
        institution_id=data.institution_id,
        currency=data.currency,
        lifetime_contribution_limit=data.lifetime_contribution_limit,
        is_hidden=data.is_hidden,
    )
    db.add(account)
    await db.flush()

    # Anchor balance history with a zero-balance snapshot on the creation day.
    # This gives the frontend a stable starting point for charts without needing
    # to join against account.created_at. Retroactively imported transactions
    # may later replace this snapshot via recompute_snapshots_from.
    created_day_utc = datetime.combine(account.created_at.astimezone(UTC).date(), time.min, tzinfo=UTC)
    db.add(AccountBalanceSnapshot(
        account_id=account.id,
        ts=created_day_utc,
        balance=0,
    ))

    await db.commit()
    await db.refresh(account)
    return account


@router.patch("/{account_id}", response_model=AccountResponse)
async def update_account(
    account_id: uuid.UUID,
    data: UpdateAccountRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update an account. Requires admin access."""
    account = await check_account_access(db, account_id, user.id, PermissionLevel.ADMIN)

    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return account

    # Validate tax_treatment if being changed
    if "tax_treatment" in updates and updates["tax_treatment"] not in _VALID_TAX_TREATMENTS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid tax treatment")

    # Validate institution if being changed
    if "institution_id" in updates and updates["institution_id"] is not None:
        result = await db.execute(select(Institution).where(Institution.id == updates["institution_id"]))
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Institution not found")

    for field, value in updates.items():
        setattr(account, field, value)

    await db.commit()
    await db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete an account. Requires admin access."""
    account = await check_account_access(db, account_id, user.id, PermissionLevel.ADMIN)
    await db.delete(account)
    await db.commit()


# --- Account permissions ---


async def _get_group_account_or_404(
    db: AsyncSession, account_id: uuid.UUID,
) -> Account:
    """Fetch an account that belongs to a group, or raise 404.

    Personal accounts also return 404 (not 422) so that unauthorized
    callers cannot distinguish between nonexistent and personal accounts.

    Args:
        db: Async database session.
        account_id: UUID of the account.

    Returns:
        The Account row with group_id set.

    Raises:
        HTTPException 404: Account not found or is a personal account.
    """
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account or not account.group_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return account


async def _check_account_admin_or_403(
    db: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID,
) -> GroupMember:
    """Verify the user is an admin of the account's group.

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    if not membership.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return membership


@router.post("/{account_id}/permissions", response_model=AccountPermissionResponse, status_code=status.HTTP_201_CREATED)
async def grant_account_permission(
    account_id: uuid.UUID,
    data: GrantAccountPermissionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Grant or update a member's access level on a group account. Requires admin."""
    account = await _get_group_account_or_404(db, account_id)
    await _check_account_admin_or_403(db, account.group_id, user.id)

    # Target must be a non-admin group member (admins have implicit full access)
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

    # Update level if permission already exists, otherwise create a new one
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
    """Revoke a member's access to a group account. Requires admin."""
    account = await _get_group_account_or_404(db, account_id)
    await _check_account_admin_or_403(db, account.group_id, user.id)

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
    await db.commit()


@router.get("/{account_id}/permissions", response_model=list[AccountPermissionResponse])
async def list_account_permissions(
    account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    user_id: uuid.UUID | None = None,
):
    """List permissions for a group account. Requires admin."""
    account = await _get_group_account_or_404(db, account_id)
    await _check_account_admin_or_403(db, account.group_id, user.id)

    query = select(AccountPermission).where(AccountPermission.account_id == account_id)
    if user_id:
        query = query.where(AccountPermission.user_id == user_id)

    result = await db.execute(query.order_by(AccountPermission.created_at))
    return result.scalars().all()
