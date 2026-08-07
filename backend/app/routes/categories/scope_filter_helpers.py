"""Category SQL scope filter helpers"""

import uuid

import sqlalchemy as sa
from sqlalchemy import select

from app.models.category import Category
from app.models.group import GroupMember


def get_personal_category_filter(user_id: uuid.UUID):
    """Return the SQL filter for categories owned by a user

    Args:
        user_id: User identifier for the personal category scope

    Returns:
        SQLAlchemy filter matching personal categories for the user
    """
    personal_filter = (Category.owner_id == user_id) & (Category.group_id.is_(None))
    return personal_filter


def get_system_or_personal_category_filter(user_id: uuid.UUID):
    """Return the SQL filter for system or user-owned categories

    Args:
        user_id: User identifier for the personal category scope

    Returns:
        SQLAlchemy filter matching system categories or personal categories
    """
    category_filter = Category.is_system.is_(True) | get_personal_category_filter(user_id)
    return category_filter


def get_accessible_category_filter(user_id: uuid.UUID):
    """Return the SQL filter for categories visible to a user

    Args:
        user_id: User identifier used for personal and group access

    Returns:
        SQLAlchemy filter matching system, personal, and group categories
    """
    membership_filter = GroupMember.user_id == user_id

    # Build a subquery of group memberships so category access can include group-scoped categories
    group_ids = select(GroupMember.group_id).where(membership_filter).scalar_subquery()
    category_filter = get_system_or_personal_category_filter(user_id) | (Category.group_id.in_(group_ids))
    return category_filter


def get_category_name_conflict_filter(name: str, user_id: uuid.UUID, group_id: uuid.UUID | None):
    """Return the SQL filter for duplicate category names in a scope

    Args:
        name: Requested category name
        user_id: User identifier for personal category scope
        group_id: Optional group identifier for group category scope

    Returns:
        SQLAlchemy filter matching conflicting category names
    """
    scope_filter = Category.is_system.is_(True)
    if group_id:
        scope_filter = scope_filter | (Category.group_id == group_id)
    else:
        scope_filter = scope_filter | get_personal_category_filter(user_id)

    # Trimmed and compared with capitals folded, which is what the unique indexes are built on, so
    # the route and the database reach the same verdict. SQL lower() rather than Python casefold(),
    # which disagree for a handful of characters and would leave the index refusing what this allows
    conflict_filter = (sa.func.lower(Category.name) == name.strip().lower()) & scope_filter
    return conflict_filter
