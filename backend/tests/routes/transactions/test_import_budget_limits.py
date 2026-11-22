"""Limits on the budgets and tracked categories an import may write"""

from app.schemas.budget import MAX_BASE_BUDGETS, MAX_BUDGET_CATEGORIES
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.support.budget_seed_helpers import seed_base_budgets
from tests.routes.transactions._import_helpers import _GROCERIES, _commit_run, _firefly_batch, _open_run, _stage_batch


def _budget(name, category_sources=("Groceries",)):
    """Build a budget draft with one April limit"""
    return {
        "name": name,
        "currency": "CAD",
        "category_sources": list(category_sources),
        "limits": [{"start": "2026-04-01", "end": "2026-04-30", "amount": "300.000000000000"}],
        "recurrence": None,
    }


async def _stage_run_with_budgets(client, headers, budgets, categories=None):
    """Open a Firefly III run, stage one row and the given budgets, and return the run's id and the budgets response"""
    run_id = await _open_run(client, headers, 1, "firefly")
    resp = await _stage_batch(client, headers, run_id, _firefly_batch(1), "firefly")
    assert resp.status_code == 204, resp.text
    resp = await client.put(
        f"/transactions/import/runs/{run_id}/budgets",
        json={"categories": categories or [_GROCERIES], "budgets": budgets},
        headers=headers,
    )
    return run_id, resp


async def test_an_import_commits_budgets_up_to_the_most_a_person_keeps(client):
    """With 98 budgets already kept, a run of two reaches 100 and commits."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await seed_base_budgets(signup_resp.json()["user"]["id"], MAX_BASE_BUDGETS - 2)

    run_id, resp = await _stage_run_with_budgets(client, headers, [_budget("First"), _budget("Second")])
    assert resp.status_code == 204, resp.text

    resp = await _commit_run(client, headers, run_id, "firefly")
    assert resp.status_code == 201, resp.text
    assert len((await client.get("/base-budgets", headers=headers)).json()) == MAX_BASE_BUDGETS


async def test_an_import_that_would_pass_the_most_a_person_keeps_is_refused_at_the_commit(client):
    """With 99 budgets already kept, a run of two is refused and nothing is written."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await seed_base_budgets(signup_resp.json()["user"]["id"], MAX_BASE_BUDGETS - 1)

    run_id, resp = await _stage_run_with_budgets(client, headers, [_budget("First"), _budget("Second")])
    assert resp.status_code == 204, resp.text

    resp = await _commit_run(client, headers, run_id, "firefly")
    assert (resp.status_code, resp.json()["detail"]) == (422, f"You can keep up to {MAX_BASE_BUDGETS} budgets")
    assert len((await client.get("/base-budgets", headers=headers)).json()) == MAX_BASE_BUDGETS - 1


async def test_an_imported_budget_tracks_100_categories_and_refuses_101_at_staging(client):
    """A budget naming 101 category sources is refused when the run takes it."""
    headers = _get_auth_header(await _create_user(client))
    sources = [f"Source {index}" for index in range(MAX_BUDGET_CATEGORIES + 1)]
    categories = [{"source": source, "create": {"name": source, "kind": "expense"}} for source in sources]

    _, resp = await _stage_run_with_budgets(client, headers, [_budget("Too many", sources)], categories)
    assert resp.status_code == 422

    _, resp = await _stage_run_with_budgets(client, headers, [_budget("Just enough", sources[:MAX_BUDGET_CATEGORIES])], categories)
    assert resp.status_code == 204, resp.text


async def _put_budget_part(client, headers, run_id, start_index, names):
    """Send one part of a run's budgets and return the response"""
    return await client.put(
        f"/transactions/import/runs/{run_id}/budgets",
        json={"categories": [_GROCERIES], "budgets": [_budget(name) for name in names], "start_index": start_index},
        headers=headers,
    )


async def test_a_shorter_part_over_longer_staged_budgets_leaves_only_what_it_replaces(client):
    """With 4 budgets staged, a part of 1 starting at index 1 keeps the first and replaces the rest."""
    headers = _get_auth_header(await _create_user(client))
    run_id, resp = await _stage_run_with_budgets(client, headers, [_budget(name) for name in ("A", "B", "C", "D")])
    assert resp.status_code == 204, resp.text

    resp = await _put_budget_part(client, headers, run_id, 1, ["Replacement"])
    assert resp.status_code == 204, resp.text

    resp = await _commit_run(client, headers, run_id, "firefly")
    assert resp.status_code == 201, resp.text
    assert [budget["name"] for budget in resp.json()["budgets"]] == ["A", "Replacement"]
