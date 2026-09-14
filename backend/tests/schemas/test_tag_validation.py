"""Tag update API schema contract tests"""

from app.schemas.tag import UpdateTagRequest


def test_tag_update_schema_allows_omission_but_not_null_names():
    """Advertise optional non-null names with the existing length constraints"""
    schema = UpdateTagRequest.model_json_schema(mode="validation")
    name = schema["properties"]["name"]

    assert "name" not in schema.get("required", [])
    assert name["type"] == "string"
    assert name["minLength"] == 1
    assert name["maxLength"] == 64
