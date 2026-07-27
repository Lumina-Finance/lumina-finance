
from tests.routes.budgets._helpers import (
    NONEXISTENT_ID,
    _create_base_budget,
    _create_budget_instance,
    _create_category,
    _create_group,
    _create_second_user,
)
from tests.routes.support import _create_user, _get_auth_header

# --- PATCH /budgets/{budget_id} ---


async def test_update_budget_overall_limit_returns_200(client):
    """Owner can update overall_limit alone; created_at stays pinned."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]
    original_created_at = instance_resp.json()["created_at"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": 250000},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["overall_limit"] == 250000
    assert resp.json()["created_at"] == original_created_at


async def test_update_budget_empty_body_returns_200(client):
    """Empty PATCH body returns the stored instance unchanged in every field."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    original = instance_resp.json()

    resp = await client.patch(
        f"/budgets/{original['id']}",
        json={},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == original


async def test_update_budget_zero_overall_limit_returns_422(client):
    """PATCH with overall_limit=0 is rejected at the Pydantic layer (gt=0)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": 0},
        headers=headers,
    )

    assert resp.status_code == 422
    # Pydantic 422 — detail is a list of errors, with `loc` pointing at the field
    detail = resp.json()["detail"]
    assert isinstance(detail, list)
    assert any("overall_limit" in err["loc"] for err in detail)


async def test_update_budget_negative_overall_limit_returns_422(client):
    """PATCH with a negative overall_limit is rejected at the Pydantic layer (gt=0)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": -100},
        headers=headers,
    )

    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert isinstance(detail, list)
    assert any("overall_limit" in err["loc"] for err in detail)


async def test_update_budget_does_not_mutate_base_budget(client):
    """PATCHing an instance leaves the parent base budget untouched."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]
    original_base = base_resp.json()
    instance_resp = await _create_budget_instance(client, headers, base_budget_id)
    instance_id = instance_resp.json()["id"]

    patch_resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": 999999},
        headers=headers,
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["overall_limit"] == 999999

    base_after = (await client.get(f"/base-budgets/{base_budget_id}", headers=headers)).json()
    assert base_after == original_base


async def test_update_budget_nonexistent_returns_404(client):
    """PATCH with a non-existent budget ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(
        f"/budgets/{NONEXISTENT_ID}",
        json={"overall_limit": 50000},
        headers=headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_update_budget_other_users_returns_404(client):
    """User cannot PATCH another user's personal instance."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": 99},
        headers=other_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_update_group_budget_as_admin(client):
    """Admin can PATCH a group instance."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": 250000},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["overall_limit"] == 250000


async def test_update_group_budget_as_non_admin_without_permission_returns_404(client):
    """Non-admin group member without a permission row cannot PATCH the instance."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": 99},
        headers=other_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_update_group_budget_as_non_member_returns_404(client):
    """A user who is not a group member cannot PATCH the instance."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": 99},
        headers=other_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_update_group_budget_with_read_permission_returns_403(client):
    """Non-admin with READ permission cannot PATCH (requires ADMIN)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = base_resp.json()["id"]
    instance_resp = await _create_budget_instance(client, headers, base_budget_id)
    instance_id = instance_resp.json()["id"]

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "read"},
        headers=headers,
    )

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": 99},
        headers=other_headers,
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_update_group_budget_with_write_permission_returns_403(client):
    """Non-admin with WRITE permission cannot PATCH (requires ADMIN)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = base_resp.json()["id"]
    instance_resp = await _create_budget_instance(client, headers, base_budget_id)
    instance_id = instance_resp.json()["id"]

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "write"},
        headers=headers,
    )

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": 99},
        headers=other_headers,
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_update_budget_unauthenticated_returns_401(client):
    """PATCH without auth returns 401."""
    resp = await client.patch(
        f"/budgets/{NONEXISTENT_ID}",
        json={"overall_limit": 99},
    )

    assert resp.status_code == 401


async def test_update_budget_null_overall_limit_returns_422(client):
    """PATCH with explicit null overall_limit is rejected — non-nullable field."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": None},
        headers=headers,
    )

    assert resp.status_code == 422
    assert "overall_limit" in resp.json()["detail"]


async def test_update_budget_ignores_unknown_fields(client):
    """Unknown extra fields are dropped by Pydantic — no leakage onto unintended columns."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]
    instance_resp = await _create_budget_instance(client, headers, base_budget_id)
    instance_id = instance_resp.json()["id"]

    # Try to smuggle in base_budget_id and an arbitrary extra field
    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={
            "base_budget_id": NONEXISTENT_ID,
            "junk_field": "ignored",
            "overall_limit": 55555,
        },
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    # Known fields applied
    assert data["overall_limit"] == 55555
    # Unknown smuggled field had no effect
    assert data["base_budget_id"] == base_budget_id


# --- PATCH /budgets/{budget_id} — archived base budget guard ---


async def test_update_budget_overall_limit_returns_409_for_archived_base_budget(client):
    """Updating overall_limit on an instance whose base budget is archived is rejected

    A non-archived base budget's instance is patched in the same test as a control, proving
    the 409 comes from the archived flag and not some other blocker
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    # A single tracked category is reused across both base budgets to avoid the per-owner unique name collision
    cat_id = await _create_category(client, headers)

    archived_base_resp = await _create_base_budget(client, headers, category_ids=[cat_id])
    archived_base_id = archived_base_resp.json()["id"]
    archived_instance_id = (await _create_budget_instance(
        client, headers, archived_base_id,
    )).json()["id"]
    await client.patch(
        f"/base-budgets/{archived_base_id}", json={"is_archived": True}, headers=headers,
    )

    active_base_resp = await _create_base_budget(
        client, headers, name="Active Budget", category_ids=[cat_id],
    )
    active_instance_id = (await _create_budget_instance(
        client, headers, active_base_resp.json()["id"],
    )).json()["id"]

    archived_resp = await client.patch(
        f"/budgets/{archived_instance_id}",
        json={"overall_limit": 250000},
        headers=headers,
    )
    active_resp = await client.patch(
        f"/budgets/{active_instance_id}",
        json={"overall_limit": 250000},
        headers=headers,
    )

    assert archived_resp.status_code == 409
    assert archived_resp.json()["detail"] == "Cannot update a budget instance for an archived base budget"
    assert active_resp.status_code == 200
    assert active_resp.json()["overall_limit"] == 250000
