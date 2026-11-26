"""Turning stored rules into the responses the API returns"""

import uuid
from collections.abc import Iterable
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.category import Category
from app.models.import_rule import ImportRule, ImportRuleTag
from app.models.merchant import Merchant
from app.models.tag import Tag
from app.schemas.import_rule import ImportRuleResponse, NamedReference
from app.services.accounts.access import own_personal_account_condition


def _stored_conditions(rule: ImportRule) -> Iterable[dict[str, Any]]:
    """Yield each condition a stored rule holds, the ones inside groups included"""
    for item in rule.conditions:
        yield from item["conditions"] if item["kind"] == "group" else [item]


async def build_import_rule_responses(db: AsyncSession, user_id: uuid.UUID, rules: list[ImportRule]) -> list[ImportRuleResponse]:
    """Return rules as the API lists them, with the names their rows show

    The names come from one statement for each kind, however many rules there are, so a page of
    rules costs the same as one rule. A kind nothing names is not asked for

    Args:
        db: Active database session
        user_id: Authenticated user
        rules: The rules to describe, in the order to return them

    Returns:
        One response for each rule, in the same order
    """
    if not rules:
        return []

    merchant_ids = {rule.merchant_id for rule in rules if rule.merchant_id is not None}
    category_ids = {rule.category_id for rule in rules if rule.category_id is not None}
    account_ids = {condition["value"] for rule in rules for condition in _stored_conditions(rule) if condition["attribute"] == "account"}

    merchants: dict[uuid.UUID, str] = {}
    if merchant_ids:
        merchant_rows = await db.execute(select(Merchant.id, Merchant.name).where(Merchant.id.in_(merchant_ids)))
        merchants = {merchant_id: name for merchant_id, name in merchant_rows}
    categories: dict[uuid.UUID, str] = {}
    if category_ids:
        category_rows = await db.execute(select(Category.id, Category.name).where(Category.id.in_(category_ids)))
        categories = {category_id: name for category_id, name in category_rows}

    # Condition values come back from the database as text, and an account deleted since is just absent here
    accounts: dict[str, str] = {}
    if account_ids:
        found = await db.execute(
            select(Account.id, Account.name).where(
                Account.id.in_([uuid.UUID(value) for value in account_ids]), own_personal_account_condition(user_id)
            )
        )
        accounts = {str(account_id): name for account_id, name in found}

    tags_by_rule: dict[uuid.UUID, list[NamedReference]] = {}
    tag_rows = await db.execute(
        select(ImportRuleTag.import_rule_id, Tag.id, Tag.name)
        .join(Tag, Tag.id == ImportRuleTag.tag_id)
        .where(ImportRuleTag.import_rule_id.in_([rule.id for rule in rules]))
        .order_by(func.lower(Tag.name), Tag.id)
    )
    for rule_id, tag_id, tag_name in tag_rows:
        tags_by_rule.setdefault(rule_id, []).append(NamedReference(id=tag_id, name=tag_name))

    def describe(condition: dict[str, Any]) -> dict[str, Any]:
        if condition["attribute"] != "account":
            return condition
        name = accounts.get(condition["value"])
        return {**condition, "account_state": "exists" if name is not None else "deleted", "account_name": name}

    return [
        ImportRuleResponse(
            id=rule.id,
            name=rule.name,
            position=rule.position,
            match=rule.match,
            conditions=[
                {**item, "conditions": [describe(condition) for condition in item["conditions"]]} if item["kind"] == "group" else describe(item)
                for item in rule.conditions
            ],
            merchant=NamedReference(id=rule.merchant_id, name=merchants[rule.merchant_id]) if rule.merchant_id is not None else None,
            category=NamedReference(id=rule.category_id, name=categories[rule.category_id]) if rule.category_id is not None else None,
            tags=tags_by_rule.get(rule.id, []),
            created_at=rule.created_at,
            updated_at=rule.updated_at,
        )
        for rule in rules
    ]
