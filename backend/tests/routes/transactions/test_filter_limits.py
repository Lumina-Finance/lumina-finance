"""Limits on the query values of the transaction list, its export and the refund-link candidates"""

import pytest

from app.main import app
from app.utils.pagination import MAX_LIST_OFFSET
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import _create_transaction, _setup_user_with_deps

# The largest amount the ledger stores, and the largest number the database takes
LARGEST_AMOUNT = 2**63 - 1

# A transaction that does not exist, since a refused value is answered before it is looked up
LINK_PATH = "/transactions/11111111-1111-4111-8111-111111111111/refund-link-candidates"
EXPORT_PATH = "/transactions/export"
FILTER_PATHS = ["/transactions", EXPORT_PATH, LINK_PATH]


@pytest.fixture
async def headers(client) -> dict[str, str]:
    """Return the auth header of a signed-up user"""
    return _get_auth_header(await _create_user(client))


async def _refusals(client, headers, path, params):
    """Get a path that is refused and return the one error it names, with the status checked"""
    response = await client.get(path, params=params, headers=headers)

    assert response.status_code == 422
    [error] = response.json()["detail"]
    return error


@pytest.mark.parametrize(
    ("path", "field"),
    [
        ("/transactions", "min_amount"),
        ("/transactions", "max_amount"),
        (EXPORT_PATH, "max_amount"),
        (LINK_PATH, "max_amount"),
    ],
)
async def test_an_amount_past_the_largest_the_ledger_stores_is_refused_on_its_field(client, headers, path, field):
    """One more than the largest amount is a 422 naming the field, where the database used to refuse it with a server error"""
    error = await _refusals(client, headers, path, {field: LARGEST_AMOUNT + 1, "amount_currency": "CAD"})

    assert error["loc"] == ["query", field]
    assert error["type"] == "less_than_equal"


async def test_the_largest_amount_the_ledger_stores_matches_no_transaction_in_the_list(client):
    """The largest amount as a minimum is a valid filter, and a stored amount below it is left out"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _create_transaction(client, headers, account_id, category_id, amount=-5000)

    response = await client.get("/transactions", params={"min_amount": LARGEST_AMOUNT, "amount_currency": "CAD"}, headers=headers)

    assert response.status_code == 200
    assert response.json() == []


async def test_the_largest_amount_the_ledger_stores_is_taken_by_the_export(client, headers):
    """The export takes the largest amount as a bound too, where a number past it is refused"""
    response = await client.get(EXPORT_PATH, params={"max_amount": LARGEST_AMOUNT, "amount_currency": "CAD"}, headers=headers)

    assert response.status_code == 200


async def test_the_list_offset_takes_the_largest_the_other_lists_take(client, headers):
    """An offset at the figure the merchants and tags lists stop at is answered"""
    response = await client.get("/transactions", params={"offset": MAX_LIST_OFFSET}, headers=headers)

    assert response.status_code == 200


@pytest.mark.parametrize(
    ("offset", "error_type"),
    [(-1, "greater_than_equal"), (MAX_LIST_OFFSET + 1, "less_than_equal"), (LARGEST_AMOUNT + 1, "less_than_equal")],
)
async def test_the_list_offset_is_refused_on_its_field_outside_zero_to_the_limit(client, headers, offset, error_type):
    """An offset below zero or past the limit is refused, and so is one past the database's limit, which was a server error"""
    error = await _refusals(client, headers, "/transactions", {"offset": offset})

    assert error["loc"] == ["query", "offset"]
    assert error["type"] == error_type


@pytest.mark.parametrize(
    ("path", "code"),
    [
        ("/transactions", "C" * 5000),
        ("/transactions", "Q"),
        (EXPORT_PATH, "C" * 5000),
        (LINK_PATH, "C" * 5000),
    ],
)
async def test_a_currency_that_is_not_three_characters_is_refused_on_its_field(client, headers, path, code):
    """Each currency value is a three-letter code, so a very long one or a short one is refused, the long one without being repeated"""
    error = await _refusals(client, headers, path, {"currency": code})

    assert error["loc"] == ["query", "currency", 0]
    assert error["type"] == ("string_too_long" if len(code) > 3 else "string_too_short")
    if len(code) > 3:
        assert code not in str(error)


async def test_a_lowercase_currency_is_taken_and_matches_like_the_code_it_spells(client):
    """The currency filter bounds the length and not the letters, so a code typed in lowercase is answered as before"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _create_transaction(client, headers, account_id, category_id, amount=-5000)

    response = await client.get("/transactions", params={"currency": "cad"}, headers=headers)

    assert response.status_code == 200


async def test_the_currency_filter_takes_twenty_codes(client, headers):
    """A handful of currencies is taken, and twenty is the most"""
    response = await client.get("/transactions", params={"currency": _codes(20)}, headers=headers)

    assert response.status_code == 200


async def test_the_currency_filter_refuses_more_than_twenty_codes_instead_of_sending_them_to_the_database(client, headers):
    """A list past twenty is refused on its field instead of becoming a list of database placeholders"""
    error = await _refusals(client, headers, "/transactions", {"currency": _codes(21)})

    assert error["loc"] == ["query", "currency"]
    assert error["type"] == "too_long"


def _codes(count: int) -> list[str]:
    """Return that many distinct three-letter codes"""
    return [f"X{chr(65 + index // 26)}{chr(65 + index % 26)}" for index in range(count)]


@pytest.mark.parametrize("path", FILTER_PATHS)
async def test_a_tag_match_mode_other_than_all_or_any_is_refused_on_its_field(client, headers, path):
    """Every route that takes a tag match refuses an unknown mode, even with no tag selected, where it once matched as any"""
    error = await _refusals(client, headers, path, {"tag_match": "some"})

    assert error["loc"] == ["query", "tag_match"]
    assert error["type"] == "literal_error"


@pytest.mark.parametrize(("field", "value"), [("sort_by", "invalid"), ("sort_order", "sideways")])
async def test_a_sort_field_or_order_the_list_does_not_have_is_refused_on_its_field(client, headers, field, value):
    """The list says which fields and directions it sorts by, and refuses any other"""
    error = await _refusals(client, headers, "/transactions", {field: value})

    assert error["loc"] == ["query", field]
    assert error["type"] == "literal_error"


@pytest.mark.parametrize(
    ("field", "allowed"),
    [
        ("sort_by", ["dt", "amount", "created_at", "updated_at"]),
        ("sort_order", ["asc", "desc"]),
        ("tag_match", ["all", "any"]),
    ],
)
def test_the_api_description_states_the_values_a_sort_or_tag_match_takes(field, allowed):
    """The list's description names every value of the three, so a client does not have to guess them"""
    parameters = app.openapi()["paths"]["/transactions"]["get"]["parameters"]
    [parameter] = [parameter for parameter in parameters if parameter["name"] == field]

    assert parameter["schema"]["enum"] == allowed
