"""What the allowance check refuses on each record kind's create route besides accounts, whose route tests hold the full table

A refusal answers 403 with the deployment's own sentence and creates nothing, and asking for another
kind never refuses. The tax-advantaged category's yearly limit and the saved insights range each have
their own kind
"""

import pytest

from app.allowance_hook import AllowanceKind
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check


async def _category(client, headers) -> tuple[str, dict, str]:
    """Return the create path, a valid payload and the list path of categories"""
    return "/categories", {"name": "Hobbies", "kind": "expense"}, "/categories"


async def _tag(client, headers) -> tuple[str, dict, str]:
    """Return the create path, a valid payload and the list path of tags"""
    return "/tags", {"name": "vacation"}, "/tags"


async def _merchant(client, headers) -> tuple[str, dict, str]:
    """Return the create path, a valid payload and the list path of merchants"""
    return "/merchants", {"name": "Costco"}, "/merchants"


async def _budget(client, headers) -> tuple[str, dict, str]:
    """Return the create path, a valid payload and the list path of budgets, after creating the category it tracks"""
    category = await client.post("/categories", json={"name": "Groceries here", "kind": "expense"}, headers=headers)
    payload = {"name": "March", "currency": "CAD", "recurrence_freq": "monthly", "recurrence_dom": 1, "category_ids": [category.json()["id"]]}
    return "/base-budgets", payload, "/base-budgets"


async def _tax_advantaged_category(client, headers) -> tuple[str, dict, str]:
    """Return the create path, a valid payload and the list path of tax-advantaged categories"""
    return "/tax-advantaged-categories", {"name": "TFSA", "tax_treatment": "tax_free", "currency": "CAD"}, "/tax-advantaged-categories"


async def _tax_advantaged_category_limit(client, headers) -> tuple[str, dict, str]:
    """Return the create path, a valid payload and the list path of a category's yearly limits, after creating the category"""
    category = await client.post(
        "/tax-advantaged-categories", json={"name": "TFSA", "tax_treatment": "tax_free", "currency": "CAD"}, headers=headers
    )
    path = f"/tax-advantaged-categories/{category.json()['id']}/limits"
    return path, {"year": 2026, "contribution_limit": 700_000}, path


async def _saved_range(client, headers) -> tuple[str, dict, str]:
    """Return the create path, a valid payload and the list path of saved insights ranges"""
    return "/insights/saved-ranges", {"name": "Half-year review", "amount": 6, "unit": "month"}, "/insights/saved-ranges"


@pytest.mark.parametrize(
    ("kind", "prepare"),
    [
        pytest.param(AllowanceKind.CATEGORY, _category, id="category"),
        pytest.param(AllowanceKind.TAG, _tag, id="tag"),
        pytest.param(AllowanceKind.MERCHANT, _merchant, id="merchant"),
        pytest.param(AllowanceKind.BUDGET, _budget, id="budget"),
        pytest.param(AllowanceKind.TAX_ADVANTAGED_CATEGORY, _tax_advantaged_category, id="tax-advantaged-category"),
        pytest.param(AllowanceKind.TAX_ADVANTAGED_CATEGORY_LIMIT, _tax_advantaged_category_limit, id="tax-advantaged-category-limit"),
        pytest.param(AllowanceKind.SAVED_INSIGHTS_RANGE, _saved_range, id="saved-insights-range"),
    ],
)
async def test_create_refused_by_the_check_says_the_deployments_reason_and_creates_nothing(client, kind, prepare):
    """The sentence the deployment gave is what the user reads, and refusing one kind leaves every other kind alone"""
    headers = _get_auth_header(await _create_user(client))
    create_path, payload, list_path = await prepare(client, headers)
    before = (await client.get(list_path, headers=headers)).json()
    asked = install_check(refused={kind})

    refused = await client.post(create_path, json=payload, headers=headers)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == ALLOWANCE_REASON
    assert (await client.get(list_path, headers=headers)).json() == before
    assert [(request.kind, request.held, request.adding) for request in asked if request.kind == kind] == [(kind, 0, 1)]

    install_check()
    allowed = await client.post(create_path, json=payload, headers=headers)

    assert allowed.status_code == 201, allowed.text


async def test_create_budget_counts_an_archived_budget_until_it_is_deleted(client):
    """Archiving a budget gives no room back at the limit, and only deleting it does"""
    headers = _get_auth_header(await _create_user(client))
    create_path, payload, _ = await _budget(client, headers)
    asked = install_check(maximum=1)
    first = await client.post(create_path, json=payload, headers=headers)
    archived = await client.patch(f"/base-budgets/{first.json()['id']}", json={"is_archived": True}, headers=headers)

    second = await client.post(create_path, json={**payload, "name": "April"}, headers=headers)
    deleted = await client.delete(f"/base-budgets/{first.json()['id']}", headers=headers)
    third = await client.post(create_path, json={**payload, "name": "May"}, headers=headers)

    assert [response.status_code for response in (first, archived, second, deleted, third)] == [201, 200, 403, 204, 201]
    assert [request.held for request in asked if request.kind == AllowanceKind.BUDGET] == [0, 1, 0]
