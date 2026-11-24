"""What the allowance check refuses on each record kind's create route besides accounts, whose route tests hold the full table

A refusal answers 403 with the check's own sentence and creates nothing, and the check is told
how many of the kind the user owns alone. The tax-advantaged category's yearly limit and the saved
insights range each have their own kind. A budget or tax-advantaged category in a currency other
than the user's main one is refused when the check refuses foreign currencies
"""

import pytest

from app.allowance_hook import AllowanceKind
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check, seed_usd_currency
from tests.routes.support.authorization_helpers import _sign_up_other_user

_TAX_CATEGORY = {"name": "TFSA", "tax_treatment": "tax_free", "currency": "CAD"}
_LIMIT = {"year": 2026, "contribution_limit": 700_000}


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
    return "/tax-advantaged-categories", _TAX_CATEGORY, "/tax-advantaged-categories"


async def _tax_advantaged_category_limit(client, headers) -> tuple[str, dict, str]:
    """Return the create path, a valid payload and the list path of a category's yearly limits, after creating the category"""
    category = await client.post("/tax-advantaged-categories", json=_TAX_CATEGORY, headers=headers)
    path = f"/tax-advantaged-categories/{category.json()['id']}/limits"
    return path, _LIMIT, path


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
async def test_create_refused_by_the_check_says_the_checks_reason_and_creates_nothing(client, kind, prepare):
    """The sentence the check gave is what the user reads, the check is asked once for the one more, and a yes lets the same create in"""
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


@pytest.mark.parametrize(
    "prepare",
    [pytest.param(_budget, id="budget"), pytest.param(_tax_advantaged_category, id="tax-advantaged-category")],
)
async def test_create_in_another_currency_refused_by_the_check_says_the_checks_reason_and_creates_nothing(client, prepare):
    """A US dollar budget or tax-advantaged category beside a Canadian dollar main currency is refused with the check's sentence"""
    headers = _get_auth_header(await _create_user(client))
    await seed_usd_currency()
    create_path, payload, list_path = await prepare(client, headers)
    before = (await client.get(list_path, headers=headers)).json()
    asked = install_check(refused={AllowanceKind.FOREIGN_CURRENCIES})

    refused = await client.post(create_path, json={**payload, "currency": "USD"}, headers=headers)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == ALLOWANCE_REASON
    assert (await client.get(list_path, headers=headers)).json() == before
    assert [(request.held, request.adding) for request in asked if request.kind == AllowanceKind.FOREIGN_CURRENCIES] == [(None, 0)]

    install_check()
    allowed = await client.post(create_path, json={**payload, "currency": "USD"}, headers=headers)

    assert allowed.status_code == 201, allowed.text


@pytest.mark.parametrize(
    "prepare",
    [pytest.param(_budget, id="budget"), pytest.param(_tax_advantaged_category, id="tax-advantaged-category")],
)
@pytest.mark.parametrize(
    ("currency", "in_group"),
    [pytest.param("CAD", False, id="main-currency"), pytest.param("USD", True, id="group-owned")],
)
async def test_create_never_asks_about_other_currencies_for_the_main_currency_or_a_group_owned_record(client, prepare, currency, in_group):
    """A budget or tax-advantaged category in the main currency, or one a group owns in US dollars, is created without asking"""
    headers = _get_auth_header(await _create_user(client))
    await seed_usd_currency()
    create_path, payload, _ = await prepare(client, headers)
    payload = {**payload, "currency": currency}
    if in_group:
        group = await client.post("/groups", json={"name": "Household"}, headers=headers)
        payload["group_id"] = group.json()["id"]
        if "category_ids" in payload:
            category = await client.post(
                "/categories", json={"name": "Shared", "kind": "expense", "group_id": group.json()["id"]}, headers=headers
            )
            payload["category_ids"] = [category.json()["id"]]
    asked = install_check(refused={AllowanceKind.FOREIGN_CURRENCIES})

    created = await client.post(create_path, json=payload, headers=headers)

    assert created.status_code == 201, created.text
    assert [request for request in asked if request.kind == AllowanceKind.FOREIGN_CURRENCIES] == []


@pytest.mark.parametrize(
    ("kind", "prepare", "second_payload", "archive"),
    [
        pytest.param(AllowanceKind.CATEGORY, _category, {"name": "Gardening"}, False, id="category"),
        pytest.param(AllowanceKind.TAG, _tag, {"name": "work"}, False, id="tag"),
        pytest.param(AllowanceKind.MERCHANT, _merchant, {"name": "Metro"}, False, id="merchant"),
        pytest.param(AllowanceKind.BUDGET, _budget, {"name": "April"}, False, id="budget"),
        pytest.param(AllowanceKind.BUDGET, _budget, {"name": "April"}, True, id="archived-budget"),
        pytest.param(AllowanceKind.TAX_ADVANTAGED_CATEGORY, _tax_advantaged_category, {"name": "RRSP"}, False, id="tax-advantaged-category"),
        pytest.param(
            AllowanceKind.TAX_ADVANTAGED_CATEGORY_LIMIT, _tax_advantaged_category_limit, {"year": 2027}, False, id="tax-advantaged-limit"
        ),
        pytest.param(
            AllowanceKind.SAVED_INSIGHTS_RANGE, _saved_range, {"name": "Quarter review", "amount": 3}, False, id="saved-insights-range"
        ),
    ],
)
async def test_create_tells_the_check_how_many_the_user_holds_and_never_counts_another_users(client, kind, prepare, second_payload, archive):
    """One record of the user's own and one of another user's make the user's count one, an archived budget included"""
    headers = _get_auth_header(await _create_user(client))
    other_headers, _ = await _sign_up_other_user(client)
    create_path, payload, _ = await prepare(client, headers)
    first = await client.post(create_path, json=payload, headers=headers)
    assert first.status_code == 201, first.text
    if archive:
        archived = await client.patch(f"{create_path}/{first.json()['id']}", json={"is_archived": True}, headers=headers)
        assert archived.status_code == 200, archived.text
    other_path, other_payload, _ = await prepare(client, other_headers)
    assert (await client.post(other_path, json=other_payload, headers=other_headers)).status_code == 201
    asked = install_check()

    second = await client.post(create_path, json={**payload, **second_payload}, headers=headers)

    assert second.status_code == 201, second.text
    assert [(request.held, request.adding) for request in asked if request.kind == kind] == [(1, 1)]


async def test_create_a_limit_counts_the_limits_of_every_personal_category_of_the_user_and_no_others(client):
    """A limit in each of two categories makes two, whichever category the next is added to, and another user's limit is not counted"""
    headers = _get_auth_header(await _create_user(client))
    other_headers, _ = await _sign_up_other_user(client)
    paths = []
    for name in ("TFSA", "RRSP"):
        category = await client.post("/tax-advantaged-categories", json={**_TAX_CATEGORY, "name": name}, headers=headers)
        paths.append(f"/tax-advantaged-categories/{category.json()['id']}/limits")
        assert (await client.post(paths[-1], json=_LIMIT, headers=headers)).status_code == 201
    theirs = await client.post("/tax-advantaged-categories", json=_TAX_CATEGORY, headers=other_headers)
    assert (
        await client.post(f"/tax-advantaged-categories/{theirs.json()['id']}/limits", json=_LIMIT, headers=other_headers)
    ).status_code == 201
    asked = install_check()

    added = await client.post(paths[0], json={**_LIMIT, "year": 2027}, headers=headers)

    assert added.status_code == 201, added.text
    assert [(request.held, request.adding) for request in asked if request.kind == AllowanceKind.TAX_ADVANTAGED_CATEGORY_LIMIT] == [(2, 1)]
