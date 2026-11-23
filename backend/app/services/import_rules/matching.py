"""Working out which of a person's import rules match a transaction, and what they give it

Pure: nothing here reads the database or the session, so a large file can be matched off the event
loop. The loader hands over the rules in the order they are checked, already parsed into the small
types below
"""

import operator
import uuid
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass

from app.schemas.import_rule import AccountOperator, AmountOperator, ImportRuleMatchValue, TextOperator


@dataclass(frozen=True)
class MatchText:
    """A condition on the description or the note

    Attributes:
        attribute: Which text it reads
        operator: How it compares
        value: What it compares with, already normalised
    """

    attribute: str
    operator: TextOperator
    value: str


@dataclass(frozen=True)
class MatchAmount:
    """A condition on the size of the amount, in one currency

    Attributes:
        operator: How it compares
        minor_units: The size to compare with, in the currency's minor units
        currency: The only currency it matches
    """

    operator: AmountOperator
    minor_units: int
    currency: str


@dataclass(frozen=True)
class MatchDirection:
    """A condition on money coming in or going out"""

    money_in: bool


@dataclass(frozen=True)
class MatchAccount:
    """A condition on the account

    Attributes:
        operator: Whether it asks for the account or against it
        account_id: The account it names
        exists: Whether that account still exists. A condition on one that does not never matches
    """

    operator: AccountOperator
    account_id: uuid.UUID
    exists: bool


type MatchCondition = MatchText | MatchAmount | MatchDirection | MatchAccount


@dataclass(frozen=True)
class MatchGroup:
    """Conditions held together, matching when all or any of them hold"""

    match: ImportRuleMatchValue
    conditions: tuple[MatchCondition, ...]


@dataclass(frozen=True)
class RuleTag:
    """A tag a rule adds

    Attributes:
        id: The tag
        key: Its name as a file's tag names are compared with it: trimmed, with capitals folded
    """

    id: uuid.UUID
    key: str


@dataclass(frozen=True)
class MatchRule:
    """One rule as the matcher needs it

    Attributes:
        id: The rule's identifier
        name: The rule's name, which a result quotes beside what it gave
        match: Whether the rule needs all of its items to hold or any one
        items: The rule's conditions and groups
        merchant_id: Merchant the rule sets, if any
        category_id: Category the rule sets, if any
        tags: Tags the rule adds
    """

    id: uuid.UUID
    name: str
    match: ImportRuleMatchValue
    items: tuple[MatchCondition | MatchGroup, ...]
    merchant_id: uuid.UUID | None
    category_id: uuid.UUID | None
    tags: tuple[RuleTag, ...]


@dataclass(frozen=True)
class MatchCandidate:
    """The facts about one transaction that rules compare

    Attributes:
        description: The bank's text, or None where the source gave none
        note: A file's memo, or None where the source gave none
        amount: Signed amount in minor units, or None where it could not be read
        currency: Code of the transaction's currency
        account_id: The account it is in, or None for an account the import is still to create
        is_transfer: Whether it is filed as a transfer. Rules leave transfers alone
    """

    description: str | None
    note: str | None
    amount: int | None
    currency: str
    account_id: uuid.UUID | None
    is_transfer: bool


@dataclass(frozen=True)
class RuleRef:
    """The rule behind a value"""

    id: uuid.UUID
    name: str


@dataclass(frozen=True)
class Supplied:
    """One value a rule gives, and the rule it came from"""

    value: uuid.UUID
    rule: RuleRef


@dataclass(frozen=True)
class SuppliedTag(Supplied):
    """A tag a rule adds, with the key a file's tag names are compared with"""

    key: str


@dataclass(frozen=True)
class RuleMatch:
    """What the rules give one transaction

    Attributes:
        merchant: The merchant from the highest rule that sets one
        category: The category from the highest rule that sets one
        tags: Every tag any matching rule adds, once each, from the highest rule that adds it
    """

    merchant: Supplied | None = None
    category: Supplied | None = None
    tags: tuple[SuppliedTag, ...] = ()


def normalize_text(text: str | None) -> str:
    """Return text as rules compare it: trimmed, capitals folded and every run of whitespace made one space"""
    return " ".join((text or "").split()).casefold()


class _Facts:
    """A candidate with the text it is compared by already normalised, so no condition redoes that"""

    __slots__ = ("account_id", "amount", "currency", "description", "note")

    def __init__(self, description: str, note: str, amount: int | None, currency: str, account_id: uuid.UUID | None) -> None:
        self.description = description
        self.note = note
        self.amount = amount
        self.currency = currency
        self.account_id = account_id


type _Test = Callable[[_Facts], bool]

_TEXT_OPERATORS: dict[str, Callable[[str, str], bool]] = {
    "contains": operator.contains,
    "not_contains": lambda text, needle: needle not in text,
    "is": operator.eq,
    "is_not": operator.ne,
    "starts_with": str.startswith,
    "ends_with": str.endswith,
}

# Compared on the amount's size, since a bank writes money out as a negative figure
_AMOUNT_OPERATORS: dict[str, Callable[[int, int], bool]] = {
    "is": operator.eq,
    "at_least": operator.ge,
    "at_most": operator.le,
}

_NO_MATCH = RuleMatch()


class ImportRuleMatcher:
    """A person's rules in the order they are checked, ready to be asked about many transactions"""

    def __init__(self, rules: Sequence[MatchRule]) -> None:
        """Turn each rule into one test, so a large file does not redo that for every row

        Args:
            rules: The rules, highest first
        """
        self._rules = [
            (rule, RuleRef(rule.id, rule.name), _combine(rule.match, [_compile_item(item) for item in rule.items])) for rule in rules
        ]
        attributes = {condition.attribute for rule in rules for condition in _conditions_of(rule) if isinstance(condition, MatchText)}

        # A row's text is normalised only when some condition reads it
        self._reads_description = "description" in attributes
        self._reads_note = "note" in attributes

    def match(self, candidate: MatchCandidate) -> RuleMatch:
        """Return what the rules give a transaction

        Each of the merchant and the category comes from the highest rule that matches and sets it,
        and tags gather from every rule that matches. A transfer is left alone

        Args:
            candidate: The transaction's facts

        Returns:
            The values to fill in, each with its rule
        """
        if candidate.is_transfer:
            return _NO_MATCH

        facts = _Facts(
            normalize_text(candidate.description) if self._reads_description else "",
            normalize_text(candidate.note) if self._reads_note else "",
            candidate.amount,
            candidate.currency,
            candidate.account_id,
        )
        merchant: Supplied | None = None
        category: Supplied | None = None
        tags: dict[uuid.UUID, SuppliedTag] = {}
        for rule, ref, holds in self._rules:
            if not holds(facts):
                continue
            if merchant is None and rule.merchant_id is not None:
                merchant = Supplied(rule.merchant_id, ref)
            if category is None and rule.category_id is not None:
                category = Supplied(rule.category_id, ref)
            for tag in rule.tags:
                if tag.id not in tags:
                    tags[tag.id] = SuppliedTag(tag.id, ref, tag.key)
        if merchant is None and category is None and not tags:
            return _NO_MATCH
        return RuleMatch(merchant, category, tuple(tags.values()))


def _conditions_of(rule: MatchRule) -> Iterator[MatchCondition]:
    """Yield each condition a rule holds, the ones inside groups included"""
    for item in rule.items:
        if isinstance(item, MatchGroup):
            yield from item.conditions
        else:
            yield item


def _combine(match: ImportRuleMatchValue, tests: list[_Test]) -> _Test:
    """Join tests so they hold when all of them do, or when any one does"""
    if len(tests) == 1:
        return tests[0]
    if match == "all":

        def holds_all(facts: _Facts) -> bool:
            for test in tests:
                if not test(facts):
                    return False
            return True

        return holds_all

    def holds_any(facts: _Facts) -> bool:
        for test in tests:
            if test(facts):
                return True
        return False

    return holds_any


def _compile_item(item: MatchCondition | MatchGroup) -> _Test:
    """Return a condition, or a group of them, as a test"""
    if isinstance(item, MatchGroup):
        return _combine(item.match, [_compile_condition(condition) for condition in item.conditions])
    return _compile_condition(item)


def _compile_condition(condition: MatchCondition) -> _Test:
    """Return one condition as a test"""
    if isinstance(condition, MatchText):
        compare = _TEXT_OPERATORS[condition.operator]
        needle = condition.value
        if condition.attribute == "description":
            return lambda facts: compare(facts.description, needle)
        return lambda facts: compare(facts.note, needle)

    if isinstance(condition, MatchAmount):
        compare_amount = _AMOUNT_OPERATORS[condition.operator]
        limit, currency = condition.minor_units, condition.currency
        return lambda facts: facts.amount is not None and facts.currency == currency and compare_amount(abs(facts.amount), limit)

    if isinstance(condition, MatchDirection):
        money_in = condition.money_in

        # A zero amount went neither way, and an amount that could not be read says nothing
        return lambda facts: bool(facts.amount) and (facts.amount > 0) == money_in

    # A condition on an account that no longer exists never matches, whichever operator it uses.
    # Dropping it would widen the rule, and reading it as true of every other account would too
    account_id = condition.account_id
    if not condition.exists:
        return lambda facts: False
    if condition.operator == "is":
        return lambda facts: facts.account_id == account_id

    # An account the import is still to create is none of the ones a rule names
    return lambda facts: facts.account_id != account_id
