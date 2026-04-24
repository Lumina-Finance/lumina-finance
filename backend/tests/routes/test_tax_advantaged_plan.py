from datetime import UTC, datetime

from tests.routes.conftest import _create_user, _get_auth_header

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"


async def _create_second_user(client):
    """Sign up a second user."""
    return await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "securepassword123",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })


async def _create_group(client, headers, **overrides):
    """Create a group."""
    return await client.post("/groups", json={"name": "Household", **overrides}, headers=headers)


async def _create_plan(client, headers, **overrides):
    """Create a tax-advantaged plan."""
    payload = {
        "name": "TFSA",
        "tax_treatment": "tax_free",
        "currency": "CAD",
        **overrides,
    }
    return await client.post("/tax-advantaged-plans", json=payload, headers=headers)


async def test_create_plan_returns_201_with_shape(client):
    """Owner can create a personal plan."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    resp = await _create_plan(client, headers, lifetime_contribution_limit=9_500_000)

    assert resp.status_code == 201
    data = resp.json()
    assert data["plan_owner_user_id"] == user_id
    assert data["group_id"] is None
    assert data["name"] == "TFSA"
    assert data["tax_treatment"] == "tax_free"
    assert data["currency"] == "CAD"
    assert data["lifetime_contribution_limit"] == 9_500_000
    assert data["current_year_contribution_limit"] is None
    assert data["current_year_withdrawal_limit"] is None
    assert data["created_at"] is not None


async def test_create_plan_rejects_taxable_treatment(client):
    """Taxable is not a plan treatment."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_plan(client, headers, tax_treatment="taxable")

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Tax-advantaged plans require a non-taxable tax treatment"


async def test_create_group_scoped_plan_requires_membership(client):
    """Only group members can create a plan in that group context."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    group_id = (await _create_group(client, headers)).json()["id"]
    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await _create_plan(client, other_headers, group_id=group_id)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Group not found"


async def test_list_plans_only_returns_owned_plans(client):
    """Users only list plans they own."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _create_plan(client, headers, name="Mine")

    other_headers = _get_auth_header(await _create_second_user(client))
    await _create_plan(client, other_headers, name="Theirs")

    resp = await client.get("/tax-advantaged-plans", headers=headers)

    assert resp.status_code == 200
    assert [row["name"] for row in resp.json()] == ["Mine"]


async def test_other_user_cannot_read_or_update_plan(client):
    """Plan owner is the only manager."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    plan_id = (await _create_plan(client, headers)).json()["id"]
    other_headers = _get_auth_header(await _create_second_user(client))

    get_resp = await client.get(f"/tax-advantaged-plans/{plan_id}", headers=other_headers)
    patch_resp = await client.patch(f"/tax-advantaged-plans/{plan_id}", json={"name": "Nope"}, headers=other_headers)

    assert get_resp.status_code == 404
    assert patch_resp.status_code == 404


async def test_owner_can_update_and_delete_plan(client):
    """Owner can update mutable plan fields and delete the plan."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    plan_id = (await _create_plan(client, headers)).json()["id"]

    patch = await client.patch(
        f"/tax-advantaged-plans/{plan_id}",
        json={"name": "RRSP", "tax_treatment": "tax_deferred", "lifetime_contribution_limit": 1_000_000},
        headers=headers,
    )
    delete = await client.delete(f"/tax-advantaged-plans/{plan_id}", headers=headers)
    get_after_delete = await client.get(f"/tax-advantaged-plans/{plan_id}", headers=headers)

    assert patch.status_code == 200
    assert patch.json()["name"] == "RRSP"
    assert patch.json()["tax_treatment"] == "tax_deferred"
    assert patch.json()["lifetime_contribution_limit"] == 1_000_000
    assert delete.status_code == 204
    assert get_after_delete.status_code == 404


async def test_plan_limits_crud(client):
    """Owner can manage yearly plan limits."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    plan_id = (await _create_plan(client, headers)).json()["id"]

    create = await client.post(
        f"/tax-advantaged-plans/{plan_id}/limits",
        json={"year": 2026, "contribution_limit": 700_000, "withdrawal_limit": 200_000},
        headers=headers,
    )
    duplicate = await client.post(
        f"/tax-advantaged-plans/{plan_id}/limits",
        json={"year": 2026, "contribution_limit": 800_000},
        headers=headers,
    )
    patch = await client.patch(
        f"/tax-advantaged-plans/{plan_id}/limits/2026",
        json={"withdrawal_limit": None},
        headers=headers,
    )
    listed = await client.get(f"/tax-advantaged-plans/{plan_id}/limits", headers=headers)
    delete = await client.delete(f"/tax-advantaged-plans/{plan_id}/limits/2026", headers=headers)
    empty = await client.get(f"/tax-advantaged-plans/{plan_id}/limits", headers=headers)

    assert create.status_code == 201
    assert create.json()["contribution_limit"] == 700_000
    assert duplicate.status_code == 409
    assert patch.status_code == 200
    assert patch.json()["withdrawal_limit"] is None
    assert listed.status_code == 200
    assert [row["year"] for row in listed.json()] == [2026]
    assert delete.status_code == 204
    assert empty.json() == []


async def test_plan_detail_surfaces_current_year_limits(client):
    """Current-year limits are exposed on plan detail."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    plan_id = (await _create_plan(client, headers)).json()["id"]
    current_year = datetime.now(UTC).year
    await client.post(
        f"/tax-advantaged-plans/{plan_id}/limits",
        json={"year": current_year, "contribution_limit": 700_000},
        headers=headers,
    )

    resp = await client.get(f"/tax-advantaged-plans/{plan_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["current_year_contribution_limit"] == 700_000
    assert resp.json()["current_year_withdrawal_limit"] is None
