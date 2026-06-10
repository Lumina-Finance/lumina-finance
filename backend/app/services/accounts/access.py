"""Readable account access service

Dashboard routes, insight services, and runway routes share this helper so
readable-account scoping stays consistent across aggregate views
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountPermission
from app.models.group import GroupMember
from app.models.user import User


async def get_accessible_accounts(
    db: AsyncSession, user: User, *, include_archived: bool = True,
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
