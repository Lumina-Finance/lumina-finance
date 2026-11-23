"""What the tax-advantaged category routes do with one the installed check keeps read-only, as its currency is another than the user's main one

Each category says why it is read-only. Nothing on it or its yearly limits changes, while it can
always be deleted
"""

import pytest

from tests.routes.read_only_records._helpers import _refuse_other_currencies, _sign_up_holding_usd
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON

_LIMIT = {"year": 2026, "contribution_limit": 700_000}


async def _new_category(client, headers, name: str = "Roth IRA", currency: str = "USD", **fields) -> str:
    """Create a tax-free category, in US dollars unless told otherwise, and return its id"""
    created = await client.post(
        "/tax-advantaged-categories", json={"name": name, "tax_treatment": "tax_free", "currency": currency, **fields}, headers=headers
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


async def _limits(client, headers, category_id: str) -> list[tuple[int, int]]:
    """Return each of the category's yearly limits as its year and contribution limit"""
    listed = await client.get(f"/tax-advantaged-categories/{category_id}/limits", headers=headers)
    assert listed.status_code == 200, listed.text
    return [(limit["year"], limit["contribution_limit"]) for limit in listed.json()]


async def test_list_says_why_only_a_personal_category_in_another_currency_is_read_only(client):
    """A group's US category and a Canadian one can change"""
    headers = await _sign_up_holding_usd(client)
    group_id = (await client.post("/groups", json={"name": "Household"}, headers=headers)).json()["id"]
    await _new_category(client, headers)
    await _new_category(client, headers, "Joint 529", group_id=group_id)
    await _new_category(client, headers, "TFSA", currency="CAD")
    _refuse_other_currencies()

    listed = await client.get("/tax-advantaged-categories", headers=headers)

    assert listed.status_code == 200, listed.text
    assert {row["name"]: row["read_only_reason"] for row in listed.json()} == {"Roth IRA": ALLOWANCE_REASON, "Joint 529": None, "TFSA": None}


async def test_edit_read_only_category_is_refused_and_changes_nothing(client):
    """The name stays as it was"""
    headers = await _sign_up_holding_usd(client)
    category_id = await _new_category(client, headers)
    _refuse_other_currencies()

    response = await client.patch(f"/tax-advantaged-categories/{category_id}", json={"name": "Retirement"}, headers=headers)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert (await client.get(f"/tax-advantaged-categories/{category_id}", headers=headers)).json()["name"] == "Roth IRA"


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        pytest.param("POST", "limits", {"year": 2027, "contribution_limit": 700_000}, id="add"),
        pytest.param("PATCH", "limits/2026", {"contribution_limit": 800_000}, id="edit"),
        pytest.param("DELETE", "limits/2026", None, id="delete"),
    ],
)
async def test_yearly_limit_change_on_a_read_only_category_is_refused_and_keeps_its_limits(client, method, path, body):
    """The 2026 limit stays the only one, at $7,000"""
    headers = await _sign_up_holding_usd(client)
    category_id = await _new_category(client, headers)
    added = await client.post(f"/tax-advantaged-categories/{category_id}/limits", json=_LIMIT, headers=headers)
    assert added.status_code == 201, added.text
    _refuse_other_currencies()

    response = await client.request(method, f"/tax-advantaged-categories/{category_id}/{path}", json=body, headers=headers)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert await _limits(client, headers, category_id) == [(2026, 700_000)]


async def test_delete_read_only_category_goes_through(client):
    """The category is gone"""
    headers = await _sign_up_holding_usd(client)
    category_id = await _new_category(client, headers)
    _refuse_other_currencies()

    response = await client.delete(f"/tax-advantaged-categories/{category_id}", headers=headers)

    assert response.status_code == 204, response.text
    assert (await client.get("/tax-advantaged-categories", headers=headers)).json() == []
