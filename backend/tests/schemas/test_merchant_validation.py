"""Merchant update API schema contract tests"""

from app.schemas.merchant import UpdateMerchantRequest


def test_merchant_update_schema_allows_omission_but_not_null_names():
    """Advertise an optional non-null name while allowing the default category to be cleared"""
    schema = UpdateMerchantRequest.model_json_schema(mode="validation")
    name = schema["properties"]["name"]

    assert "name" not in schema.get("required", [])
    assert name["type"] == "string"
    assert name["minLength"] == 1
    assert name["maxLength"] == 256
    assert {"type": "null"} in schema["properties"]["default_category_id"]["anyOf"]
