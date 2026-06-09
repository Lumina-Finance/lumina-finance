"""Shared transaction access query helpers"""
import uuid

from sqlalchemy import select

from app.models.account import Account, AccountPermission
from app.models.group import GroupMember


def accessible_account_ids_subquery(user_id: uuid.UUID):
    """Return a scalar subquery for accounts the user can read

    Args:
        user_id: Identifier for the user requesting transaction access

    Returns:
        A scalar subquery of account IDs readable by the user through ownership,
        group admin access, or explicit account permissions
    """
    return (
        select(Account.id)
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
    ).scalar_subquery()
