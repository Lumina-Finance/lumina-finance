"""A write that meets a clash after its checks passed, and what a refused write leaves behind"""

import uuid

import pytest
from sqlalchemy import delete

from app.models.tag import Tag
from app.services.import_rules import creation, updates
from tests.conftest import TestSession
from tests.routes.support import _create_rule, _create_rule_ok, _create_user, _get_auth_header, _make_tag

CHANGED = "Your import rules or the records they name changed meanwhile. Please try again."
NAME_TAKEN = "An import rule with this name already exists"


async def _signed_in(client) -> dict:
    """Sign the default user up and return their auth headers"""
    return _get_auth_header(await _create_user(client))


def _delete_tag_after_checks(monkeypatch, module, tag_id: str) -> None:
    """Delete a tag from another session once the request has checked it, as a second request could"""
    check = module.check_actions

    async def check_then_delete(*args, **kwargs):
        errors = await check(*args, **kwargs)
        async with TestSession() as session:
            await session.execute(delete(Tag).where(Tag.id == uuid.UUID(tag_id)))
            await session.commit()
        return errors

    monkeypatch.setattr(module, "check_actions", check_then_delete)


async def _rules_with_tags(client, headers) -> list[tuple[str, list[str]]]:
    """Return each rule's name with the names of its tags, in order"""
    rules = (await client.get("/import-rules", headers=headers)).json()
    return [(rule["name"], [tag["name"] for tag in rule["tags"]]) for rule in rules]


async def test_a_tag_deleted_while_a_rule_is_created_answers_that_the_rules_changed_and_adds_nothing(client, monkeypatch):
    """The tag's row policy refuses the link at the flush, which is the second request's doing and not the person's name"""
    headers = await _signed_in(client)
    kept = await _make_tag(client, headers, "Kept")
    vanishing = await _make_tag(client, headers, "Vanishing")
    _delete_tag_after_checks(monkeypatch, creation, vanishing)

    response = await _create_rule(client, headers, name="New", tag_ids=[kept, vanishing])

    assert (response.status_code, response.json()["detail"]) == (409, CHANGED)
    assert await _rules_with_tags(client, headers) == []


async def test_a_tag_deleted_while_a_rule_is_edited_answers_that_the_rules_changed_and_keeps_the_rule_as_it_was(client, monkeypatch):
    """Nothing of the edit lands, neither the name nor the conditions nor the tags that were still there"""
    headers = await _signed_in(client)
    kept = await _make_tag(client, headers, "Kept")
    vanishing = await _make_tag(client, headers, "Vanishing")
    rule = await _create_rule_ok(client, headers, name="Before", tag_ids=[kept])
    _delete_tag_after_checks(monkeypatch, updates, vanishing)

    response = await client.patch(f"/import-rules/{rule['id']}", json={"name": "After", "tag_ids": [kept, vanishing]}, headers=headers)

    assert (response.status_code, response.json()["detail"]) == (409, CHANGED)
    assert (await client.get("/import-rules", headers=headers)).json() == [rule]


@pytest.mark.parametrize("module", [creation, updates])
async def test_a_name_taken_at_the_same_moment_is_answered_as_the_name_and_not_as_a_change(client, monkeypatch, module):
    """The name check passes for both requests, so the unique index is what refuses the second"""
    headers = await _signed_in(client)
    tag_id = await _make_tag(client, headers)
    await _create_rule_ok(client, headers, name="Taken", tag_ids=[tag_id])
    other = await _create_rule_ok(client, headers, name="Other", tag_ids=[tag_id])
    monkeypatch.setattr(module, "refuse_name_in_use", _allow_the_name)

    if module is creation:
        response = await _create_rule(client, headers, name="taken", tag_ids=[tag_id])
    else:
        response = await client.patch(f"/import-rules/{other['id']}", json={"name": "taken"}, headers=headers)

    assert (response.status_code, response.json()["detail"]) == (409, NAME_TAKEN)
    assert [name for name, _ in await _rules_with_tags(client, headers)] == ["Taken", "Other"]


async def _allow_the_name(*_args, **_kwargs) -> None:
    """Stand in for a name check that ran before the other request committed"""
