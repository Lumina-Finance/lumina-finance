"""Category update API schema contract tests"""

from app.schemas.category import UpdateCategoryRequest


def test_category_update_schema_allows_omission_but_not_null_names():
    """Advertise optional non-null names with the existing length constraints"""
    schema = UpdateCategoryRequest.model_json_schema(mode="validation")
    name = schema["properties"]["name"]

    assert "name" not in schema.get("required", [])
    assert name["type"] == "string"
    assert name["minLength"] == 1
    assert "maxLength" not in name
    assert {"type": "null"} in schema["properties"]["icon"]["anyOf"]
