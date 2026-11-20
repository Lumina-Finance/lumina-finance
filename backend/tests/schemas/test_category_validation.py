"""Category request contract tests, since a name or icon is stored once and returned on every category list"""

import pytest
from pydantic import ValidationError

from app.schemas.category import CreateCategoryRequest, UpdateCategoryRequest
from app.schemas.import_run import TransactionImportCreateCategory

# Each request that can carry a category name and icon, with the other fields it needs
CATEGORY_MODELS = [
    pytest.param(CreateCategoryRequest, {"kind": "expense"}, id="create"),
    pytest.param(UpdateCategoryRequest, {}, id="update"),
    pytest.param(TransactionImportCreateCategory, {"kind": "expense"}, id="import-mapping"),
]
FAMILY_EMOJI = "👨‍👩‍👧‍👦"


def test_category_update_schema_allows_omission_but_not_null_names():
    """Advertise optional non-null names with the existing length constraints"""
    schema = UpdateCategoryRequest.model_json_schema(mode="validation")
    name = schema["properties"]["name"]

    assert "name" not in schema.get("required", [])
    assert name["type"] == "string"
    assert name["minLength"] == 1
    assert name["maxLength"] == 256
    assert {"type": "null"} in schema["properties"]["icon"]["anyOf"]


@pytest.mark.parametrize(("model", "fields"), CATEGORY_MODELS)
@pytest.mark.parametrize("icon", ["🛒", FAMILY_EMOJI, "x" * 32])
def test_category_icon_accepts_an_emoji_sequence_up_to_32_characters(model, fields, icon):
    """A single emoji, a joined family emoji and an icon of exactly 32 characters are kept as sent"""
    assert model(**fields, name="Groceries", icon=icon).icon == icon


@pytest.mark.parametrize(("model", "fields"), CATEGORY_MODELS)
@pytest.mark.parametrize("icon", ["x" * 33, "x" * 40])
def test_category_icon_refuses_more_than_32_characters_with_the_reason_on_the_field(model, fields, icon):
    """An icon past the limit is refused, and the error's location is the icon field"""
    with pytest.raises(ValidationError) as refusal:
        model(**fields, name="Groceries", icon=icon)

    [error] = refusal.value.errors()
    assert error["loc"] == ("icon",)
    assert error["type"] == "string_too_long"
    assert error["ctx"] == {"max_length": 32}


@pytest.mark.parametrize(("model", "fields"), CATEGORY_MODELS)
def test_category_name_takes_256_characters_and_refuses_257(model, fields):
    """The longest allowed name is kept, and one character more is refused on the name field"""
    assert model(**fields, name="n" * 256).name == "n" * 256

    with pytest.raises(ValidationError) as refusal:
        model(**fields, name="n" * 257)

    [error] = refusal.value.errors()
    assert error["loc"] == ("name",)
    assert error["type"] in {"string_too_long", "too_long"}


def test_category_name_is_counted_after_its_surrounding_spaces_are_trimmed():
    """A name of 256 characters with spaces around it is kept, since the stored name is the trimmed one"""
    assert CreateCategoryRequest(name=f"  {'n' * 256}  ", kind="expense").name == "n" * 256
