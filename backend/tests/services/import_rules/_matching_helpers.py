"""Builders for the matcher's own types, so a test states only what it is about"""

import uuid

from app.services.import_rules.matching import (
    MatchAccount,
    MatchAmount,
    MatchCandidate,
    MatchDirection,
    MatchGroup,
    MatchRule,
    MatchText,
    RuleTag,
    normalize_text,
)

ACCOUNT_A = uuid.uuid4()
ACCOUNT_B = uuid.uuid4()
MERCHANT_MARKET = uuid.uuid4()
MERCHANT_AMAZON = uuid.uuid4()
CATEGORY_GROCERIES = uuid.uuid4()
CATEGORY_LARGE = uuid.uuid4()
TAG_REVIEW = RuleTag(uuid.uuid4(), "review")
TAG_FOOD = RuleTag(uuid.uuid4(), "food")


def text(attribute: str, operator: str, value: str) -> MatchText:
    """A text condition, its value normalised as the loader normalises it"""
    return MatchText(attribute, operator, normalize_text(value))


def description(operator: str, value: str) -> MatchText:
    """A condition on the description"""
    return text("description", operator, value)


def note(operator: str, value: str) -> MatchText:
    """A condition on the note"""
    return text("note", operator, value)


def amount(operator: str, minor_units: int, currency: str = "CAD") -> MatchAmount:
    """A condition on the size of the amount"""
    return MatchAmount(operator, minor_units, currency)


def direction(value: str) -> MatchDirection:
    """A condition on money in or out"""
    return MatchDirection(money_in=value == "in")


def account(operator: str, account_id: uuid.UUID, exists: bool = True) -> MatchAccount:
    """A condition on the account"""
    return MatchAccount(operator, account_id, exists)


def group(match: str, *conditions) -> MatchGroup:
    """A group of conditions"""
    return MatchGroup(match, tuple(conditions))


def rule(name: str, *items, match: str = "all", merchant=None, category=None, tags=()) -> MatchRule:
    """A rule setting what it is given"""
    return MatchRule(uuid.uuid4(), name, match, tuple(items), merchant, category, tuple(tags))


def candidate(
    description_text="SQ *MARKET 1234 TORONTO", note_text=None, amount_minor=-1250, currency="CAD", account_id=ACCOUNT_A, is_transfer=False
):
    """A transaction as the matcher is asked about it"""
    return MatchCandidate(description_text, note_text, amount_minor, currency, account_id, is_transfer)
