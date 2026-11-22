"""DELETE /import-rules/{rule_id}"""

import uuid

from sqlalchemy import func, select

from app.models.import_rule import ImportRuleTag
from tests.conftest import TestSession
from tests.routes.support import (
    _create_rule_ok,
    _create_second_user,
    _create_user,
    _get_auth_header,
    _make_tag,
)


async def _signed_in(client) -> dict:
    """Sign the default user up and return their auth headers"""
    return _get_auth_header(await _create_user(client))


async def _positions(client, headers) -> list[tuple[str, int]]:
    """Return each rule's name and position, in the order the list gives them"""
    return [(rule["name"], rule["position"]) for rule in (await client.get("/import-rules", headers=headers)).json()]


async def test_deleting_a_rule_closes_the_gap_it_leaves_and_removes_its_tags(client):
    """The rules after it each move up one, so the positions stay without a gap, and its tag links go with it"""
    headers = await _signed_in(client)
    tag_id = await _make_tag(client, headers)
    rules = [await _create_rule_ok(client, headers, name=name, tag_ids=[tag_id]) for name in ("A", "B", "C", "D")]
    before = (await client.get("/import-rules", headers=headers)).json()

    response = await client.delete(f"/import-rules/{rules[1]['id']}", headers=headers)

    assert response.status_code == 204, response.text
    assert await _positions(client, headers) == [("A", 0), ("C", 1), ("D", 2)]
    after = {rule["name"]: rule for rule in (await client.get("/import-rules", headers=headers)).json()}
    assert after["C"]["updated_at"] == before[2]["updated_at"], "a rule that only changed place isn't stamped as edited"
    async with TestSession() as session:
        links = await session.scalar(
            select(func.count()).select_from(ImportRuleTag).where(ImportRuleTag.import_rule_id == uuid.UUID(rules[1]["id"]))
        )
    assert links == 0


async def test_deleting_the_first_and_the_last_rule_each_leave_the_rest_in_order(client):
    """The ends of the list are where an off-by-one shows"""
    headers = await _signed_in(client)
    tag_id = await _make_tag(client, headers)
    rules = [await _create_rule_ok(client, headers, name=name, tag_ids=[tag_id]) for name in ("A", "B", "C")]

    assert (await client.delete(f"/import-rules/{rules[0]['id']}", headers=headers)).status_code == 204
    assert (await client.delete(f"/import-rules/{rules[2]['id']}", headers=headers)).status_code == 204

    assert await _positions(client, headers) == [("B", 0)]


async def test_deleting_the_same_rule_twice_is_not_found_the_second_time(client):
    """A repeat is answered as any rule that is gone"""
    headers = await _signed_in(client)
    rule = await _create_rule_ok(client, headers, tag_ids=[await _make_tag(client, headers)])

    first = await client.delete(f"/import-rules/{rule['id']}", headers=headers)
    second = await client.delete(f"/import-rules/{rule['id']}", headers=headers)

    assert (first.status_code, second.status_code) == (204, 404)
    assert second.json()["detail"] == "Import rule not found"


async def test_another_users_rule_cannot_be_deleted_and_their_order_is_untouched(client):
    """The rule stays, and no position of theirs shifts"""
    headers = await _signed_in(client)
    other_headers = _get_auth_header(await _create_second_user(client))
    other_tag_id = await _make_tag(client, other_headers)
    theirs = [await _create_rule_ok(client, other_headers, name=name, tag_ids=[other_tag_id]) for name in ("X", "Y")]
    await _create_rule_ok(client, headers, name="Mine", tag_ids=[await _make_tag(client, headers)])

    response = await client.delete(f"/import-rules/{theirs[0]['id']}", headers=headers)

    assert (response.status_code, response.json()["detail"]) == (404, "Import rule not found")
    assert await _positions(client, other_headers) == [("X", 0), ("Y", 1)]
    assert await _positions(client, headers) == [("Mine", 0)]


async def test_deleting_a_rule_without_auth_returns_401(client):
    """Rules are a signed-in user's"""
    assert (await client.delete(f"/import-rules/{uuid.uuid4()}")).status_code == 401
