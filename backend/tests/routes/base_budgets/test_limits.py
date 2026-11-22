"""Limits on the budgets a person keeps and the categories a budget tracks"""

import uuid
from datetime import date

from app.models.budget import BudgetTrackedCategory
from app.schemas.budget import MAX_BASE_BUDGETS, MAX_BUDGET_CATEGORIES
from app.schemas.import_run import MAX_JOURNAL_BUDGET_CATEGORIES, MAX_JOURNAL_BUDGETS
from tests.conftest import TestSession
from tests.routes.base_budgets._helpers import (
    _create_base_budget,
    _create_category,
    _create_group,
    _create_second_user,
    _get_system_category_id,
)
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.support.budget_seed_helpers import seed_base_budgets

BUDGET_LIMIT_DETAIL = f"You can keep up to {MAX_BASE_BUDGETS} budgets"
CATEGORY_LIMIT_DETAIL = f"A budget can track up to {MAX_BUDGET_CATEGORIES} categories"


async def _create_categories(client, headers, count):
    """Create expense categories and return their ids"""
    return [await _create_category(client, headers, name=f"Limit category {index}") for index in range(count)]


async def _seed_tracked_category(base_budget_id, category_id):
    """Link a category to a base budget without going through the API"""
    async with TestSession() as session:
        session.add(
            BudgetTrackedCategory(base_budget_id=uuid.UUID(base_budget_id), category_id=uuid.UUID(category_id), added_at=date(2026, 3, 1))
        )
        await session.commit()


async def test_the_100th_budget_is_created_and_the_101st_is_refused(client):
    """A person with 99 budgets can add one more, and then no more."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await seed_base_budgets(signup_resp.json()["user"]["id"], MAX_BASE_BUDGETS - 1)

    category_id = await _create_category(client, headers)
    resp = await _create_base_budget(client, headers, category_ids=[category_id])
    assert resp.status_code == 201

    resp = await _create_base_budget(client, headers, category_ids=[category_id], name="One too many")
    assert (resp.status_code, resp.json()["detail"]) == (422, BUDGET_LIMIT_DETAIL)
    assert len((await client.get("/base-budgets", headers=headers)).json()) == MAX_BASE_BUDGETS


async def test_a_person_past_the_budget_limit_keeps_every_budget_and_adds_none(client):
    """Someone with 105 budgets, archived ones included, is refused a new budget and still lists all."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    await seed_base_budgets(user_id, MAX_BASE_BUDGETS)
    await seed_base_budgets(user_id, 5, is_archived=True)

    resp = await _create_base_budget(client, headers)
    assert (resp.status_code, resp.json()["detail"]) == (422, BUDGET_LIMIT_DETAIL)
    assert len((await client.get("/base-budgets", headers=headers)).json()) == MAX_BASE_BUDGETS + 5


async def test_an_archived_budget_counts_toward_the_budget_limit(client):
    """With 99 active budgets and 1 archived one, a new budget is refused."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    await seed_base_budgets(user_id, MAX_BASE_BUDGETS - 1)
    await seed_base_budgets(user_id, 1, is_archived=True)

    resp = await _create_base_budget(client, headers)
    assert (resp.status_code, resp.json()["detail"]) == (422, BUDGET_LIMIT_DETAIL)


async def test_another_persons_budgets_do_not_count_toward_the_budget_limit(client):
    """A person with no budgets creates one while someone else keeps 100."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    _, other_user_id = await _create_second_user(client)
    await seed_base_budgets(other_user_id, MAX_BASE_BUDGETS)

    resp = await _create_base_budget(client, headers)
    assert resp.status_code == 201


async def test_a_group_budget_beside_99_personal_ones_does_not_stop_a_personal_create(client):
    """The count has to leave a group's budget out, or 99 and 1 would read as the limit."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await seed_base_budgets(signup_resp.json()["user"]["id"], MAX_BASE_BUDGETS - 1)
    group_id = await _create_group(client, headers)
    await seed_base_budgets(None, 1, group_id=group_id)

    resp = await _create_base_budget(client, headers)
    assert resp.status_code == 201


async def test_group_budgets_do_not_count_toward_the_budget_limit(client):
    """A person at the limit can still add a budget to a group they administer."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await seed_base_budgets(signup_resp.json()["user"]["id"], MAX_BASE_BUDGETS)
    group_id = await _create_group(client, headers)

    category_id = await _get_system_category_id(client, headers)
    resp = await _create_base_budget(client, headers, category_ids=[category_id], group_id=group_id)
    assert resp.status_code == 201


async def test_a_budget_is_created_with_100_categories_and_refused_with_101(client):
    """The category limit holds on create at both ends."""
    headers = _get_auth_header(await _create_user(client))
    category_ids = await _create_categories(client, headers, MAX_BUDGET_CATEGORIES + 1)

    resp = await _create_base_budget(client, headers, category_ids=category_ids)
    assert (resp.status_code, resp.json()["detail"]) == (422, CATEGORY_LIMIT_DETAIL)

    resp = await _create_base_budget(client, headers, category_ids=category_ids[:MAX_BUDGET_CATEGORIES])
    assert resp.status_code == 201
    assert len(resp.json()["category_ids"]) == MAX_BUDGET_CATEGORIES


async def test_a_budget_saves_up_to_100_categories_and_refuses_101_on_update(client):
    """The category limit holds on update, and a request that leaves the categories as they are saves."""
    headers = _get_auth_header(await _create_user(client))
    category_ids = await _create_categories(client, headers, MAX_BUDGET_CATEGORIES + 1)
    base_budget_id = (await _create_base_budget(client, headers, category_ids=category_ids[:1])).json()["id"]

    resp = await client.patch(f"/base-budgets/{base_budget_id}", json={"category_ids": category_ids}, headers=headers)
    assert (resp.status_code, resp.json()["detail"]) == (422, CATEGORY_LIMIT_DETAIL)

    resp = await client.patch(f"/base-budgets/{base_budget_id}", json={"category_ids": category_ids[:MAX_BUDGET_CATEGORIES]}, headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()["category_ids"]) == MAX_BUDGET_CATEGORIES


async def test_a_budget_past_the_category_limit_still_renames_and_resaves_its_categories(client):
    """A budget already tracking 101 categories saves a rename, or the same categories, but cannot add another."""
    headers = _get_auth_header(await _create_user(client))
    category_ids = await _create_categories(client, headers, MAX_BUDGET_CATEGORIES + 2)
    base_budget_id = (await _create_base_budget(client, headers, category_ids=category_ids[:MAX_BUDGET_CATEGORIES])).json()["id"]
    await _seed_tracked_category(base_budget_id, category_ids[MAX_BUDGET_CATEGORIES])
    tracked = category_ids[: MAX_BUDGET_CATEGORIES + 1]

    resp = await client.patch(f"/base-budgets/{base_budget_id}", json={"name": "Renamed"}, headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()["category_ids"]) == MAX_BUDGET_CATEGORIES + 1

    resp = await client.patch(f"/base-budgets/{base_budget_id}", json={"category_ids": tracked}, headers=headers)
    assert resp.status_code == 200

    resp = await client.patch(f"/base-budgets/{base_budget_id}", json={"category_ids": category_ids}, headers=headers)
    assert (resp.status_code, resp.json()["detail"]) == (422, CATEGORY_LIMIT_DETAIL)

    resp = await client.patch(f"/base-budgets/{base_budget_id}", json={"category_ids": tracked[:-1]}, headers=headers)
    assert resp.status_code == 200


def test_the_limits_are_the_figures_the_app_states():
    """Every budget and category cap is 100, whatever they derive from."""
    assert (MAX_BASE_BUDGETS, MAX_BUDGET_CATEGORIES) == (100, 100)
    assert (MAX_JOURNAL_BUDGETS, MAX_JOURNAL_BUDGET_CATEGORIES) == (100, 100)
