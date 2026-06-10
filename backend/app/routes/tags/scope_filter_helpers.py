"""Tag SQL scope filter helpers"""

import uuid

from sqlalchemy import select

from app.models.group import GroupMember
from app.models.tag import Tag


def get_personal_tag_filter(user_id: uuid.UUID):
    """Return the SQL filter for tags owned by a user

    Args:
        user_id: User identifier for personal tags

    Returns:
        SQLAlchemy filter matching personal tags for the user
    """
    tag_filter = (Tag.owner_id == user_id) & (Tag.group_id.is_(None))
    return tag_filter


def get_tag_list_scope_filter(user_id: uuid.UUID, group_id: uuid.UUID | None):
    """Return the SQL filter for listing tags in a scope

    Args:
        user_id: User identifier for personal tags
        group_id: Optional group identifier for group tags

    Returns:
        SQLAlchemy filter matching personal tags and optional group tags
    """
    if group_id is None:
        tag_filter = get_personal_tag_filter(user_id)
        return tag_filter

    tag_filter = get_personal_tag_filter(user_id) | (Tag.group_id == group_id)
    return tag_filter


def get_accessible_tag_filter(user_id: uuid.UUID):
    """Return the SQL filter for tags visible to a user

    Args:
        user_id: User identifier used for personal and group access

    Returns:
        SQLAlchemy filter matching personal and group tags
    """
    membership_filter = GroupMember.user_id == user_id

    # Build a subquery of group memberships so tag access can include group-scoped tags
    group_ids = select(GroupMember.group_id).where(membership_filter).scalar_subquery()
    tag_filter = get_personal_tag_filter(user_id) | (Tag.group_id.in_(group_ids))
    return tag_filter
