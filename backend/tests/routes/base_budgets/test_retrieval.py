

from tests.routes.base_budgets._helpers import (
    NONEXISTENT_ID,
    _create_base_budget,
    _create_category,
    _create_group,
    _create_second_user,
)
from tests.routes.support import _create_user, _get_auth_header

# --- GET /base-budgets/{base_budget_id} ---


async def test_get_base_budget_returns_200(client):
    """Owner can retrieve their personal base budget with the full response body populated."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    cat_id = await _create_category(client, headers)
    create_resp = await _create_base_budget(client, headers, category_ids=[cat_id])
    base_budget_id = create_resp.json()["id"]

    resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == base_budget_id
    assert data["name"] == "March Budget"
    assert data["owner_id"] == user_id
    assert data["group_id"] is None
    assert data["currency"] == "CAD"
    assert data["recurrence_freq"] == "monthly"
    assert data["instance_length"] == 1
    assert data["recurrence_dom"] == 1
    assert data["recurs"] is False
    assert data["created_at"] is not None
    assert data["category_ids"] == [cat_id]


async def test_get_base_budget_nonexistent_returns_404(client):
    """Non-existent base budget ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/base-budgets/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_get_base_budget_other_users_returns_404(client):
    """User cannot retrieve another user's personal base budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    resp = await client.get(f"/base-budgets/{base_budget_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_get_group_base_budget_as_admin(client):
    """Admin can retrieve a group base budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    create_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == base_budget_id
    assert data["group_id"] == group_id
    assert data["owner_id"] is None


async def test_get_group_base_budget_as_non_admin_without_permission_returns_404(client):
    """Non-admin group member without an explicit permission row returns 404."""
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

    resp = await client.get(f"/base-budgets/{base_budget_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_get_group_base_budget_as_non_member_returns_404(client):
    """A user who is not a group member at all returns 404 — pins the no-membership branch."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    create_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    resp = await client.get(f"/base-budgets/{base_budget_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_get_group_base_budget_with_read_permission(client):
    """Non-admin member with READ permission gets the same response shape the admin sees."""
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

    resp = await client.get(f"/base-budgets/{base_budget_id}", headers=other_headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == base_budget_id
    assert data["group_id"] == group_id
    assert data["owner_id"] is None
    assert data["category_ids"] == [group_cat_id]


async def test_get_base_budget_excludes_soft_deleted_categories(client):
    """GET returns only currently-active tracked categories."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_keep = await _create_category(client, headers, name="Test Groceries")
    cat_remove = await _create_category(client, headers, name="Test Takeout")
    create_resp = await _create_base_budget(
        client, headers, category_ids=[cat_keep, cat_remove],
    )
    base_budget_id = create_resp.json()["id"]

    await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"category_ids": [cat_keep]},
        headers=headers,
    )

    resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["category_ids"] == [cat_keep]


async def test_get_base_budget_unauthenticated_returns_401(client):
    """Getting a base budget without auth returns 401."""
    resp = await client.get(f"/base-budgets/{NONEXISTENT_ID}")

    assert resp.status_code == 401
