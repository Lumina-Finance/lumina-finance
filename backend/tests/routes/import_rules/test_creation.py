"""POST /import-rules"""

import pytest

from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.support import (
    _account_is,
    _amount_at_least,
    _create_account,
    _create_rule,
    _create_rule_ok,
    _create_second_user,
    _create_user,
    _description_contains,
    _direction_is,
    _field_errors,
    _get_auth_header,
    _get_system_merchant_id,
    _group_of,
    _make_category,
    _make_merchant,
    _make_tag,
    _system_category_id,
)

NO_ACTION = "Choose a merchant, a category or at least one tag"


async def _signed_in(client) -> dict:
    """Sign the default user up and return their auth headers"""
    return _get_auth_header(await _create_user(client))


async def test_a_rule_is_appended_and_returned_with_the_names_its_row_shows(client):
    """Each new rule goes last, and the answer names the merchant, category, tags and account so no screen has to look them up"""
    headers = await _signed_in(client)
    merchant_id = await _make_merchant(client, headers, "Market")
    category_id = await _make_category(client, headers, "Snacks")
    tag_ids = [await _make_tag(client, headers, "Zebra"), await _make_tag(client, headers, "apple")]
    account_id = (await _create_account(client, headers, name="Chequing")).json()["id"]

    first = await _create_rule_ok(client, headers, name="First", merchant_id=merchant_id)
    second = await _create_rule_ok(
        client,
        headers,
        name="Second",
        match="any",
        conditions=[
            _description_contains("market"),
            _amount_at_least("12.50"),
            _group_of("all", _direction_is("out"), _account_is(account_id, "is_not")),
        ],
        merchant_id=merchant_id,
        category_id=category_id,
        tag_ids=tag_ids,
    )

    assert (first["position"], second["position"]) == (0, 1)
    assert first["merchant"] == {"id": merchant_id, "name": "Market"}
    assert (first["category"], first["tags"]) == (None, [])
    assert second["category"] == {"id": category_id, "name": "Snacks"}
    assert [tag["name"] for tag in second["tags"]] == ["apple", "Zebra"], "tags read in name order whatever their capitals"
    assert second["match"] == "any"
    assert second["conditions"] == [
        {"kind": "condition", "attribute": "description", "operator": "contains", "value": "market"},
        {"kind": "condition", "attribute": "amount", "operator": "at_least", "value": 1250, "currency": "CAD"},
        {
            "kind": "group",
            "match": "all",
            "conditions": [
                {"kind": "condition", "attribute": "direction", "operator": "is", "value": "out"},
                {
                    "kind": "condition",
                    "attribute": "account",
                    "operator": "is_not",
                    "value": account_id,
                    "account_state": "exists",
                    "account_name": "Chequing",
                },
            ],
        },
    ]


async def test_an_amount_is_read_at_its_currencys_own_precision(client):
    """Yen has no decimals, so 500 is five hundred of them and 12.5 is refused, while dollars keep two"""
    headers = await _signed_in(client)
    async with TestSession() as session:
        session.add(Currency(id="JPY", name="Japanese Yen", symbol="¥", minor_unit_exponent=0))
        await session.commit()
    tag_id = await _make_tag(client, headers)

    accepted = await _create_rule_ok(client, headers, conditions=[_amount_at_least("500", "JPY")], tag_ids=[tag_id])
    refused = await _create_rule(client, headers, name="Cents of a yen", conditions=[_amount_at_least("12.5", "JPY")], tag_ids=[tag_id])

    assert accepted["conditions"][0]["value"] == 500
    assert _field_errors(refused) == [(("conditions", 0, "condition", "amount", "value"), "Amount has too many decimal places for JPY")]


@pytest.mark.parametrize(
    ("amount", "currency", "field", "message"),
    [
        ("12.345", "CAD", "value", "Amount has too many decimal places for CAD"),
        ("0", "CAD", "value", "Amount must be greater than zero"),
        ("-5", "CAD", "value", "Amount must be greater than zero"),
        ("12,50", "CAD", "value", "Amount must be a number the app can store"),
        ("99999999999999999999", "CAD", "value", "Amount must be a number the app can store"),
        ("5", "XXX", "currency", "Currency not found"),
    ],
)
async def test_an_amount_that_cannot_be_used_is_refused_on_its_own_field(client, amount, currency, field, message):
    """An amount is never rounded, signed or guessed at, and the refusal names the field and says why"""
    headers = await _signed_in(client)
    tag_id = await _make_tag(client, headers)

    response = await _create_rule(client, headers, conditions=[_amount_at_least(amount, currency)], tag_ids=[tag_id])

    assert _field_errors(response) == [(("conditions", 0, "condition", "amount", field), message)]


async def test_a_refusal_names_the_same_path_the_schemas_own_refusals_do(client):
    """The screen finds a field from its path, so a refusal the service raises must read like one the schema raises, inside a group too"""
    headers = await _signed_in(client)
    tag_id = await _make_tag(client, headers)
    inside_a_group = ("conditions", 1, "group", "conditions", 0, "amount", "currency")

    by_the_schema = await _create_rule(
        client, headers, conditions=[_description_contains("a"), _group_of("all", _amount_at_least("5", "cad"))], tag_ids=[tag_id]
    )
    by_the_service = await _create_rule(
        client, headers, conditions=[_description_contains("a"), _group_of("all", _amount_at_least("5", "XXX"))], tag_ids=[tag_id]
    )

    assert [location for location, _ in _field_errors(by_the_schema)] == [inside_a_group]
    assert [location for location, _ in _field_errors(by_the_service)] == [inside_a_group]


async def test_a_rule_that_sets_nothing_is_refused_on_its_actions(client):
    """A rule needs a merchant, a category or a tag to do anything"""
    headers = await _signed_in(client)

    response = await _create_rule(client, headers)

    assert _field_errors(response) == [(("actions",), NO_ACTION)]


async def test_a_transfer_category_is_refused_on_the_category(client):
    """A transfer needs the account at its other end, which a rule can't give it"""
    headers = await _signed_in(client)

    for name in ("Transfer", "Balance Adjustment"):
        category_id = await _system_category_id(client, headers, name)
        response = await _create_rule(client, headers, category_id=category_id)

        assert _field_errors(response) == [(("category_id",), "Choose a category that isn't a transfer")]


async def test_what_a_rule_names_must_be_the_users_own_and_never_another_users_or_a_groups(client):
    """Each merchant, category, tag and account that isn't the user's own is refused on its field, group ones included"""
    headers = await _signed_in(client)
    group_id = (await client.post("/groups", json={"name": "Smith Family"}, headers=headers)).json()["id"]
    group = {
        "merchant": await _make_merchant(client, headers, "Group shop", group_id=group_id),
        "category": await _make_category(client, headers, "Group category", group_id=group_id),
        "tag": await _make_tag(client, headers, "Group tag", group_id=group_id),
        "account": (await _create_account(client, headers, name="Joint", group_id=group_id)).json()["id"],
    }
    other_headers = _get_auth_header(await _create_second_user(client))
    other = {
        "merchant": await _make_merchant(client, other_headers, "Their shop"),
        "category": await _make_category(client, other_headers, "Their category"),
        "tag": await _make_tag(client, other_headers, "Their tag"),
        "account": (await _create_account(client, other_headers, name="Theirs")).json()["id"],
    }

    for owner, ids in (("group", group), ("other user", other)):
        response = await _create_rule(
            client,
            headers,
            name=f"Names {owner}'s",
            conditions=[_account_is(ids["account"])],
            merchant_id=ids["merchant"],
            category_id=ids["category"],
            tag_ids=[ids["tag"]],
        )

        assert sorted(_field_errors(response)) == [
            (("category_id",), "Category not found"),
            (("conditions", 0, "condition", "account", "value"), "Account not found"),
            (("merchant_id",), "Merchant not found"),
            (("tag_ids", 0), "Tag not found"),
        ], owner


async def test_a_merchant_and_category_that_ship_with_the_app_are_accepted(client):
    """Every user sees the built-in merchants and categories, so a rule may set them"""
    headers = await _signed_in(client)
    merchant_id = await _get_system_merchant_id(client, headers)
    category_id = await _system_category_id(client, headers, "Groceries")

    rule = await _create_rule_ok(client, headers, merchant_id=merchant_id, category_id=category_id)

    assert (rule["merchant"]["id"], rule["category"]["name"]) == (merchant_id, "Groceries")


async def test_a_name_in_use_is_refused_whatever_its_capitals_and_another_user_may_use_it(client):
    """Names are unique per user, ignoring capitals, as merchants and tags are"""
    headers = await _signed_in(client)
    tag_id = await _make_tag(client, headers)
    await _create_rule_ok(client, headers, name="Market", tag_ids=[tag_id])

    refused = await _create_rule(client, headers, name="MARKET", tag_ids=[tag_id])
    other_headers = _get_auth_header(await _create_second_user(client))
    other_tag_id = await _make_tag(client, other_headers)
    allowed = await _create_rule(client, other_headers, name="Market", tag_ids=[other_tag_id])

    assert (refused.status_code, refused.json()["detail"]) == (409, "An import rule with this name already exists")
    assert allowed.status_code == 201


async def test_creating_a_rule_without_auth_returns_401(client):
    """Rules are a signed-in user's"""
    response = await client.post("/import-rules", json={})

    assert response.status_code == 401
