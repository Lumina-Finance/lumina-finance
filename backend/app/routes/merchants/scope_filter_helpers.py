"""Merchant SQL scope filter helpers"""

import uuid

from sqlalchemy import select

from app.models.category import Category
from app.models.group import GroupMember
from app.models.merchant import Merchant


def get_personal_category_filter(user_id: uuid.UUID):
    """Return the SQL filter for categories owned by a user

    Args:
        user_id: User identifier for the personal category scope

    Returns:
        SQLAlchemy filter matching personal categories for the user
    """
    personal_filter = (Category.owner_id == user_id) & (Category.group_id.is_(None))
    return personal_filter


def get_default_category_scope_filter(user_id: uuid.UUID, group_id: uuid.UUID | None):
    """Return the SQL filter for merchant default categories

    Args:
        user_id: User identifier for personal categories
        group_id: Optional group identifier for group categories

    Returns:
        SQLAlchemy filter matching categories valid for the merchant scope
    """
    category_filter = Category.is_system.is_(True) | get_personal_category_filter(user_id)
    if group_id is not None:
        category_filter = category_filter | (Category.group_id == group_id)
    return category_filter


def get_personal_merchant_filter(user_id: uuid.UUID):
    """Return the SQL filter for merchants owned by a user

    Args:
        user_id: User identifier for personal merchants

    Returns:
        SQLAlchemy filter matching personal merchants for the user
    """
    merchant_filter = (Merchant.owner_id == user_id) & (Merchant.group_id.is_(None))
    return merchant_filter


def get_merchant_list_scope_filter(user_id: uuid.UUID, group_id: uuid.UUID | None):
    """Return the SQL filter for listing merchants in a scope

    Args:
        user_id: User identifier for personal merchants
        group_id: Optional group identifier for group merchants

    Returns:
        SQLAlchemy filter matching personal merchants and optional group merchants
    """
    if group_id is None:
        merchant_filter = get_personal_merchant_filter(user_id)
        return merchant_filter

    merchant_filter = get_personal_merchant_filter(user_id) | (Merchant.group_id == group_id)
    return merchant_filter


def get_accessible_merchant_filter(user_id: uuid.UUID):
    """Return the SQL filter for merchants visible to a user

    Args:
        user_id: User identifier used for personal and group access

    Returns:
        SQLAlchemy filter matching personal and group merchants
    """
    membership_filter = GroupMember.user_id == user_id

    # Build a subquery of group memberships so merchant access can include group-scoped merchants
    group_ids = select(GroupMember.group_id).where(membership_filter).scalar_subquery()
    merchant_filter = get_personal_merchant_filter(user_id) | (Merchant.group_id.in_(group_ids))
    return merchant_filter
