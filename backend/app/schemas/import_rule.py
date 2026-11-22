"""Import rule schemas"""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Discriminator, Field, Tag, field_validator
from pydantic.json_schema import SkipJsonSchema

from app.models.import_rule import MAX_IMPORT_RULE_NAME_LENGTH
from app.schemas.import_run import MAX_IMPORT_TAGS_PER_ROW
from app.schemas.limits import Counter
from app.schemas.names import TrimmedName
from app.utils.money import MAX_MINOR_UNITS

# Conditions all of one person's rules may hold together, groups' conditions included. Every imported
# row is checked against every rule of its owner, and a condition checked against a row is one
# comparison, so this holds the worst case to 100 comparisons per imported row. A rule holds at least one
# condition, so it also holds a person to 100 rules. Raising the budget is a change to this figure alone
MAX_IMPORT_RULE_CONDITIONS = 100

# Characters a text condition's value may carry, enough for a long bank description
MAX_IMPORT_RULE_TEXT_LENGTH = 200

# Characters of an amount as typed. The service reads it in its currency's own precision and refuses
# one it can't hold, so this only bounds what is read
MAX_IMPORT_RULE_AMOUNT_LENGTH = 40

ImportRuleMatchValue = Literal["all", "any"]
TextOperator = Literal["contains", "not_contains", "is", "is_not", "starts_with", "ends_with"]
AmountOperator = Literal["is", "at_least", "at_most"]
AccountOperator = Literal["is", "is_not"]
TextValue = Annotated[TrimmedName, Field(min_length=1, max_length=MAX_IMPORT_RULE_TEXT_LENGTH)]
RuleName = Annotated[TrimmedName, Field(min_length=1, max_length=MAX_IMPORT_RULE_NAME_LENGTH)]

# A rule names tags to add, and a row takes at most this many, so a rule asking for more could
# never have them all land
MAX_IMPORT_RULE_TAGS = MAX_IMPORT_TAGS_PER_ROW

# Where a condition's account is looked up: whether it still exists
AccountState = Literal["exists", "deleted"]


class _Condition(BaseModel):
    """What every condition carries: a field this version does not take is refused, not dropped."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["condition"]


class TextCondition(_Condition):
    """The bank's description, or a note, compared with text the user typed."""

    attribute: Literal["description", "note"]
    operator: TextOperator
    value: TextValue


class DirectionCondition(_Condition):
    """Whether money came in or went out."""

    attribute: Literal["direction"]
    operator: Literal["is"]
    value: Literal["in", "out"]


class AccountCondition(_Condition):
    """Whether the transaction is in one of the user's accounts."""

    attribute: Literal["account"]
    operator: AccountOperator
    value: uuid.UUID


class AmountConditionRequest(_Condition):
    """The size of the amount, in one currency, and matching only transactions in that currency."""

    attribute: Literal["amount"]
    operator: AmountOperator

    # Decimal text as the user typed it. The service reads it at the currency's own precision and
    # refuses one it can't hold, so a figure is never rounded
    value: str = Field(min_length=1, max_length=MAX_IMPORT_RULE_AMOUNT_LENGTH)
    currency: str = Field(pattern=r"^[A-Z]{3}$", max_length=3)


ImportRuleConditionRequest = Annotated[
    TextCondition | AmountConditionRequest | DirectionCondition | AccountCondition,
    Field(discriminator="attribute"),
]


class ImportRuleGroupRequest(BaseModel):
    """Conditions held together, matching when all or any of them hold. A group holds no group."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["group"]
    match: ImportRuleMatchValue
    conditions: list[ImportRuleConditionRequest] = Field(min_length=1, max_length=MAX_IMPORT_RULE_CONDITIONS)


def _item_kind(item: object) -> str | None:
    """Return which kind of item a body or model holds, so the union can be told apart by hand

    A union of unions can't use a field discriminator, since OpenAPI has no way to map its inner
    union and the API's description would not build. A function names the choice instead, and the
    error paths read as they would for a field discriminator
    """
    kind = item.get("kind") if isinstance(item, dict) else getattr(item, "kind", None)
    return kind if kind in {"condition", "group"} else None


ImportRuleItemRequest = Annotated[
    Annotated[ImportRuleConditionRequest, Tag("condition")] | Annotated[ImportRuleGroupRequest, Tag("group")],
    Discriminator(_item_kind),
]


def count_import_rule_conditions(items: list) -> int:
    """Return how many conditions a list of items holds, the conditions inside groups included"""
    return sum(len(item.conditions) if isinstance(item, ImportRuleGroupRequest) else 1 for item in items)


def _require_few_conditions(items: list) -> list:
    """Refuse a rule holding more conditions than the budget, which no request could be left with room for"""
    if count_import_rule_conditions(items) > MAX_IMPORT_RULE_CONDITIONS:
        raise ValueError(f"must hold at most {MAX_IMPORT_RULE_CONDITIONS} conditions in all")
    return items


def _require_unique(tag_ids: list[uuid.UUID]) -> list[uuid.UUID]:
    """Refuse a rule naming the same tag twice"""
    if len(set(tag_ids)) != len(tag_ids):
        raise ValueError("must not repeat a tag")
    return tag_ids


class CreateImportRuleRequest(BaseModel):
    """Create a rule at the bottom of the list."""

    name: RuleName
    match: ImportRuleMatchValue
    conditions: list[ImportRuleItemRequest] = Field(min_length=1, max_length=MAX_IMPORT_RULE_CONDITIONS)
    merchant_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    tag_ids: list[uuid.UUID] = Field(default=[], max_length=MAX_IMPORT_RULE_TAGS)

    @field_validator("conditions")
    @classmethod
    def require_few_conditions(cls, items: list) -> list:
        """Refuse more conditions than a rule may hold"""
        return _require_few_conditions(items)

    @field_validator("tag_ids")
    @classmethod
    def require_unique_tags(cls, tag_ids: list[uuid.UUID]) -> list[uuid.UUID]:
        """Refuse a repeated tag"""
        return _require_unique(tag_ids)


class UpdateImportRuleRequest(BaseModel):
    """Partial update for a rule. Only provided fields are changed, and a null merchant or category clears it."""

    # None represents omission internally, while explicit null is rejected where the field cannot be empty
    name: RuleName | SkipJsonSchema[None] = None
    match: ImportRuleMatchValue | SkipJsonSchema[None] = None
    conditions: Annotated[list[ImportRuleItemRequest], Field(min_length=1, max_length=MAX_IMPORT_RULE_CONDITIONS)] | SkipJsonSchema[None] = None
    merchant_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    tag_ids: Annotated[list[uuid.UUID], Field(max_length=MAX_IMPORT_RULE_TAGS)] | SkipJsonSchema[None] = None

    @field_validator("name", "match", "conditions", "tag_ids", mode="before")
    @classmethod
    def reject_explicit_null(cls, value: object) -> object:
        """Reject a supplied null for a field a rule cannot be without, while leaving omitted fields unchanged

        Args:
            value: Field as supplied in the request body

        Returns:
            The value for normal validation

        Raises:
            ValueError: The supplied value is null
        """
        if value is None:
            raise ValueError("must not be null")
        return value

    @field_validator("conditions")
    @classmethod
    def require_few_conditions(cls, items: list | None) -> list | None:
        """Refuse more conditions than a rule may hold"""
        return None if items is None else _require_few_conditions(items)

    @field_validator("tag_ids")
    @classmethod
    def require_unique_tags(cls, tag_ids: list[uuid.UUID] | None) -> list[uuid.UUID] | None:
        """Refuse a repeated tag"""
        return None if tag_ids is None else _require_unique(tag_ids)


class MoveImportRuleRequest(BaseModel):
    """The place a rule should take in the order they are checked, counted from zero."""

    position: Counter


class ImportRuleBudgetResponse(BaseModel):
    """The conditions all of a person's rules may hold together, and how many they hold now."""

    limit: int
    used: int


class NamedReference(BaseModel):
    """A merchant, category or tag a rule sets, with the name a row shows."""

    id: uuid.UUID
    name: str


class AmountCondition(_Condition):
    """An amount condition as stored and returned."""

    attribute: Literal["amount"]
    operator: AmountOperator

    # Minor units of the condition's currency, like every amount the API returns. Zero would match
    # nothing useful and a negative figure would read backwards, since the size is compared
    value: int = Field(gt=0, le=MAX_MINOR_UNITS)
    currency: str = Field(pattern=r"^[A-Z]{3}$", max_length=3)


class AccountConditionResponse(AccountCondition):
    """An account condition, saying whether its account still exists and what it is called."""

    # A condition on a deleted account never matches, whether it asks for the account or against it
    account_state: AccountState
    account_name: str | None


ImportRuleConditionResponse = Annotated[
    TextCondition | AmountCondition | DirectionCondition | AccountConditionResponse,
    Field(discriminator="attribute"),
]


class ImportRuleGroupResponse(BaseModel):
    """A group of conditions as returned."""

    kind: Literal["group"]
    match: ImportRuleMatchValue
    conditions: list[ImportRuleConditionResponse]


ImportRuleItemResponse = Annotated[
    Annotated[ImportRuleConditionResponse, Tag("condition")] | Annotated[ImportRuleGroupResponse, Tag("group")],
    Discriminator(_item_kind),
]


class ImportRuleResponse(BaseModel):
    """A rule as listed and returned by every write, with the names a row shows."""

    id: uuid.UUID
    name: str
    position: int
    match: ImportRuleMatchValue
    conditions: list[ImportRuleItemResponse]
    merchant: NamedReference | None
    category: NamedReference | None
    tags: list[NamedReference]
    created_at: datetime
    updated_at: datetime
