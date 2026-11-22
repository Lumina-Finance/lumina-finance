"""The conditions all of one person's import rules hold together, and the budget that bounds them"""

from app.schemas.import_rule import MAX_IMPORT_RULE_CONDITIONS
from tests.routes.support import (
    BUDGET_REFUSAL,
    _create_rule,
    _create_rule_ok,
    _create_second_user,
    _create_user,
    _description_contains,
    _field_errors,
    _get_auth_header,
    _group_of,
    _make_tag,
)


def _texts(count: int) -> list[dict]:
    """Return this many conditions on the description"""
    return [_description_contains(f"text {number}") for number in range(count)]


async def _signed_in(client) -> tuple[dict, str]:
    """Sign the default user up and return their auth headers with a tag a rule can set"""
    headers = _get_auth_header(await _create_user(client))
    return headers, await _make_tag(client, headers)


async def _budget(client, headers) -> dict:
    """Read the budget the person's rules hold"""
    response = await client.get("/import-rules/budget", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


async def _fill(client, headers, tag_id: str, *, conditions_in_all: int) -> list[dict]:
    """Create two rules that hold this many conditions together, and return them"""
    first = await _create_rule_ok(client, headers, name="First", conditions=_texts(conditions_in_all - 1), tag_ids=[tag_id])
    second = await _create_rule_ok(client, headers, name="Second", conditions=_texts(1), tag_ids=[tag_id])
    return [first, second]


async def test_the_budget_counts_every_condition_once_and_a_group_nothing_for_itself(client):
    """A condition inside a group costs one, like one outside it, and the answer names the limit the screen shows"""
    headers, tag_id = await _signed_in(client)
    assert await _budget(client, headers) == {"limit": MAX_IMPORT_RULE_CONDITIONS, "used": 0}

    await _create_rule_ok(
        client,
        headers,
        name="Mixed",
        conditions=[_description_contains("a"), _group_of("any", _description_contains("b"), _description_contains("c"))],
        tag_ids=[tag_id],
    )
    await _create_rule_ok(client, headers, name="Plain", conditions=_texts(2), tag_ids=[tag_id])

    assert await _budget(client, headers) == {"limit": MAX_IMPORT_RULE_CONDITIONS, "used": 5}


async def test_rules_may_fill_the_budget_exactly_and_one_more_condition_is_refused_on_the_conditions(client):
    """The last allowed condition passes, the next is a field error the editor shows on the conditions, and nothing is stored"""
    headers, tag_id = await _signed_in(client)
    await _fill(client, headers, tag_id, conditions_in_all=MAX_IMPORT_RULE_CONDITIONS)
    assert (await _budget(client, headers))["used"] == MAX_IMPORT_RULE_CONDITIONS

    refused = await _create_rule(client, headers, name="Third", conditions=_texts(1), tag_ids=[tag_id])

    assert _field_errors(refused) == [(("conditions",), BUDGET_REFUSAL)]
    assert [rule["name"] for rule in (await client.get("/import-rules", headers=headers)).json()] == ["First", "Second"]


async def test_a_group_conditions_count_against_the_budget_when_a_rule_is_created(client):
    """Putting conditions in a group does not slip them past the budget"""
    headers, tag_id = await _signed_in(client)
    await _create_rule_ok(client, headers, name="Most", conditions=_texts(MAX_IMPORT_RULE_CONDITIONS - 2), tag_ids=[tag_id])

    refused = await _create_rule(
        client,
        headers,
        name="Grouped",
        conditions=[_group_of("all", _description_contains("a"), _description_contains("b"), _description_contains("c"))],
        tag_ids=[tag_id],
    )
    accepted = await _create_rule(
        client, headers, name="Fits", conditions=[_group_of("all", _description_contains("a"), _description_contains("b"))], tag_ids=[tag_id]
    )

    assert _field_errors(refused) == [(("conditions",), BUDGET_REFUSAL)]
    assert accepted.status_code == 201, accepted.text


async def test_an_edit_that_grows_a_rule_past_the_budget_is_refused_and_one_that_keeps_or_shrinks_it_passes(client):
    """The rule's own saved conditions are replaced, never counted twice, so a full budget still lets that rule be edited"""
    headers, tag_id = await _signed_in(client)
    first, second = await _fill(client, headers, tag_id, conditions_in_all=MAX_IMPORT_RULE_CONDITIONS)
    first_url = f"/import-rules/{first['id']}"

    grown = await client.patch(first_url, json={"conditions": _texts(MAX_IMPORT_RULE_CONDITIONS)}, headers=headers)
    kept = await client.patch(first_url, json={"conditions": _texts(MAX_IMPORT_RULE_CONDITIONS - 1)}, headers=headers)
    shrunk = await client.patch(first_url, json={"conditions": _texts(3)}, headers=headers)
    renamed = await client.patch(f"/import-rules/{second['id']}", json={"name": "Renamed"}, headers=headers)

    assert _field_errors(grown) == [(("conditions",), BUDGET_REFUSAL)]
    assert (kept.status_code, shrunk.status_code, renamed.status_code) == (200, 200, 200)
    assert (await _budget(client, headers))["used"] == 4
    assert len((await client.get("/import-rules", headers=headers)).json()[0]["conditions"]) == 3


async def test_a_refused_edit_leaves_the_rule_as_it_was(client):
    """Neither the conditions nor the name of a refused edit land"""
    headers, tag_id = await _signed_in(client)
    first, _ = await _fill(client, headers, tag_id, conditions_in_all=MAX_IMPORT_RULE_CONDITIONS)

    refused = await client.patch(
        f"/import-rules/{first['id']}", json={"name": "Changed", "conditions": _texts(MAX_IMPORT_RULE_CONDITIONS)}, headers=headers
    )

    assert refused.status_code == 422
    assert (await client.get("/import-rules", headers=headers)).json()[0] == first


async def test_another_persons_rules_do_not_count_against_the_budget(client):
    """Each person has a budget of their own"""
    headers, tag_id = await _signed_in(client)
    await _fill(client, headers, tag_id, conditions_in_all=MAX_IMPORT_RULE_CONDITIONS)
    other_headers = _get_auth_header(await _create_second_user(client))
    other_tag_id = await _make_tag(client, other_headers)

    created = await _create_rule(client, other_headers, name="Mine", conditions=_texts(MAX_IMPORT_RULE_CONDITIONS), tag_ids=[other_tag_id])

    assert created.status_code == 201, created.text
    assert (await _budget(client, other_headers))["used"] == MAX_IMPORT_RULE_CONDITIONS


async def test_deleting_a_rule_frees_its_conditions(client):
    """A person at the budget can create again once a rule goes"""
    headers, tag_id = await _signed_in(client)
    first, _ = await _fill(client, headers, tag_id, conditions_in_all=MAX_IMPORT_RULE_CONDITIONS)

    assert (await _create_rule(client, headers, name="Third", conditions=_texts(2), tag_ids=[tag_id])).status_code == 422
    assert (await client.delete(f"/import-rules/{first['id']}", headers=headers)).status_code == 204

    assert await _budget(client, headers) == {"limit": MAX_IMPORT_RULE_CONDITIONS, "used": 1}
    assert (await _create_rule(client, headers, name="Third", conditions=_texts(2), tag_ids=[tag_id])).status_code == 201


async def test_the_budget_needs_a_signed_in_person(client):
    """Nobody reads another person's count without signing in"""
    response = await client.get("/import-rules/budget")

    assert response.status_code == 401
