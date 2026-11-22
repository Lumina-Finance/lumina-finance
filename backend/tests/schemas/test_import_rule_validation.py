"""Import rule request shapes: what a body may carry before any service reads it"""

import uuid

import pytest
from pydantic import ValidationError

from app.models.import_rule import MAX_IMPORT_RULE_NAME_LENGTH
from app.schemas.import_rule import (
    MAX_IMPORT_RULE_CONDITIONS,
    MAX_IMPORT_RULE_TAGS,
    MAX_IMPORT_RULE_TEXT_LENGTH,
    CreateImportRuleRequest,
    MoveImportRuleRequest,
    UpdateImportRuleRequest,
)


def _text(value: str = "market") -> dict:
    """Return a description condition"""
    return {"kind": "condition", "attribute": "description", "operator": "contains", "value": value}


def _rule(**overrides) -> dict:
    """Return a create body that is accepted, setting one tag"""
    return {"name": "Market", "match": "all", "conditions": [_text()], "tag_ids": [str(uuid.uuid4())], **overrides}


def _group(*conditions: dict) -> dict:
    """Return a group of conditions"""
    return {"kind": "group", "match": "any", "conditions": list(conditions)}


def test_a_well_formed_rule_is_accepted():
    """The shapes below are each refused for one reason, so the base they change must pass"""
    nested = _rule(conditions=[_text(), _group(_text("a"), {"kind": "condition", "attribute": "direction", "operator": "is", "value": "in"})])

    assert CreateImportRuleRequest.model_validate(nested).conditions[1].kind == "group"


@pytest.mark.parametrize(
    "conditions",
    [
        [],
        [{"kind": "condition", "attribute": "payee", "operator": "is", "value": "x"}],
        [{"kind": "condition", "attribute": "description", "operator": "matches", "value": "x"}],
        [{"kind": "condition", "attribute": "direction", "operator": "is", "value": "sideways"}],
        [{"kind": "condition", "attribute": "account", "operator": "is", "value": "not an id"}],
        [{"kind": "condition", "attribute": "amount", "operator": "at_least", "value": "5", "currency": "cad"}],
        [{**_text(), "extra": "dropped silently otherwise"}],
        [_text("   ")],
        [_text("x" * (MAX_IMPORT_RULE_TEXT_LENGTH + 1))],
        [_group()],
        [_group(_group(_text()))],
    ],
    ids=[
        "none",
        "unknown attribute",
        "unknown operator",
        "unknown direction",
        "account not an id",
        "currency not a code",
        "unknown field",
        "blank text",
        "text past the limit",
        "empty group",
        "group inside a group",
    ],
)
def test_a_body_that_is_not_one_of_the_conditions_is_refused(conditions):
    """Nothing is dropped, rounded or guessed at: a condition this version doesn't take fails the request"""
    with pytest.raises(ValidationError):
        CreateImportRuleRequest.model_validate(_rule(conditions=conditions))


def test_text_at_the_limit_is_accepted_and_trimmed():
    """The longest value fits, and spaces around it are not part of what is compared"""
    rule = CreateImportRuleRequest.model_validate(_rule(conditions=[_text(f"  {'x' * MAX_IMPORT_RULE_TEXT_LENGTH}  ")]))

    assert rule.conditions[0].value == "x" * MAX_IMPORT_RULE_TEXT_LENGTH


def test_the_most_conditions_in_all_are_accepted_and_one_more_is_refused():
    """The bound counts the conditions inside groups too, so a rule can't hide extra ones in groups"""
    at_most = _rule(conditions=[_text()] * (MAX_IMPORT_RULE_CONDITIONS - 1) + [_group(_text())])
    CreateImportRuleRequest.model_validate(at_most)

    over_in_groups = _rule(conditions=[_group(*[_text()] * (MAX_IMPORT_RULE_CONDITIONS - 1)), _group(_text(), _text())])
    with pytest.raises(ValidationError, match="at most 100 conditions in all"):
        CreateImportRuleRequest.model_validate(over_in_groups)
    with pytest.raises(ValidationError):
        CreateImportRuleRequest.model_validate(_rule(conditions=[_text()] * (MAX_IMPORT_RULE_CONDITIONS + 1)))


def test_a_name_over_the_column_or_blank_is_refused_and_one_at_the_column_is_kept():
    """A name is held to what the column stores, and never stored with surrounding spaces"""
    assert (
        CreateImportRuleRequest.model_validate(_rule(name=f" {'n' * MAX_IMPORT_RULE_NAME_LENGTH} ")).name == "n" * MAX_IMPORT_RULE_NAME_LENGTH
    )
    for name in ("   ", "n" * (MAX_IMPORT_RULE_NAME_LENGTH + 1)):
        with pytest.raises(ValidationError):
            CreateImportRuleRequest.model_validate(_rule(name=name))


def test_tags_are_bounded_and_not_repeated():
    """A rule asking for more tags than a row takes could never have them all land, and a repeat is a mistake"""
    tags = [str(uuid.uuid4()) for _ in range(MAX_IMPORT_RULE_TAGS)]
    CreateImportRuleRequest.model_validate(_rule(tag_ids=tags))

    with pytest.raises(ValidationError):
        CreateImportRuleRequest.model_validate(_rule(tag_ids=[*tags, str(uuid.uuid4())]))
    with pytest.raises(ValidationError, match="must not repeat a tag"):
        CreateImportRuleRequest.model_validate(_rule(tag_ids=[tags[0], tags[0]]))


@pytest.mark.parametrize("position", [-1, "first", None, 1.5])
def test_a_position_that_is_not_a_place_is_refused(position):
    """A negative number, text, null or a fraction is never rounded to a place"""
    with pytest.raises(ValidationError):
        MoveImportRuleRequest.model_validate({"position": position})

    assert MoveImportRuleRequest.model_validate({"position": 0}).position == 0


def test_an_update_holds_its_fields_to_the_same_bounds_as_a_create():
    """A body that edits is checked as a body that creates is, so an edit can't carry what a create refuses"""
    tags = [str(uuid.uuid4()) for _ in range(MAX_IMPORT_RULE_TAGS)]
    UpdateImportRuleRequest.model_validate({"tag_ids": tags, "conditions": [_text()] * MAX_IMPORT_RULE_CONDITIONS})
    UpdateImportRuleRequest.model_validate({"name": f" {'n' * MAX_IMPORT_RULE_NAME_LENGTH} "})

    with pytest.raises(ValidationError):
        UpdateImportRuleRequest.model_validate({"conditions": []})
    with pytest.raises(ValidationError):
        UpdateImportRuleRequest.model_validate({"conditions": [_text()] * (MAX_IMPORT_RULE_CONDITIONS + 1)})
    with pytest.raises(ValidationError, match="at most 100 conditions in all"):
        UpdateImportRuleRequest.model_validate({"conditions": [_group(*[_text()] * MAX_IMPORT_RULE_CONDITIONS), _text()]})
    with pytest.raises(ValidationError):
        UpdateImportRuleRequest.model_validate({"tag_ids": [*tags, str(uuid.uuid4())]})
    with pytest.raises(ValidationError, match="must not repeat a tag"):
        UpdateImportRuleRequest.model_validate({"tag_ids": [tags[0], tags[0]]})
    for name in ("   ", "n" * (MAX_IMPORT_RULE_NAME_LENGTH + 1)):
        with pytest.raises(ValidationError):
            UpdateImportRuleRequest.model_validate({"name": name})
    assert UpdateImportRuleRequest.model_validate({"name": " Trimmed "}).name == "Trimmed"


def test_an_update_may_clear_a_merchant_but_not_null_a_field_a_rule_cannot_be_without():
    """A null merchant or category is a choice to clear it, while a null name or conditions is refused rather than ignored"""
    cleared = UpdateImportRuleRequest.model_validate({"merchant_id": None, "category_id": None})

    assert cleared.model_fields_set == {"merchant_id", "category_id"}
    for field in ("name", "match", "conditions", "tag_ids"):
        with pytest.raises(ValidationError, match="must not be null"):
            UpdateImportRuleRequest.model_validate({field: None})
