"""Dashboard account access service

Dashboard routes and insight services share this helper so readable-account
scoping stays consistent across aggregate views
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, AccountPermission
from app.models.group import GroupMember
from app.models.user import User

# ---------------------------------------------------------------------------
# Account access
# ---------------------------------------------------------------------------


async def get_accessible_accounts(
    db: AsyncSession, user: User, *, include_archived: bool = True,
) -> list[Account]:
    """Return accounts the user can read, including archived accounts by default"""
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

    result = await db.execute(
        query,
    )
    return list(result.scalars().unique().all())
