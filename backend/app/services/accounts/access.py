"""Account access service

Dashboard routes, insight services, and runway routes share the readable-account helper so
readable-account scoping stays consistent across aggregate views. Flows built for individually
owned accounts share the own-account helper, so grouped resources are left out in one place
"""

import uuid
from collections.abc import Sequence

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountPermission
from app.models.base import PermissionLevel
from app.models.group import GroupMember
from app.models.user import User
from app.permissions import check_account_access


def own_personal_account_condition(user_id: uuid.UUID) -> ColumnElement[bool]:
    """Return the condition an account meets when it is the user's own personal account

    Grouped resources are left out of new flows until they are built, and this is where an account
    flow names that exclusion, so grouped support would start here. A group account, even for its
    admin, and one shared through a permission grant fail it
    """
    return (Account.owner_id == user_id) & Account.group_id.is_(None)


def own_or_administered_account_condition(user_id: uuid.UUID) -> ColumnElement[bool]:
    """Return the condition an account meets when it is the user's own personal account or a group account they administer

    Only a group's admins create its accounts, so a flow that sets a new account up takes theirs as
    well. A permission grant, even an admin one, doesn't make an account the user's own
    """
    administered_groups = select(GroupMember.group_id).where(GroupMember.user_id == user_id, GroupMember.is_admin.is_(True))
    return own_personal_account_condition(user_id) | Account.group_id.in_(administered_groups)


async def get_account_meeting(
    db: AsyncSession,
    account_id: uuid.UUID,
    user_id: uuid.UUID,
    condition: ColumnElement[bool],
    *,
    refused_detail: str,
) -> Account:
    """Return the account when it meets the condition a flow sets on whose accounts it takes

    An account the user can see that fails the condition is refused saying why. One they can't see
    is not found, as for any other account request

    Args:
        db: Active database session
        account_id: Account identifier from the request
        user_id: User acting on the account
        condition: What makes an account one the flow takes for this user
        refused_detail: Why the flow refuses a visible account that fails the condition

    Returns:
        The account

    Raises:
        HTTPException: The account isn't visible to the user, or is visible but fails the condition
    """
    account = await db.scalar(select(Account).where(Account.id == account_id, condition))
    if account is not None:
        return account

    # Not found for an account the user can't see, so only a visible one is refused as not their own
    await check_account_access(db, account_id, user_id, PermissionLevel.READ)
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=refused_detail)


async def get_own_personal_account(
    db: AsyncSession,
    account_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    not_own_detail: str,
) -> Account:
    """Return one of the user's own personal accounts, for a flow built for individually owned ones

    An account the user can see but doesn't own alone, such as a group account, even for its
    admin, or one shared through a permission grant, is refused saying why. One they can't see is
    not found, as for any other account request

    Args:
        db: Active database session
        account_id: Account identifier from the request
        user_id: User acting on the account
        not_own_detail: Why the flow refuses a visible account the user doesn't own alone

    Returns:
        The account

    Raises:
        HTTPException: The account isn't visible to the user, or is visible but isn't their own
            personal account
    """
    return await get_account_meeting(db, account_id, user_id, own_personal_account_condition(user_id), refused_detail=not_own_detail)


async def check_own_personal_accounts(
    db: AsyncSession,
    account_ids: Sequence[uuid.UUID],
    user_id: uuid.UUID,
    *,
    not_own_detail: str,
) -> None:
    """Refuse the first account named that isn't one of the user's own personal accounts

    One query finds which of them are, so naming more accounts costs no more queries, and only an
    account it leaves out is looked up again, to say whether the user can see it

    Args:
        db: Active database session
        account_ids: Account identifiers from the request
        user_id: User acting on the accounts
        not_own_detail: Why the flow refuses a visible account the user doesn't own alone

    Raises:
        HTTPException: An account isn't visible to the user, or is visible but isn't their own
            personal account
    """
    own = set(await db.scalars(select(Account.id).where(Account.id.in_(account_ids), own_personal_account_condition(user_id))))
    for account_id in account_ids:
        if account_id not in own:
            await get_own_personal_account(db, account_id, user_id, not_own_detail=not_own_detail)


async def own_personal_accounts_scope(
    db: AsyncSession,
    user_id: uuid.UUID,
    account_ids: Sequence[uuid.UUID] | None,
    account_column: ColumnElement[uuid.UUID],
    *,
    not_own_detail: str,
) -> list[ColumnElement[bool]]:
    """Return the conditions limiting a read joined to its accounts to the user's own personal accounts, or to those named

    Args:
        db: Active database session
        user_id: User reading
        account_ids: The accounts named in the request, or None for all of the user's own
        account_column: The column holding the account each row belongs to
        not_own_detail: Why the read refuses a named account that is visible but not the user's alone

    Raises:
        HTTPException: A named account isn't visible to the user, or is visible but isn't their own
            personal account
    """
    scope = [own_personal_account_condition(user_id)]
    if account_ids is not None:
        await check_own_personal_accounts(db, account_ids, user_id, not_own_detail=not_own_detail)
        scope.append(account_column.in_(account_ids))
    return scope


async def get_accessible_accounts(
    db: AsyncSession,
    user: User,
    *,
    include_archived: bool = True,
) -> list[Account]:
    """Return accounts readable by a user

    The query treats owned accounts, admin-managed group accounts, and directly
    permitted accounts as readable. Archived accounts stay included unless the
    caller opts into active-account filtering

    Args:
        db: Active database session
        user: Authenticated user requesting cross-account data
        include_archived: Whether archived accounts should remain in scope

    Returns:
        Accounts visible to the user for cross-account aggregation
    """
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
    )
    if not include_archived:
        query = query.where(Account.is_archived.is_(False))

    # Fetch the shared readable-account scope used by dashboard widgets, insights, and runway
    result = await db.execute(query)
    return list(result.scalars().unique().all())
