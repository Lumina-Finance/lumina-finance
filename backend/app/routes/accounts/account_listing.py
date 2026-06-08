"""Account listing helpers"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.account import Account, AccountPermission
from app.models.group import GroupMember


async def get_accounts_visible_to_user(db: AsyncSession, user_id: uuid.UUID) -> list[Account]:
    """Return accounts visible to a user

    Args:
        db: Active database session
        user_id: Authenticated user identifier

    Returns:
        Accounts visible through ownership, group admin membership, or explicit permission
    """
    # Personal ownership, group admin access, and explicit account permissions all feed the overview
    query = (
        select(Account)
        .options(selectinload(Account.institution))
        .outerjoin(GroupMember, Account.group_id == GroupMember.group_id)
        .outerjoin(
            AccountPermission,
            (AccountPermission.account_id == Account.id) & (AccountPermission.user_id == user_id),
        )
        .where(
            (Account.owner_id == user_id)
            | ((GroupMember.user_id == user_id) & (GroupMember.is_admin.is_(True)))
            | (AccountPermission.user_id == user_id),
        )
        .order_by(Account.created_at)
    )
    result = await db.execute(query)
    return list(result.scalars().unique().all())
