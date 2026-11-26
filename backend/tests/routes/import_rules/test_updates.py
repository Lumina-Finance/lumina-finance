"""PATCH /import-rules/{rule_id}"""

import uuid

from tests.routes.support import (
    _account_is,
    _create_account,
    _create_rule_ok,
    _create_second_user,
    _create_user,
    _description_contains,
    _direction_is,
    _field_errors,
    _get_auth_header,
    _make_category,
    _make_merchant,
    _make_tag,
)

NO_ACTION = "Choose a merchant, a category or at least one tag"


async def _signed_in(client) -> dict:
    """Sign the default user up and return their auth headers"""
    return _get_auth_header(await _create_user(client))


async def _edit(client, headers, rule_id: str, **fields):
    """Send a PATCH carrying only the fields given"""
    return await client.patch(f"/import-rules/{rule_id}", json=fields, headers=headers)


async def test_a_change_to_the_name_alone_leaves_everything_else_as_it_was(client):
    """Only what the request carries changes, so the position, match, conditions and actions stay"""
    headers = await _signed_in(client)
    merchant_id = await _make_merchant(client, headers)
    tag_id = await _make_tag(client, headers)
    await _create_rule_ok(client, headers, name="First", tag_ids=[tag_id])
    rule = await _create_rule_ok(
        client, headers, name="Second", match="any", conditions=[_direction_is("in")], merchant_id=merchant_id, tag_ids=[tag_id]
    )

    response = await _edit(client, headers, rule["id"], name="Renamed")

    assert response.status_code == 200, response.text
    assert response.json() == {**rule, "name": "Renamed", "updated_at": response.json()["updated_at"]}


async def test_conditions_and_tags_sent_replace_the_ones_the_rule_had(client):
    """A list sent is the whole new list, so a tag left out is removed and a new one is added"""
    headers = await _signed_in(client)
    kept, dropped, added = [await _make_tag(client, headers, name) for name in ("Kept", "Dropped", "Added")]
    rule = await _create_rule_ok(client, headers, tag_ids=[kept, dropped])

    response = await _edit(
        client,
        headers,
        rule["id"],
        match="any",
        conditions=[_description_contains("cafe"), _direction_is("out")],
        tag_ids=[kept, added],
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["match"] == "any"
    assert [condition["attribute"] for condition in body["conditions"]] == ["description", "direction"]
    assert [tag["name"] for tag in body["tags"]] == ["Added", "Kept"]
    assert (await client.get("/import-rules", headers=headers)).json() == [body]


async def test_a_null_merchant_or_category_clears_it_and_one_left_out_is_kept(client):
    """Null is a choice to clear, while a field not sent is not touched"""
    headers = await _signed_in(client)
    merchant_id = await _make_merchant(client, headers)
    category_id = await _make_category(client, headers)
    rule = await _create_rule_ok(client, headers, merchant_id=merchant_id, category_id=category_id)

    response = await _edit(client, headers, rule["id"], merchant_id=None)

    assert response.status_code == 200, response.text
    assert (response.json()["merchant"], response.json()["category"]["id"]) == (None, category_id)


async def test_a_change_that_would_leave_the_rule_setting_nothing_is_refused_on_its_actions(client):
    """The last merchant, category or tag can't be taken away, whichever way it goes"""
    headers = await _signed_in(client)
    merchant_id = await _make_merchant(client, headers)
    tag_id = await _make_tag(client, headers)
    only_merchant = await _create_rule_ok(client, headers, name="Merchant only", merchant_id=merchant_id)
    only_tag = await _create_rule_ok(client, headers, name="Tag only", tag_ids=[tag_id])

    cleared_merchant = await _edit(client, headers, only_merchant["id"], merchant_id=None)
    cleared_tags = await _edit(client, headers, only_tag["id"], tag_ids=[])
    swapped = await _edit(client, headers, only_tag["id"], tag_ids=[], merchant_id=merchant_id)

    assert _field_errors(cleared_merchant) == [(("actions",), NO_ACTION)]
    assert _field_errors(cleared_tags) == [(("actions",), NO_ACTION)]
    assert swapped.status_code == 200, "a rule may swap one action for another in one change"
    swapped_rule = swapped.json()
    assert (swapped_rule["merchant"]["id"], swapped_rule["tags"]) == (merchant_id, [])


async def test_what_a_change_names_is_checked_as_it_is_on_creation(client):
    """An account, merchant, category or tag that isn't the user's own is refused on its field"""
    headers = await _signed_in(client)
    tag_id = await _make_tag(client, headers)
    rule = await _create_rule_ok(client, headers, tag_ids=[tag_id])
    other_headers = _get_auth_header(await _create_second_user(client))
    theirs = {
        "merchant_id": await _make_merchant(client, other_headers, "Their shop"),
        "tag_ids": [await _make_tag(client, other_headers, "Their tag")],
        "conditions": [_account_is((await _create_account(client, other_headers, name="Theirs")).json()["id"])],
    }

    response = await _edit(client, headers, rule["id"], **theirs)

    assert sorted(_field_errors(response)) == [
        (("conditions", 0, "condition", "account", "value"), "Account not found"),
        (("merchant_id",), "Merchant not found"),
        (("tag_ids", 0), "Tag not found"),
    ]


async def test_a_name_another_rule_has_is_refused_and_one_that_differs_only_in_capitals_is_the_rules_own(client):
    """A rule may change the capitals of its own name, and never take another rule's"""
    headers = await _signed_in(client)
    tag_id = await _make_tag(client, headers)
    await _create_rule_ok(client, headers, name="Market", tag_ids=[tag_id])
    other = await _create_rule_ok(client, headers, name="Pharmacy", tag_ids=[tag_id])

    clash = await _edit(client, headers, other["id"], name="MARKET")
    recapitalised = await _edit(client, headers, other["id"], name="PHARMACY")

    assert (clash.status_code, clash.json()["detail"]) == (409, "An import rule with this name already exists")
    assert recapitalised.status_code == 200, recapitalised.text
    assert recapitalised.json()["name"] == "PHARMACY"


async def test_a_rule_that_names_a_deleted_account_can_still_be_renamed_but_not_saved_with_that_account_again(client):
    """Only what is sent is checked, so the rest of the rule is not held up by an account that is gone"""
    headers = await _signed_in(client)
    account_id = (await _create_account(client, headers, name="Gone")).json()["id"]
    tag_id = await _make_tag(client, headers)
    rule = await _create_rule_ok(client, headers, conditions=[_account_is(account_id)], tag_ids=[tag_id])
    assert (await client.delete(f"/accounts/{account_id}", headers=headers)).status_code == 204

    renamed = await _edit(client, headers, rule["id"], name="Renamed")
    resent = await _edit(client, headers, rule["id"], conditions=[_account_is(account_id)])

    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["conditions"][0]["account_state"] == "deleted"
    assert _field_errors(resent) == [(("conditions", 0, "condition", "account", "value"), "Account not found")]


async def test_another_users_rule_and_one_that_does_not_exist_are_not_found(client):
    """The answer is the same for both, so a rule's existence isn't revealed"""
    headers = await _signed_in(client)
    other_headers = _get_auth_header(await _create_second_user(client))
    theirs = await _create_rule_ok(client, other_headers, name="Theirs", tag_ids=[await _make_tag(client, other_headers)])

    for rule_id in (theirs["id"], str(uuid.uuid4())):
        response = await _edit(client, headers, rule_id, name="Mine now")

        assert (response.status_code, response.json()["detail"]) == (404, "Import rule not found")
    assert (await client.get("/import-rules", headers=other_headers)).json()[0]["name"] == "Theirs"


async def test_editing_a_rule_without_auth_returns_401(client):
    """Rules are a signed-in user's"""
    response = await client.patch(f"/import-rules/{uuid.uuid4()}", json={"name": "x"})

    assert response.status_code == 401
