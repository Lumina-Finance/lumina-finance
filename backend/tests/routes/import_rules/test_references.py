"""What deleting or merging a merchant, category or tag does to the import rules that name it"""

import pytest

from tests.routes.support import (
    _create_account,
    _create_rule_ok,
    _create_user,
    _get_auth_header,
    _get_system_merchant_id,
    _make_category,
    _make_merchant,
    _make_tag,
)
from tests.routes.support.transaction_helpers import _create_transaction

KINDS = ["merchant", "category", "tag"]
MAKERS = {"merchant": _make_merchant, "category": _make_category, "tag": _make_tag}
PATHS = {"merchant": "merchants", "category": "categories", "tag": "tags"}

# The sentences the screen reads to tell a rule in the way from transactions in the way, so each is pinned whole
REFUSED_BY_ZETA = {
    "merchant": 'Merchant is used by the import rule "Zeta"',
    "category": 'Category is used by the import rule "Zeta"',
    "tag": 'Tag is used by the import rule "Zeta"',
}
REFUSED_BY_ALPHA = {
    "merchant": 'Merchant is used by the import rule "Alpha"',
    "category": 'Category is used by the import rule "Alpha"',
    "tag": 'Tag is used by the import rule "Alpha"',
}


async def _signed_in(client) -> dict:
    """Sign the default user up and return their auth headers"""
    return _get_auth_header(await _create_user(client))


def _actions(kind: str, thing_id: str) -> dict:
    """Return the field of a rule that sets this merchant, category or tag"""
    return {"tag_ids": [thing_id]} if kind == "tag" else {f"{kind}_id": thing_id}


async def _used_by_a_transaction(client, headers, kind: str, thing_id: str) -> None:
    """Record one transaction that uses this merchant, category or tag"""
    account_id = (await _create_account(client, headers, name="Chequing")).json()["id"]
    category_id = thing_id if kind == "category" else await _make_category(client, headers, "Base")
    merchant_id = thing_id if kind == "merchant" else await _get_system_merchant_id(client, headers)
    response = await _create_transaction(
        client, headers, account_id, category_id, merchant_id=merchant_id, tag_ids=[thing_id] if kind == "tag" else []
    )
    assert response.status_code == 201, response.text


@pytest.mark.parametrize("kind", KINDS)
async def test_something_a_rule_sets_cannot_be_deleted_and_the_refusal_names_the_first_rule_by_position(client, kind):
    """The rule first in the order is named, not the one first by name, and the delete goes through once no rule sets it"""
    headers = await _signed_in(client)
    thing_id = await MAKERS[kind](client, headers, "Used")
    unrelated_id = await MAKERS[kind](client, headers, "Unrelated")
    first = await _create_rule_ok(client, headers, name="Zeta", **_actions(kind, thing_id))
    second = await _create_rule_ok(client, headers, name="Alpha", **_actions(kind, thing_id))

    refused = await client.delete(f"/{PATHS[kind]}/{thing_id}", headers=headers)
    unrelated = await client.delete(f"/{PATHS[kind]}/{unrelated_id}", headers=headers)
    assert (await client.delete(f"/import-rules/{first['id']}", headers=headers)).status_code == 204
    named_next = await client.delete(f"/{PATHS[kind]}/{thing_id}", headers=headers)
    assert (await client.delete(f"/import-rules/{second['id']}", headers=headers)).status_code == 204
    allowed = await client.delete(f"/{PATHS[kind]}/{thing_id}", headers=headers)

    assert (refused.status_code, refused.json()["detail"]) == (409, REFUSED_BY_ZETA[kind])
    assert unrelated.status_code == 204
    assert named_next.json()["detail"] == REFUSED_BY_ALPHA[kind]
    assert allowed.status_code == 204


@pytest.mark.parametrize("kind", KINDS)
async def test_the_rule_is_named_when_transactions_use_the_same_thing(client, kind):
    """A person who must act on both is told about the rule first, since it is the one they can change at once"""
    headers = await _signed_in(client)
    thing_id = await MAKERS[kind](client, headers, "Used")
    await _create_rule_ok(client, headers, name="Zeta", **_actions(kind, thing_id))
    await _used_by_a_transaction(client, headers, kind, thing_id)

    refused = await client.delete(f"/{PATHS[kind]}/{thing_id}", headers=headers)

    assert (refused.status_code, refused.json()["detail"]) == (409, REFUSED_BY_ZETA[kind])


@pytest.mark.parametrize("kind", ["merchant", "category"])
async def test_merging_moves_the_rules_that_set_the_source_to_the_replacement(client, kind):
    """A rule keeps doing what it did, with the name that now stands for it, and a rule that set something else is left alone"""
    headers = await _signed_in(client)
    source_id, replacement_id, other_id = [await MAKERS[kind](client, headers, name) for name in ("Source", "Replacement", "Other")]
    moved = await _create_rule_ok(client, headers, name="Moved", **_actions(kind, source_id))
    left = await _create_rule_ok(client, headers, name="Left", **_actions(kind, other_id))

    merged = await client.post(f"/{PATHS[kind]}/{source_id}/merge", json={f"replacement_{kind}_id": replacement_id}, headers=headers)

    assert merged.status_code == 204, merged.text
    rules = {rule["name"]: rule for rule in (await client.get("/import-rules", headers=headers)).json()}
    assert rules["Moved"][kind] == {"id": replacement_id, "name": "Replacement"}
    assert rules["Left"][kind] == left[kind]
    assert rules["Moved"]["position"] == moved["position"]


async def test_merging_a_tag_moves_its_rules_and_leaves_a_rule_that_already_adds_the_replacement_with_one_link(client):
    """A rule can't hold the replacement twice, so one that already added it keeps it once"""
    headers = await _signed_in(client)
    source_id, replacement_id = [await _make_tag(client, headers, name) for name in ("Source", "Replacement")]
    await _create_rule_ok(client, headers, name="Only source", tag_ids=[source_id])
    await _create_rule_ok(client, headers, name="Both", tag_ids=[source_id, replacement_id])
    await _create_rule_ok(client, headers, name="Only replacement", tag_ids=[replacement_id])

    merged = await client.post(f"/tags/{source_id}/merge", json={"replacement_tag_id": replacement_id}, headers=headers)

    assert merged.status_code == 204, merged.text
    rules = (await client.get("/import-rules", headers=headers)).json()
    assert [(rule["name"], [tag["id"] for tag in rule["tags"]]) for rule in rules] == [
        ("Only source", [replacement_id]),
        ("Both", [replacement_id]),
        ("Only replacement", [replacement_id]),
    ]
