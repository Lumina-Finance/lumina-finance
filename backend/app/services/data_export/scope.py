"""Which rows belong in a user's export of their own data

The export holds what the user owns personally. A group's accounts, budgets, categories, merchants,
tags and tax-advantaged categories stay out, even those the user administers, and so does every
row reached only through them. Row-level security still limits every query to what the user can
read, so these conditions only narrow it further
"""

import uuid

from sqlalchemy import ColumnElement, Select, select

from app.models.account import Account, TaxAdvantagedCategory
from app.models.budget import BaseBudget
from app.models.category import Category
from app.models.merchant import Merchant
from app.models.tag import Tag


def personal_account_ids(user_id: uuid.UUID) -> Select[tuple[uuid.UUID]]:
    """Select the accounts the user owns, leaving out every group's"""
    return select(Account.id).where(Account.owner_id == user_id, Account.group_id.is_(None))


def is_personal_account(user_id: uuid.UUID) -> ColumnElement[bool]:
    """Match an account the user owns, for a query that already reads the accounts table"""
    return (Account.owner_id == user_id) & Account.group_id.is_(None)


def is_personal_category(user_id: uuid.UUID) -> ColumnElement[bool]:
    """Match a category the user made, leaving out the ones every user shares and every group's"""
    return (Category.owner_id == user_id) & Category.group_id.is_(None) & Category.is_system.is_(False)


def is_personal_merchant(user_id: uuid.UUID) -> ColumnElement[bool]:
    """Match a merchant the user made, leaving out the ones every user shares and every group's"""
    return (Merchant.owner_id == user_id) & Merchant.group_id.is_(None) & Merchant.is_system.is_(False)


def is_personal_tag(user_id: uuid.UUID) -> ColumnElement[bool]:
    """Match a tag the user made, leaving out every group's"""
    return (Tag.owner_id == user_id) & Tag.group_id.is_(None)


def is_personal_budget(user_id: uuid.UUID) -> ColumnElement[bool]:
    """Match a budget the user owns, leaving out every group's"""
    return (BaseBudget.owner_id == user_id) & BaseBudget.group_id.is_(None)


def is_personal_tax_advantaged_category(user_id: uuid.UUID) -> ColumnElement[bool]:
    """Match a tax-advantaged category the user owns, leaving out every group's"""
    return (TaxAdvantagedCategory.category_owner_user_id == user_id) & TaxAdvantagedCategory.group_id.is_(None)
