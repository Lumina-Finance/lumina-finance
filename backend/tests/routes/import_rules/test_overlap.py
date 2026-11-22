"""Changing the order of import rules while another change to it is saving

One request is held where it has taken its turn on the user's rules and not yet committed, the
other is queued behind it on the database, then the first is released. The second must read what the
first committed, so both end as if they ran one after the other, rather than two rules taking one
position and one request failing at its commit.
"""

import asyncio

import pytest

from app.services.import_rules import changes as changes_module
from app.services.import_rules import creation as creation_module
from app.services.import_rules import deletion as deletion_module
from app.services.import_rules import positions as positions_module
from app.services.import_rules import updates as updates_module
from tests.routes.support import (
    BUDGET_REFUSAL,
    _create_rule,
    _create_rule_ok,
    _create_user,
    _description_contains,
    _field_errors,
    _get_auth_header,
    _make_tag,
)
from tests.routes.support.lock_helpers import _held_request, _overlap, _pid, _record_pid


async def _order(client, headers) -> list[tuple[str, int]]:
    """Return each rule's name and position, in the order the list gives them"""
    return [(rule["name"], rule["position"]) for rule in (await client.get("/import-rules", headers=headers)).json()]


@pytest.mark.parametrize(
    ("second", "module", "status", "expected"),
    [
        ("create", creation_module, 201, [("A", 0), ("B", 1), ("C", 2), ("D", 3)]),
        ("delete", deletion_module, 204, [("B", 0), ("C", 1)]),
        ("move", positions_module, 200, [("A", 0), ("C", 1), ("B", 2)]),
    ],
)
async def test_a_change_to_the_order_waits_for_one_that_took_its_turn_first_and_reads_what_it_saved(
    client, monkeypatch, second, module, status, expected
):
    """A create is held before it commits, and the change behind it sees the new rule, which only the user's lock guarantees"""
    headers = _get_auth_header(await _create_user(client))
    tag_id = await _make_tag(client, headers)
    rules = {name: await _create_rule_ok(client, headers, name=name, tag_ids=[tag_id]) for name in ("A", "B")}
    held, release, entered = asyncio.Event(), asyncio.Event(), asyncio.Event()
    pids: list[int] = []
    original_mark = changes_module.mark_cache_changed_for_scope

    async def hold_before_cache_mark(db, **scope):
        if _held_request.get():
            pids.append(await _pid(db))
            held.set()
            await release.wait()
        await original_mark(db, **scope)

    async def first_create():
        _held_request.set(True)
        return await client.post(
            "/import-rules",
            json={
                "name": "C",
                "match": "all",
                "conditions": [{"kind": "condition", "attribute": "description", "operator": "contains", "value": "c"}],
                "tag_ids": [tag_id],
            },
            headers=headers,
        )

    async def second_change():
        if second == "create":
            return await client.post(
                "/import-rules",
                json={
                    "name": "D",
                    "match": "all",
                    "conditions": [{"kind": "condition", "attribute": "description", "operator": "contains", "value": "d"}],
                    "tag_ids": [tag_id],
                },
                headers=headers,
            )
        if second == "delete":
            return await client.delete(f"/import-rules/{rules['A']['id']}", headers=headers)
        return await client.put(f"/import-rules/{rules['B']['id']}/position", json={"position": 2}, headers=headers)

    monkeypatch.setattr(changes_module, "mark_cache_changed_for_scope", hold_before_cache_mark)
    _record_pid(monkeypatch, module, "lock_user_rules", pids, entered)

    created, changed = await _overlap(first_create, second_change, first_held=held, release=release, second_entered=entered, pids=pids)

    assert created.status_code == 201, created.text
    assert changed.status_code == status, changed.text
    assert await _order(client, headers) == expected


@pytest.mark.parametrize("second", ["create", "update"])
async def test_two_changes_that_each_fit_the_budget_alone_can_not_both_pass(client, monkeypatch, second):
    """The second change is counted against what the first committed, which only the user's lock guarantees"""
    headers = _get_auth_header(await _create_user(client))
    tag_id = await _make_tag(client, headers)
    other = await _create_rule_ok(client, headers, name="Other", conditions=[_description_contains("o")], tag_ids=[tag_id])
    held, release, entered = asyncio.Event(), asyncio.Event(), asyncio.Event()
    pids: list[int] = []
    original_mark = changes_module.mark_cache_changed_for_scope
    sixty = [_description_contains(f"text {number}") for number in range(60)]

    async def hold_before_cache_mark(db, **scope):
        if _held_request.get():
            pids.append(await _pid(db))
            held.set()
            await release.wait()
        await original_mark(db, **scope)

    async def first_create():
        _held_request.set(True)
        return await _create_rule(client, headers, name="First", conditions=sixty, tag_ids=[tag_id])

    async def second_change():
        if second == "create":
            return await _create_rule(client, headers, name="Second", conditions=sixty, tag_ids=[tag_id])
        return await client.patch(f"/import-rules/{other['id']}", json={"conditions": sixty}, headers=headers)

    module = creation_module if second == "create" else updates_module
    monkeypatch.setattr(changes_module, "mark_cache_changed_for_scope", hold_before_cache_mark)
    _record_pid(monkeypatch, module, "lock_user_rules", pids, entered)

    first, refused = await _overlap(first_create, second_change, first_held=held, release=release, second_entered=entered, pids=pids)

    assert first.status_code == 201, first.text
    assert _field_errors(refused) == [(("conditions",), BUDGET_REFUSAL)]
    assert (await client.get("/import-rules/budget", headers=headers)).json()["used"] == 61
