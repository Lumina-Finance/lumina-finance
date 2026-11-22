"""PUT /import-rules/{rule_id}/position"""

import uuid

import pytest

from tests.routes.support import (
    _create_rule_ok,
    _create_second_user,
    _create_user,
    _field_errors,
    _get_auth_header,
    _make_tag,
)


async def _signed_in(client) -> dict:
    """Sign the default user up and return their auth headers"""
    return _get_auth_header(await _create_user(client))


async def _rules_a_to_e(client, headers) -> dict[str, dict]:
    """Create five rules named A to E, at positions 0 to 4, and return them by name"""
    tag_id = await _make_tag(client, headers)
    return {name: await _create_rule_ok(client, headers, name=name, tag_ids=[tag_id]) for name in "ABCDE"}


async def _order(client, headers) -> list[tuple[str, int]]:
    """Return each rule's name and position, in the order the list gives them"""
    return [(rule["name"], rule["position"]) for rule in (await client.get("/import-rules", headers=headers)).json()]


@pytest.mark.parametrize(
    ("moved", "to", "expected"),
    [
        ("A", 4, "BCDEA"),
        ("E", 0, "EABCD"),
        ("B", 3, "ACDBE"),
        ("D", 1, "ADBCE"),
        ("B", 2, "ACBDE"),
        ("C", 1, "ACBDE"),
        ("C", 2, "ABCDE"),
    ],
    ids=["first to last", "last to first", "down the middle", "up the middle", "down by one", "up by one", "same place"],
)
async def test_a_rule_moves_to_its_new_place_and_the_ones_between_shift_by_one(client, moved, to, expected):
    """Positions stay zero to four with no gap or repeat, and the rules the move doesn't pass keep their place"""
    headers = await _signed_in(client)
    rules = await _rules_a_to_e(client, headers)

    response = await client.put(f"/import-rules/{rules[moved]['id']}/position", json={"position": to}, headers=headers)

    assert response.status_code == 200, response.text
    assert (response.json()["name"], response.json()["position"]) == (moved, to)
    assert await _order(client, headers) == [(name, place) for place, name in enumerate(expected)]


async def test_a_move_stamps_no_rule_as_edited(client):
    """Changing places isn't editing, so the rule moved and the ones it passed keep the time they were last edited"""
    headers = await _signed_in(client)
    rules = await _rules_a_to_e(client, headers)
    before = {rule["name"]: rule["updated_at"] for rule in (await client.get("/import-rules", headers=headers)).json()}

    await client.put(f"/import-rules/{rules['A']['id']}/position", json={"position": 2}, headers=headers)

    after = {rule["name"]: rule["updated_at"] for rule in (await client.get("/import-rules", headers=headers)).json()}
    assert {name for name in after if after[name] != before[name]} == set(), "no rule is stamped by a move that changes only places"


async def test_the_last_place_is_accepted_and_the_one_after_it_is_refused_on_the_position(client):
    """The count of rules is the first place that doesn't exist, whatever is asked for"""
    headers = await _signed_in(client)
    rules = await _rules_a_to_e(client, headers)

    accepted = await client.put(f"/import-rules/{rules['A']['id']}/position", json={"position": 4}, headers=headers)
    past_it = await client.put(f"/import-rules/{rules['B']['id']}/position", json={"position": 5}, headers=headers)

    assert accepted.status_code == 200, accepted.text
    assert _field_errors(past_it) == [(("position",), "Position is past the last rule")]
    assert [name for name, _ in await _order(client, headers)] == list("BCDEA")


async def test_another_users_rule_cannot_be_moved_and_their_order_is_untouched(client):
    """The answer is not found, and nothing of theirs shifts"""
    headers = await _signed_in(client)
    other_headers = _get_auth_header(await _create_second_user(client))
    theirs = await _rules_a_to_e(client, other_headers)
    await _create_rule_ok(client, headers, name="Mine", tag_ids=[await _make_tag(client, headers)])

    response = await client.put(f"/import-rules/{theirs['A']['id']}/position", json={"position": 0}, headers=headers)
    missing = await client.put(f"/import-rules/{uuid.uuid4()}/position", json={"position": 0}, headers=headers)

    assert [(r.status_code, r.json()["detail"]) for r in (response, missing)] == [(404, "Import rule not found")] * 2
    assert [name for name, _ in await _order(client, other_headers)] == list("ABCDE")


async def test_moving_a_rule_without_auth_returns_401(client):
    """Rules are a signed-in user's"""
    response = await client.put(f"/import-rules/{uuid.uuid4()}/position", json={"position": 0})

    assert response.status_code == 401
