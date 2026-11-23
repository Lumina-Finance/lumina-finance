"""Reading a person's import rules, in the order they are checked, ready for the matcher"""

import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.import_rule import ImportRule, ImportRuleTag
from app.models.tag import Tag
from app.services.accounts.access import own_personal_account_condition
from app.services.import_rules.matching import (
    ImportRuleMatcher,
    MatchAccount,
    MatchAmount,
    MatchCondition,
    MatchDirection,
    MatchGroup,
    MatchRule,
    MatchText,
    RuleTag,
    normalize_text,
)


@dataclass(frozen=True)
class LoadedImportRules:
    """A person's rules as the matcher takes them

    Attributes:
        rules: The rules, first checked first
        version: A digest of everything the matcher reads from them, which differs whenever a rule is
            created, edited, moved or deleted, or a merchant, category, tag or account a rule names
            is changed in a way that changes what it matches. The preview's batches carry it, so a
            batch read after a rule changed is told apart from the ones before
    """

    rules: tuple[MatchRule, ...]
    version: str

    def build_matcher(self) -> ImportRuleMatcher:
        """Return a matcher over the rules"""
        return ImportRuleMatcher(self.rules)


def tag_key(name: str) -> str:
    """Return a tag's name as a file's tag names are compared with it: trimmed, with capitals folded"""
    return name.strip().casefold()


def _named_account_ids(items: list[dict[str, Any]]) -> set[uuid.UUID]:
    """Return the accounts a stored rule's conditions name"""
    named: set[uuid.UUID] = set()
    for item in items:
        for condition in item["conditions"] if item["kind"] == "group" else [item]:
            if condition["attribute"] == "account":
                named.add(uuid.UUID(condition["value"]))
    return named


def _parse_condition(stored: dict[str, Any], existing_account_ids: set[uuid.UUID]) -> MatchCondition:
    """Read one stored condition, with text normalised once so no row's comparison redoes it"""
    attribute = stored["attribute"]
    if attribute in ("description", "note"):
        return MatchText(attribute, stored["operator"], normalize_text(stored["value"]))
    if attribute == "amount":
        return MatchAmount(stored["operator"], stored["value"], stored["currency"])
    if attribute == "direction":
        return MatchDirection(money_in=stored["value"] == "in")
    account_id = uuid.UUID(stored["value"])
    return MatchAccount(stored["operator"], account_id, account_id in existing_account_ids)


def _parse_item(stored: dict[str, Any], existing_account_ids: set[uuid.UUID]) -> MatchCondition | MatchGroup:
    """Read one stored condition or group"""
    if stored["kind"] == "group":
        return MatchGroup(stored["match"], tuple(_parse_condition(condition, existing_account_ids) for condition in stored["conditions"]))
    return _parse_condition(stored, existing_account_ids)


async def load_import_rules(db: AsyncSession, user_id: uuid.UUID) -> LoadedImportRules:
    """Read a person's rules by position, with their tags and which of the accounts they name still exist

    Two statements however many rules there are. The rules and their tags come in one, so a rule
    edited at that moment can't give conditions and tags from before and after. The accounts a
    condition names are read as the rule responses read them, so the editor and the matcher agree on
    which still exist

    Args:
        db: Active database session
        user_id: Owner of the rules

    Returns:
        The rules, first checked first, and the version they make
    """
    rows = await db.execute(
        select(ImportRule, Tag.id, Tag.name)
        .outerjoin(ImportRuleTag, ImportRuleTag.import_rule_id == ImportRule.id)
        .outerjoin(Tag, Tag.id == ImportRuleTag.tag_id)
        .where(ImportRule.owner_id == user_id)
        .order_by(ImportRule.position, func.lower(Tag.name), Tag.id)
        .execution_options(populate_existing=True)
    )
    stored_rules: dict[uuid.UUID, ImportRule] = {}
    tags_by_rule: dict[uuid.UUID, list[RuleTag]] = {}
    for rule, tag_id, tag_name in rows:
        stored_rules[rule.id] = rule
        tags = tags_by_rule.setdefault(rule.id, [])
        if tag_id is not None:
            tags.append(RuleTag(tag_id, tag_key(tag_name)))

    named_account_ids = {account_id for rule in stored_rules.values() for account_id in _named_account_ids(rule.conditions)}
    existing_account_ids: set[uuid.UUID] = set()
    if named_account_ids:
        existing_account_ids = set(
            await db.scalars(select(Account.id).where(Account.id.in_(named_account_ids), own_personal_account_condition(user_id)))
        )

    rules = tuple(
        MatchRule(
            id=rule.id,
            name=rule.name,
            match=rule.match,
            items=tuple(_parse_item(item, existing_account_ids) for item in rule.conditions),
            merchant_id=rule.merchant_id,
            category_id=rule.category_id,
            tags=tuple(tags_by_rule[rule.id]),
        )
        for rule in stored_rules.values()
    )
    return LoadedImportRules(rules=rules, version=_digest(stored_rules.values(), tags_by_rule, existing_account_ids))


def _digest(rules, tags_by_rule: dict[uuid.UUID, list[RuleTag]], existing_account_ids: set[uuid.UUID]) -> str:
    """Return a digest of the rules as the matcher reads them

    Built from the very data the matcher is built from, so a change to any of it changes the digest
    and nothing the matcher doesn't read does: a rule's identity, name, place, conditions, merchant,
    category, each tag's identity and name, and which accounts it names still exist
    """
    content = [
        [
            str(rule.id),
            rule.name,
            rule.position,
            rule.match,
            rule.conditions,
            str(rule.merchant_id),
            str(rule.category_id),
            [[str(tag.id), tag.key] for tag in tags_by_rule[rule.id]],
        ]
        for rule in rules
    ]
    content.append(sorted(str(account_id) for account_id in existing_account_ids))
    return hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
