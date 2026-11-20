"""Institution website and logo address contract tests, since every user's accounts page loads both"""

import pytest
from pydantic import ValidationError

from app.schemas.institution import CreateInstitutionRequest, UpdateInstitutionRequest

CREATE_FIELDS = {"name": "TD", "country_code": "CA", "website": "https://www.td.com"}
ADDRESS_FIELDS = ["website", "logo_url"]
MAX_ADDRESS = "https://example.com/" + "a" * (2048 - len("https://example.com/"))


@pytest.mark.parametrize("field", ADDRESS_FIELDS)
@pytest.mark.parametrize("address", ["https://www.td.com", "HTTPS://WWW.TD.COM", MAX_ADDRESS])
@pytest.mark.parametrize("model", [CreateInstitutionRequest, UpdateInstitutionRequest])
def test_address_field_accepts_an_https_address_up_to_2048_characters(model, field, address):
    """An https address is kept as sent, whatever its capitals, up to its last allowed character"""
    fields = CREATE_FIELDS if model is CreateInstitutionRequest else {}

    assert getattr(model(**{**fields, field: address}), field) == address


@pytest.mark.parametrize("field", ADDRESS_FIELDS)
@pytest.mark.parametrize(
    "address", ["http://www.td.com", "javascript:alert(1)", "//www.td.com", "www.td.com", "data:image/gif;base64,R0lGODlh"]
)
@pytest.mark.parametrize("model", [CreateInstitutionRequest, UpdateInstitutionRequest])
def test_address_field_refuses_an_address_that_does_not_start_with_https(model, field, address):
    """A page address, a script or an inline image is refused, with the reason on the address field"""
    fields = CREATE_FIELDS if model is CreateInstitutionRequest else {}

    with pytest.raises(ValidationError) as refusal:
        model(**{**fields, field: address})

    [error] = refusal.value.errors()
    assert error["loc"] == (field,)
    assert error["msg"] == "Value error, Address must start with https://"


@pytest.mark.parametrize("field", ADDRESS_FIELDS)
@pytest.mark.parametrize("model", [CreateInstitutionRequest, UpdateInstitutionRequest])
def test_address_field_refuses_an_address_one_character_past_the_limit(model, field):
    """An address of 2,049 characters is refused for its length, even though it starts with https://"""
    fields = CREATE_FIELDS if model is CreateInstitutionRequest else {}

    with pytest.raises(ValidationError) as refusal:
        model(**{**fields, field: MAX_ADDRESS + "a"})

    [error] = refusal.value.errors()
    assert error["loc"] == (field,)
    assert error["type"] == "string_too_long"
    assert error["ctx"] == {"max_length": 2048}


def test_logo_address_may_be_cleared_with_an_explicit_null():
    """Clearing a logo stays a correction anyone can make"""
    assert UpdateInstitutionRequest(logo_url=None).model_fields_set == {"logo_url"}
