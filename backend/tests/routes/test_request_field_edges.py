"""Each limit holds at its last allowed value and gives way one past it, by the figure and not by the constant"""

import uuid

import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas.auth import LoginRequest, SignupRequest
from app.schemas.import_run import ImportSourceName
from app.schemas.limits import (
    MAX_FX_RATE,
    Counter,
    EnteredAmount,
    NonNegativeMinorUnits,
    PositiveMinorUnits,
    SignedMinorUnits,
    Token,
)
from app.schemas.tax_advantaged_category import CreateTaxAdvantagedCategoryRequest
from app.services.fx.rate_parser_helpers import MAX_PLAUSIBLE_RATE
from tests.routes.support import _create_user, _get_auth_header

_EMAIL = "someone@example.com"


def _long_email(length):
    """Build a well-formed address of exactly this many characters"""
    domain = "b" * 63 + "." + "c" * 63 + "." + "d" * (length - 64 - 1 - 63 - 1 - 63 - 1 - 4) + ".com"
    return "a" * 64 + "@" + domain


def _error_types(model, payload):
    """Return the type of each error the model refuses the payload with, or an empty list when it accepts"""
    try:
        model(**payload)
    except ValidationError as error:
        return [item["type"] for item in error.errors()]
    return []


def _signup(**overrides):
    return {"email": _EMAIL, "first_name": "Ada", "last_name": "L", "tz": "America/Toronto", "base_currency": "CAD", **overrides}


@pytest.mark.parametrize(
    ("length", "refused"),
    [(128, False), (129, True)],
)
def test_a_sign_in_password_is_held_to_128_characters(length, refused):
    """The longest password a new account may choose is also the longest a sign-in will hash"""
    types = _error_types(LoginRequest, {"email": _EMAIL, "password": "p" * length})

    assert types == (["string_too_long"] if refused else [])


@pytest.mark.parametrize(
    ("field", "length", "refused"),
    [("first_name", 256, False), ("first_name", 257, True), ("last_name", 256, False), ("last_name", 257, True)],
)
def test_a_sign_up_name_is_held_to_256_characters(field, length, refused):
    """Both names stop at the width of their columns"""
    types = _error_types(SignupRequest, _signup(**{field: "n" * length}))

    assert types == (["string_too_long"] if refused else [])


@pytest.mark.parametrize(("length", "refused"), [(254, False), (255, True)])
def test_a_sign_up_email_is_held_to_254_characters(length, refused):
    """An address longer than the users table's column is refused on its field"""
    address = _long_email(length)
    assert len(address) == length

    types = _error_types(SignupRequest, _signup(email=address))

    # The address check refuses an over-long address on its own, ahead of the field's length
    assert bool(types) == refused


def test_a_sign_up_timezone_past_40_characters_is_refused_on_its_length():
    """A 40-character name is checked as a zone, and a 41-character one never gets that far"""
    assert _error_types(SignupRequest, _signup(tz="z" * 40)) == ["value_error"]
    assert _error_types(SignupRequest, _signup(tz="z" * 41)) == ["string_too_long"]


@pytest.mark.parametrize(("code", "refused"), [("CAD", False), ("CADX", True)])
def test_a_sign_up_base_currency_is_three_characters_at_most(code, refused):
    """A currency code is cut at its length before the database sees it"""
    types = _error_types(SignupRequest, _signup(base_currency=code))

    assert types == (["string_too_long"] if refused else [])


@pytest.mark.parametrize(
    ("adapter", "accepted", "refused"),
    [
        (TypeAdapter(NonNegativeMinorUnits), 9_223_372_036_854_775_807, 9_223_372_036_854_775_808),
        (TypeAdapter(NonNegativeMinorUnits), 0, -1),
        (TypeAdapter(PositiveMinorUnits), 9_223_372_036_854_775_807, 0),
        (TypeAdapter(SignedMinorUnits), 9_223_372_036_854_775_807, 9_223_372_036_854_775_808),
        (TypeAdapter(SignedMinorUnits), -9_223_372_036_854_775_808, -9_223_372_036_854_775_809),
        (TypeAdapter(EnteredAmount), 10**30, 10**30 + 1),
        (TypeAdapter(EnteredAmount), -(10**30), -(10**30) - 1),
        (TypeAdapter(Counter), 2_147_483_647, 2_147_483_648),
        (TypeAdapter(Counter), 0, -1),
        (TypeAdapter(Token), "t" * 4096, "t" * 4097),
        (TypeAdapter(ImportSourceName), "n" * 256, "n" * 257),
    ],
)
def test_each_shared_type_accepts_its_last_value_and_refuses_the_next(adapter, accepted, refused):
    """The ends of each range are named by figure, so moving a limit by one fails here"""
    adapter.validate_python(accepted)

    with pytest.raises(ValidationError):
        adapter.validate_python(refused)


def test_a_tax_advantaged_treatment_is_held_to_32_characters():
    """An enum's text field stops where the longest value of any enum ends, with margin"""
    base = {"name": "Savings", "currency": "CAD"}

    assert _error_types(CreateTaxAdvantagedCategoryRequest, {**base, "tax_treatment": "t" * 32}) == []
    assert _error_types(CreateTaxAdvantagedCategoryRequest, {**base, "tax_treatment": "t" * 33}) == ["string_too_long"]


def test_the_exchange_rate_ceiling_is_the_largest_rate_a_provider_series_is_accepted_at():
    """The request and the provider's own series accept the same rates, so neither moves alone"""
    assert float(MAX_PLAUSIBLE_RATE) == MAX_FX_RATE == 1_000_000_000.0


@pytest.mark.parametrize(("year", "status"), [(1899, 422), (1900, 404), (2100, 404), (2101, 422)])
async def test_a_tax_year_in_a_path_is_held_to_1900_through_2100(client, year, status):
    """A year inside the range reaches the lookup, which finds no category, and one outside is refused"""
    headers = _get_auth_header(await _create_user(client))

    resp = await client.patch(f"/tax-advantaged-categories/{uuid.uuid4()}/limits/{year}", json={}, headers=headers)

    assert resp.status_code == status


@pytest.mark.parametrize(("slug", "status"), [("a" * 50, 404), ("a" * 51, 422)])
async def test_an_oidc_provider_slug_is_held_to_50_characters(client, slug, status):
    """A slug as wide as its column finds no provider, and a wider one is refused as malformed"""
    resp = await client.post(f"/auth/oidc/{slug}/authorize", json={})

    assert resp.status_code == status


@pytest.mark.parametrize(("code", "status"), [("CA", 422), ("XXX", 404), ("CADX", 422)])
async def test_a_currency_code_in_a_path_is_exactly_three_characters(client, code, status):
    """A code of any other length is refused before the lookup"""
    resp = await client.get(f"/currencies/{code}")

    assert resp.status_code == status


async def test_a_password_past_the_limit_is_refused_without_being_repeated(client):
    """The refusal names the field and never hands back what was sent, since it may be a real password"""
    password = "secret-" + "s" * 130

    resp = await client.post("/auth/login", json={"email": _EMAIL, "password": password})

    assert resp.status_code == 422
    assert resp.json()["detail"][0]["loc"] == ["body", "password"]
    assert password not in resp.text
