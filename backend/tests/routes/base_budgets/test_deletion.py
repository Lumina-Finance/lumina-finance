

from tests.routes.base_budgets._helpers import (
    NONEXISTENT_ID,
    _create_base_budget,
    _create_category,
    _create_group,
    _create_second_user,
)
from tests.routes.support import _create_user, _get_auth_header

# --- DELETE /base-budgets/{base_budget_id} ---


async def test_delete_base_budget_returns_204(client):
    """Owner can delete their personal base budget; a subsequent GET returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    resp = await client.delete(f"/base-budgets/{base_budget_id}", headers=headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_base_budget_with_tracked_categories_succeeds(client):
    """Deleting a base budget with tracked categories succeeds via the FK cascade."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id = await _create_category(client, headers)
    create_resp = await _create_base_budget(client, headers, category_ids=[cat_id])
    base_budget_id = create_resp.json()["id"]

    resp = await client.delete(f"/base-budgets/{base_budget_id}", headers=headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_group_base_budget_with_permissions_cascades(client):
    """Deleting a base budget cascades to its permission rows (FK cascade, not 500)."""
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
    create_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "read"},
        headers=headers,
    )

    resp = await client.delete(f"/base-budgets/{base_budget_id}", headers=headers)

    assert resp.status_code == 204

    # Verify the member can no longer see the base budget
    get_resp = await client.get(f"/base-budgets/{base_budget_id}", headers=other_headers)
    assert get_resp.status_code == 404


async def test_delete_base_budget_twice_returns_404(client):
    """Deleting the same base budget twice — first call 204, second call 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    first = await client.delete(f"/base-budgets/{base_budget_id}", headers=headers)
    assert first.status_code == 204

    second = await client.delete(f"/base-budgets/{base_budget_id}", headers=headers)
    assert second.status_code == 404
    assert second.json()["detail"] == "Budget not found"


async def test_delete_base_budget_nonexistent_returns_404(client):
    """DELETE with a non-existent base budget ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.delete(f"/base-budgets/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_delete_base_budget_other_users_returns_404(client):
    """User cannot delete another user's personal base budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    resp = await client.delete(f"/base-budgets/{base_budget_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"

    # Confirm the budget still exists from the owner's perspective
    get_resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)
    assert get_resp.status_code == 200


async def test_delete_group_base_budget_as_admin(client):
    """Admin can delete a group base budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    create_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    resp = await client.delete(f"/base-budgets/{base_budget_id}", headers=headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_group_base_budget_as_non_admin_without_permission_returns_404(client):
    """Non-admin member without a permission row cannot delete — 404, base budget preserved."""
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
    create_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    resp = await client.delete(f"/base-budgets/{base_budget_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"

    # The base budget must still exist from the admin's perspective
    get_resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)
    assert get_resp.status_code == 200


async def test_delete_group_base_budget_as_non_member_returns_404(client):
    """A user who is not a group member cannot delete — 404, base budget preserved."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    create_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    resp = await client.delete(f"/base-budgets/{base_budget_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"

    get_resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)
    assert get_resp.status_code == 200


async def test_delete_group_base_budget_with_read_permission_returns_403(client):
    """Non-admin with READ permission cannot delete — 403, base budget preserved."""
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
    create_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "read"},
        headers=headers,
    )

    resp = await client.delete(f"/base-budgets/{base_budget_id}", headers=other_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"

    get_resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)
    assert get_resp.status_code == 200


async def test_delete_group_base_budget_with_write_permission_returns_403(client):
    """Non-admin with WRITE permission cannot delete — 403, base budget preserved."""
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
    create_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "write"},
        headers=headers,
    )

    resp = await client.delete(f"/base-budgets/{base_budget_id}", headers=other_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"

    get_resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)
    assert get_resp.status_code == 200


async def test_delete_base_budget_unauthenticated_returns_401(client):
    """DELETE without auth returns 401."""
    resp = await client.delete(f"/base-budgets/{NONEXISTENT_ID}")

    assert resp.status_code == 401
