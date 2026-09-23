"""Account permission checks"""
import uuid
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.exc import MultipleResultsFound
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.models.account import Account, AccountPermission
from app.models.base import PermissionLevel
from app.models.group import GroupMember
from app.permissions.levels import is_permission_level_at_least


@dataclass
class AccountAccessLookup:
    """Request-local account facts bound to one authenticated user's identity

    Missing entries are authoritative for the loaded request, not invitations to query again
    Memberships and grants retain all matching rows so evaluation preserves cardinality errors
    """

    user_id: uuid.UUID
    accounts: dict[uuid.UUID, Account]
    memberships: dict[uuid.UUID, list[GroupMember]]
    permissions: dict[uuid.UUID, list[AccountPermission]]


async def load_account_access_lookup(
    db: AsyncSession, account_ids: set[uuid.UUID], user_id: uuid.UUID,
) -> AccountAccessLookup:
    """Load account and caller access facts in sets without deciding authorization

    Args:
        db: Active request database session under its normal row-level security
        account_ids: Unique account references to evaluate in this request
        user_id: Authenticated caller whose memberships and grants are loaded

    Returns:
        Request-local facts for the existing permission evaluator
    """
    lookup = AccountAccessLookup(user_id, {}, {}, {})
    if not account_ids:
        return lookup

    # Include institutions in the account read so response data adds no per-account query
    accounts = (await db.execute(
        select(Account).where(Account.id.in_(account_ids)).options(joinedload(Account.institution)),
    )).scalars().all()
    lookup.accounts = {account.id: account for account in accounts}
    group_ids = {account.group_id for account in accounts if account.group_id is not None}
    if not group_ids:
        return lookup

    # Load only the caller's memberships for groups represented by the requested accounts
    memberships = (await db.execute(select(GroupMember).where(
        GroupMember.group_id.in_(group_ids), GroupMember.user_id == user_id,
    ))).scalars().all()
    for membership in memberships:
        lookup.memberships.setdefault(membership.group_id, []).append(membership)

    # Retain every matching grant exactly as the single-account evaluator would read it
    permissions = (await db.execute(select(AccountPermission).where(
        AccountPermission.account_id.in_(account_ids), AccountPermission.user_id == user_id,
    ))).scalars().all()
    for permission in permissions:
        lookup.permissions.setdefault(permission.account_id, []).append(permission)
    return lookup


def _get_single_access_record[AccessRecord: (GroupMember, AccountPermission)](
    records: list[AccessRecord],
) -> AccessRecord | None:
    """Preserve scalar_one_or_none semantics when reading preloaded access facts"""
    if len(records) > 1:
        raise MultipleResultsFound("Multiple rows were found when one or none was required")
    return records[0] if records else None


async def attach_account_write_capabilities(
    db: AsyncSession,
    accounts: list[Account],
    user_id: uuid.UUID,
) -> None:
    """Attach the caller's effective write capability to account response rows

    Args:
        db: Active database session
        accounts: Account rows being prepared for a response
        user_id: User receiving the response
    """
    if not accounts:
        return

    account_ids = [account.id for account in accounts]
    capability_query = (
        select(Account.id, GroupMember.is_admin, AccountPermission.level)
        .outerjoin(
            GroupMember,
            and_(
                GroupMember.group_id == Account.group_id,
                GroupMember.user_id == user_id,
            ),
        )
        .outerjoin(
            AccountPermission,
            and_(
                AccountPermission.account_id == Account.id,
                AccountPermission.group_id == Account.group_id,
                AccountPermission.user_id == user_id,
            ),
        )
        .where(Account.id.in_(account_ids))
    )

    # Read every capability in one caller-bound query so account lists do not add one query per row
    result = await db.execute(capability_query)
    capability_rows = {
        account_id: bool(is_group_admin)
        or (
            permission_level is not None
            and is_permission_level_at_least(permission_level, PermissionLevel.WRITE)
        )
        for account_id, is_group_admin, permission_level in result.all()
    }
    for account in accounts:
        account.can_write = account.owner_id == user_id or capability_rows.get(account.id, False)


async def check_account_access(
    db: AsyncSession,
    account_id: uuid.UUID,
    user_id: uuid.UUID,
    required_level: PermissionLevel,
    *,
    access_lookup: AccountAccessLookup | None = None,
) -> Account:
    """Return an account when the user has the required access level

    The check grants full access to personal owners and group admins before
    checking explicit account permissions

    Args:
        db: Active database session
        account_id: Account identifier to check
        user_id: User requesting access
        required_level: Minimum permission level required by the operation
        access_lookup: Optional request-local facts bound to this caller, with no missing-entry fallback

    Returns:
        Account row with institution data loaded

    Raises:
        HTTPException: Account is missing, inaccessible, or below the required permission level
        ValueError: Preloaded facts belong to another user
        MultipleResultsFound: More than one matching membership or grant exists
    """
    if access_lookup is not None and access_lookup.user_id != user_id:
        raise ValueError("Account access lookup belongs to another user")
    if access_lookup is None:
        account = await _get_account_or_404(db, account_id)
    else:
        account = access_lookup.accounts.get(account_id)
        if account is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    is_authorized = account.owner_id == user_id

    if not is_authorized and account.group_id:
        is_authorized = await _is_group_account_access_allowed(
            db,
            account_id,
            account.group_id,
            user_id,
            required_level,
            access_lookup=access_lookup,
        )

    if not is_authorized:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    return account


async def _get_account_or_404(db: AsyncSession, account_id: uuid.UUID) -> Account:
    """Return an account with response data loaded or raise not found

    Args:
        db: Active database session
        account_id: Account identifier to fetch

    Returns:
        Account row with institution data loaded

    Raises:
        HTTPException: Account does not exist
    """
    account_query = select(Account).where(Account.id == account_id).options(selectinload(Account.institution))

    # Fetch the account with institution data so response builders can serialize it in async contexts
    result = await db.execute(account_query)
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return account


async def _is_group_account_access_allowed(
    db: AsyncSession,
    account_id: uuid.UUID,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
    required_level: PermissionLevel,
    *,
    access_lookup: AccountAccessLookup | None = None,
) -> bool:
    """Return whether group membership or permission allows account access

    Args:
        db: Active database session
        account_id: Account identifier to check
        group_id: Group that owns the account
        user_id: User requesting access
        required_level: Minimum permission level required by the operation
        access_lookup: Optional caller-bound request facts already checked by the account evaluator

    Returns:
        Whether the user has access through group admin status or an explicit permission

    Raises:
        HTTPException: User is not a group member or has insufficient explicit access
        MultipleResultsFound: More than one matching membership or grant exists
    """
    membership = (
        await _get_group_membership_for_account(db, group_id, user_id)
        if access_lookup is None
        else _get_single_access_record(access_lookup.memberships.get(group_id, []))
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    if membership.is_admin:
        return True

    account_permission = (
        await _get_account_permission(db, account_id, user_id)
        if access_lookup is None
        else _get_single_access_record(access_lookup.permissions.get(account_id, []))
    )
    if not account_permission:
        return False
    if is_permission_level_at_least(account_permission.level, required_level):
        return True

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")


async def _get_group_membership_for_account(
    db: AsyncSession,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> GroupMember | None:
    """Return the user's membership in an account-owning group

    Args:
        db: Active database session
        group_id: Group that owns the account
        user_id: User requesting access

    Returns:
        Group membership row when the user belongs to the group
    """
    membership_query = select(GroupMember).where(
        GroupMember.group_id == group_id,
        GroupMember.user_id == user_id,
    )

    # Fetch the group membership so non-members see the account as not found
    result = await db.execute(membership_query)
    membership = result.scalar_one_or_none()
    return membership


async def _get_account_permission(
    db: AsyncSession,
    account_id: uuid.UUID,
    user_id: uuid.UUID,
) -> AccountPermission | None:
    """Return an explicit account permission for a user

    Args:
        db: Active database session
        account_id: Account identifier to check
        user_id: User requesting access

    Returns:
        Explicit account permission row when one exists
    """
    permission_query = select(AccountPermission).where(
        AccountPermission.account_id == account_id,
        AccountPermission.user_id == user_id,
    )

    # Fetch the explicit account permission used for non-admin group members
    result = await db.execute(permission_query)
    account_permission = result.scalar_one_or_none()
    return account_permission
