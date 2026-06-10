
from tests.routes.budgets._helpers import (
    NONEXISTENT_ID,
    _create_base_budget,
    _create_budget_instance,
    _create_category,
    _create_group,
    _create_second_user,
)
from tests.routes.support import _create_user, _get_auth_header

# --- DELETE /budgets/{budget_id} ---


async def test_delete_budget_returns_204(client):
    """Owner can delete their instance; a subsequent GET returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.delete(f"/budgets/{instance_id}", headers=headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/budgets/{instance_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_budget_does_not_delete_base(client):
    """Deleting a single instance leaves the parent base budget intact."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]
    original_base = base_resp.json()
    instance_resp = await _create_budget_instance(client, headers, base_budget_id)
    instance_id = instance_resp.json()["id"]

    del_resp = await client.delete(f"/budgets/{instance_id}", headers=headers)
    assert del_resp.status_code == 204

    base_after = (await client.get(f"/base-budgets/{base_budget_id}", headers=headers)).json()
    # Field-by-field assertions surface a clearer failure than a dict-equality diff
    assert base_after["id"] == original_base["id"]
    assert base_after["name"] == original_base["name"]
    assert base_after["currency"] == original_base["currency"]
    assert base_after["category_ids"] == original_base["category_ids"]
    assert base_after["recurrence_freq"] == original_base["recurrence_freq"]
    assert base_after["instance_length"] == original_base["instance_length"]
    assert base_after["recurs"] == original_base["recurs"]
    assert base_after["created_at"] == original_base["created_at"]


async def test_delete_budget_preserves_base_tracked_categories(client):
    """Deleting an instance must not cascade upward into the base's tracked-category rows."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_a = await _create_category(client, headers, name="Test Category A")
    cat_b = await _create_category(client, headers, name="Test Category B")
    base_resp = await _create_base_budget(client, headers, category_ids=[cat_a, cat_b])
    base_budget_id = base_resp.json()["id"]
    original_category_ids = sorted(base_resp.json()["category_ids"])

    instance_resp = await _create_budget_instance(client, headers, base_budget_id)
    instance_id = instance_resp.json()["id"]

    del_resp = await client.delete(f"/budgets/{instance_id}", headers=headers)
    assert del_resp.status_code == 204

    base_after = (await client.get(f"/base-budgets/{base_budget_id}", headers=headers)).json()
    assert sorted(base_after["category_ids"]) == original_category_ids


async def test_delete_budget_does_not_delete_sibling_instances(client):
    """Deleting one instance leaves siblings under the same base intact and unmutated."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]
    march = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-03-01",
    )
    april = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-04-01",
        overall_limit=200000,
    )

    del_resp = await client.delete(f"/budgets/{march.json()['id']}", headers=headers)
    assert del_resp.status_code == 204

    survivor = await client.get(f"/budgets/{april.json()['id']}", headers=headers)
    assert survivor.status_code == 200
    data = survivor.json()
    assert data["period_start"] == "2026-04-01"
    assert data["period_end"] == "2026-04-30"
    assert data["overall_limit"] == 200000


async def test_delete_budget_twice_returns_404(client):
    """Deleting the same instance twice — first 204, second 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    first = await client.delete(f"/budgets/{instance_id}", headers=headers)
    assert first.status_code == 204

    second = await client.delete(f"/budgets/{instance_id}", headers=headers)
    assert second.status_code == 404
    assert second.json()["detail"] == "Budget not found"


async def test_delete_budget_nonexistent_returns_404(client):
    """DELETE with a non-existent instance ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.delete(f"/budgets/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_delete_budget_other_users_returns_404(client):
    """User cannot delete another user's personal instance — 404, instance preserved."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.delete(f"/budgets/{instance_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"

    get_resp = await client.get(f"/budgets/{instance_id}", headers=headers)
    assert get_resp.status_code == 200


async def test_delete_group_budget_as_admin(client):
    """Admin can delete a group instance."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.delete(f"/budgets/{instance_id}", headers=headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/budgets/{instance_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_group_budget_as_non_admin_without_permission_returns_404(client):
    """Non-admin member without a permission row cannot delete — 404, instance preserved."""
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

    resp = await client.delete(f"/budgets/{instance_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"

    get_resp = await client.get(f"/budgets/{instance_id}", headers=headers)
    assert get_resp.status_code == 200


async def test_delete_group_budget_as_non_member_returns_404(client):
    """A user who is not a group member cannot delete — 404, instance preserved."""
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

    resp = await client.delete(f"/budgets/{instance_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"

    get_resp = await client.get(f"/budgets/{instance_id}", headers=headers)
    assert get_resp.status_code == 200


async def test_delete_group_budget_with_read_permission_returns_403(client):
    """Non-admin with READ permission cannot delete — 403, instance preserved."""
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

    resp = await client.delete(f"/budgets/{instance_id}", headers=other_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"

    get_resp = await client.get(f"/budgets/{instance_id}", headers=headers)
    assert get_resp.status_code == 200


async def test_delete_group_budget_with_write_permission_returns_403(client):
    """Non-admin with WRITE permission cannot delete — 403, instance preserved."""
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

    resp = await client.delete(f"/budgets/{instance_id}", headers=other_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"

    get_resp = await client.get(f"/budgets/{instance_id}", headers=headers)
    assert get_resp.status_code == 200


async def test_delete_group_budget_with_admin_permission(client):
    """Non-admin member with explicit ADMIN permission can delete the instance."""
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
        json={"user_id": other_user_id, "level": "admin"},
        headers=headers,
    )

    resp = await client.delete(f"/budgets/{instance_id}", headers=other_headers)

    assert resp.status_code == 204

    # The instance is gone (verified from the owner's perspective)
    get_resp = await client.get(f"/budgets/{instance_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_group_budget_as_admin_of_different_group_returns_404(client):
    """Admin of group A cannot DELETE an instance belonging to group B — pins the group_id filter."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    # Other user creates their own group (so they're an admin of group B)
    other_group_id = await _create_group(client, other_headers)
    other_group_cat_id = await _create_category(
        client, other_headers, name="Other Group Cat", group_id=other_group_id,
    )
    await _create_base_budget(
        client, other_headers,
        group_id=other_group_id, category_ids=[other_group_cat_id],
    )

    # Original user creates group A and an instance the cross-admin shouldn't be able to delete
    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.delete(f"/budgets/{instance_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"

    # Side-effect pin: the instance still exists from the owner's perspective
    get_resp = await client.get(f"/budgets/{instance_id}", headers=headers)
    assert get_resp.status_code == 200


async def test_delete_budget_with_base_budget_uuid_returns_404(client):
    """DELETE /budgets/{base_budget_id} returns 404 — base IDs and instance IDs are distinct namespaces."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]
    instance_resp = await _create_budget_instance(client, headers, base_budget_id)
    instance_id = instance_resp.json()["id"]

    # Probe DELETE with the BASE UUID — must not resolve
    resp = await client.delete(f"/budgets/{base_budget_id}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"

    # Side-effect pin: the actual instance still exists
    get_resp = await client.get(f"/budgets/{instance_id}", headers=headers)
    assert get_resp.status_code == 200


async def test_delete_budget_unauthenticated_returns_401(client):
    """DELETE on a real instance without auth returns 401 (auth runs before DB lookup)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.delete(f"/budgets/{instance_id}")

    assert resp.status_code == 401
