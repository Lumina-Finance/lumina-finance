"""Listing import rules"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_rule import ImportRule
from app.schemas.import_rule import ImportRuleGroupResponse, ImportRuleResponse, TextCondition
from app.services.import_rules.responses import build_import_rule_responses


def _searchable_text(rule: ImportRuleResponse) -> list[str]:
    """Return the text a search looks in for a rule

    That is the rule's name, the text its Description and Note conditions look for (those inside groups
    included), and the names of the merchant, category and tags it sets. Operators, attribute names,
    amounts, directions and accounts are what the row's sentence is built from, so they are left out
    """
    texts = [rule.name]
    for item in rule.conditions:
        for condition in item.conditions if isinstance(item, ImportRuleGroupResponse) else [item]:
            if isinstance(condition, TextCondition):
                texts.append(condition.value)
    if rule.merchant is not None:
        texts.append(rule.merchant.name)
    if rule.category is not None:
        texts.append(rule.category.name)
    texts.extend(tag.name for tag in rule.tags)
    return texts


async def list_import_rules(
    db: AsyncSession, user_id: uuid.UUID, limit: int, offset: int, search_text: str | None = None
) -> list[ImportRuleResponse]:
    """Return a page of the user's rules in the order they are checked

    A search is answered in Python after one read of the user's rules. A person's rules hold at most
    100 conditions between them, so at most 100 rules, and the names a match can be found in sit in
    other tables, which SQL would need a join for each kind to reach

    Args:
        db: Active database session
        user_id: Authenticated user
        limit: Most rules to return
        offset: Rules to skip before the page
        search_text: Text to find in a rule, ignoring case, or None for every rule

    Returns:
        The rules, first checked first
    """
    statement = select(ImportRule).where(ImportRule.owner_id == user_id).order_by(ImportRule.position)
    needle = search_text.strip().casefold() if search_text else ""
    if not needle:
        rules = list(await db.scalars(statement.limit(limit).offset(offset)))
        return await build_import_rule_responses(db, user_id, rules)

    everything = await build_import_rule_responses(db, user_id, list(await db.scalars(statement)))
    found = [rule for rule in everything if any(needle in text.casefold() for text in _searchable_text(rule))]
    return found[offset : offset + limit]
