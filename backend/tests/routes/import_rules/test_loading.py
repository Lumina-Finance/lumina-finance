"""Reading a person's rules for the matcher: order, tags, accounts that are gone, the statements it costs, and the version"""

import uuid

from app.services.import_rules.loading import load_import_rules
from app.services.import_rules.matching import MatchAccount, MatchGroup, MatchText
from tests.routes.support import (
    _account_is,
    _create_account,
    _create_rule_ok,
    _create_second_user,
    _create_user,
    _description_contains,
    _get_auth_header,
    _group_of,
    _make_category,
    _make_merchant,
    _make_tag,
)
from tests.routes.support.identity_helpers import _act_as
from tests.routes.support.query_helpers import _recorded_statements


async def _signed_in(client) -> tuple[dict, uuid.UUID]:
    """Sign the default user up and return their auth headers and id"""
    response = await _create_user(client)
    return _get_auth_header(response), uuid.UUID(response.json()["user"]["id"])


async def _load(user_id):
    """Read the user's rules as the matcher's loader does, under row-level security"""
    async with _act_as(user_id) as session:
        return await load_import_rules(session, user_id)


async def test_the_rules_load_in_the_order_they_are_checked_with_their_tags_and_their_text_normalised(client):
    """Position decides the order, a rule's text is normalised once, and a tag carries the key a file's tag names are compared by"""
    headers, user_id = await _signed_in(client)
    tag_id = await _make_tag(client, headers, "  Review ")
    await _create_rule_ok(client, headers, name="Second place", tag_ids=[tag_id])
    first = await _create_rule_ok(
        client,
        headers,
        name="Market",
        conditions=[_description_contains("SQ   *Market")],
        match="any",
        merchant_id=await _make_merchant(client, headers),
    )
    assert (await client.put(f"/import-rules/{first['id']}/position", json={"position": 0}, headers=headers)).status_code == 200

    loaded = await _load(user_id)

    assert [rule.name for rule in loaded.rules] == ["Market", "Second place"]
    assert (loaded.rules[0].match, loaded.rules[0].items) == ("any", (MatchText("description", "contains", "sq *market"),))
    assert [(tag.id, tag.key) for tag in loaded.rules[1].tags] == [(uuid.UUID(tag_id), "review")]
    assert loaded.rules[0].tags == ()


async def test_a_condition_on_a_deleted_account_loads_as_one_that_no_longer_exists_and_a_group_keeps_its_own_conditions(client):
    """An account that is gone is read as the rule responses read it, and groups load one level deep"""
    headers, user_id = await _signed_in(client)
    kept = (await _create_account(client, headers, name="Kept")).json()["id"]
    gone = (await _create_account(client, headers, name="Gone")).json()["id"]
    await _create_rule_ok(
        client,
        headers,
        category_id=await _make_category(client, headers),
        conditions=[_account_is(kept), _group_of("any", _account_is(gone, "is_not"), _description_contains("x"))],
    )
    assert (await client.delete(f"/accounts/{gone}", headers=headers)).status_code == 204

    [rule] = (await _load(user_id)).rules

    first, group = rule.items
    assert first == MatchAccount("is", uuid.UUID(kept), exists=True)
    assert isinstance(group, MatchGroup)
    assert group.conditions[0] == MatchAccount("is_not", uuid.UUID(gone), exists=False)


async def test_another_users_rules_are_never_read(client):
    """Rules load for their owner alone"""
    headers, user_id = await _signed_in(client)
    other_headers = _get_auth_header(await _create_second_user(client))
    await _create_rule_ok(client, other_headers, tag_ids=[await _make_tag(client, other_headers)])

    assert (await _load(user_id)).rules == ()
    await _create_rule_ok(client, headers, tag_ids=[await _make_tag(client, headers)])
    assert [rule.name for rule in (await _load(user_id)).rules] == ["Market"]


async def _statements_to_load(user_id) -> list[str]:
    """Return the statements reading the rules cost"""
    with _recorded_statements() as statements:
        await _load(user_id)
    return [statement for statement in statements if "import_rule" in statement or "FROM accounts" in statement]


async def test_the_rules_load_in_the_same_statements_whatever_their_number(client):
    """One statement for the rules with their tags and one for the accounts they name, with another user's rules beside"""
    headers, user_id = await _signed_in(client)
    account_id = (await _create_account(client, headers, name="Chequing")).json()["id"]
    other_headers = _get_auth_header(await _create_second_user(client))
    await _create_rule_ok(client, other_headers, tag_ids=[await _make_tag(client, other_headers)])
    tags = [await _make_tag(client, headers, "One"), await _make_tag(client, headers, "Two")]
    await _create_rule_ok(client, headers, name="Rule 0", conditions=[_account_is(account_id)], tag_ids=tags)
    for_one = await _statements_to_load(user_id)

    for number in range(1, 12):
        await _create_rule_ok(client, headers, name=f"Rule {number}", conditions=[_account_is(account_id)], tag_ids=tags)
    for_many = await _statements_to_load(user_id)

    assert len(for_one) == len(for_many) == 2
    assert len((await _load(user_id)).rules) == 12


async def test_the_version_changes_whenever_a_rule_is_created_edited_moved_or_deleted_and_never_for_anything_else(client):
    """Created, a tag-only edit, a rename, a move, a renamed tag, a deleted account and a delete each give a version no earlier read had"""
    headers, user_id = await _signed_in(client)
    account_id = (await _create_account(client, headers, name="Chequing")).json()["id"]
    tag_id = await _make_tag(client, headers, "Review")
    other_tag_id = await _make_tag(client, headers, "Food")
    seen = [(await _load(user_id)).version]
    made: dict[str, str] = {}

    async def create_a():
        await _create_rule_ok(client, headers, name="A", conditions=[_account_is(account_id)], tag_ids=[tag_id])

    async def create_b():
        made["b"] = (await _create_rule_ok(client, headers, name="B", tag_ids=[tag_id]))["id"]

    async def retag_a():
        [rule_a, _] = (await client.get("/import-rules", headers=headers)).json()
        assert (
            await client.patch(f"/import-rules/{rule_a['id']}", json={"tag_ids": [tag_id, other_tag_id]}, headers=headers)
        ).status_code == 200

    async def rename_b():
        assert (await client.patch(f"/import-rules/{made['b']}", json={"name": "B2"}, headers=headers)).status_code == 200

    async def move_b():
        assert (await client.put(f"/import-rules/{made['b']}/position", json={"position": 0}, headers=headers)).status_code == 200

    async def rename_tag():
        assert (await client.patch(f"/tags/{other_tag_id}", json={"name": "Meals"}, headers=headers)).status_code == 200

    async def delete_account():
        assert (await client.delete(f"/accounts/{account_id}", headers=headers)).status_code == 204

    async def delete_b():
        assert (await client.delete(f"/import-rules/{made['b']}", headers=headers)).status_code == 204

    for step in (create_a, create_b, retag_a, rename_b, move_b, rename_tag, delete_account, delete_b):
        await step()
        seen.append((await _load(user_id)).version)

    assert len(set(seen)) == len(seen), "every kind of change gave a version no earlier read had"
    assert (await _load(user_id)).version == seen[-1], "reading again changes nothing"

    other_headers = _get_auth_header(await _create_second_user(client))
    await _create_rule_ok(client, other_headers, tag_ids=[await _make_tag(client, other_headers)])
    assert (await _load(user_id)).version == seen[-1], "another person's rule is no change to this one's"
