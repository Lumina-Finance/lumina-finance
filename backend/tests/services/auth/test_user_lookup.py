"""A provider's address is spelled as a typed one, so both meet as one account"""

import pytest
from pydantic import EmailStr, TypeAdapter

from app.services.auth.user_lookup import normalize_typed_spelling

_TYPED = TypeAdapter(EmailStr)


@pytest.mark.parametrize(
    "email",
    ["sso@MÜNCHEN.de", "Sso@EXAMPLE.COM", "sso@example.com", "first.last@Sub.Example.Org", "Émile@Example.com"],
)
def test_matches_the_spelling_a_typed_address_is_stored_in(email):
    """The two spellings differing would give one address two accounts"""
    assert normalize_typed_spelling(email) == _TYPED.validate_python(email)


@pytest.mark.parametrize(
    ("email", "expected"),
    [
        (" sso@EXAMPLE.com\t", "sso@example.com"),
        ("A@CORP.LOCAL", "A@corp.local"),
        ("admin@LOCALHOST", "admin@localhost"),
        ("first_last@MY_CO.com", "first_last@my_co.com"),
        ("no-at-sign", "no-at-sign"),
    ],
)
def test_trims_and_lowers_the_domain_without_refusing_internal_ones(email, expected):
    """EmailStr refuses these domains, but a provider's address must never be refused for them"""
    assert normalize_typed_spelling(email) == expected
