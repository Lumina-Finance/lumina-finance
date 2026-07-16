

from tests.routes.base_budgets._helpers import (
    _create_base_budget,
    _create_category,
    _create_group,
    _create_second_user,
)
from tests.routes.support import _create_user, _get_auth_header

# --- GET /base-budgets ---


async def test_list_base_budgets_returns_200(client):
    """User with base budgets gets them back alphabetically ordered by name."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    cat_id = await _create_category(client, headers)

    await _create_base_budget(client, headers, name="March Budget", category_ids=[cat_id])
    await _create_base_budget(client, headers, name="April Budget", category_ids=[cat_id])

    resp = await client.get("/base-budgets", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert [b["name"] for b in data] == ["April Budget", "March Budget"]


async def test_list_base_budgets_includes_archived(client):
    """Archiving a base budget does not hide it from the listing."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    await client.patch(
        f"/base-budgets/{base_budget_id}", json={"is_archived": True}, headers=headers,
    )

    resp = await client.get("/base-budgets", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["id"] == base_budget_id
    assert data[0]["is_archived"] is True


async def test_list_base_budgets_empty(client):
    """User with no base budgets gets an empty list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/base-budgets", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_base_budgets_includes_category_ids(client):
    """Listed base budgets include their currently-active tracked category IDs."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id = await _create_category(client, headers)
    await _create_base_budget(client, headers, category_ids=[cat_id])

    resp = await client.get("/base-budgets", headers=headers)

    assert resp.status_code == 200
    assert resp.json()[0]["category_ids"] == [cat_id]


async def test_list_base_budgets_includes_group_base_budgets(client):
    """User sees both personal and group base budgets they administer."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    await _create_base_budget(client, headers, name="Personal Budget")
    await _create_base_budget(
        client, headers, name="Family Budget", group_id=group_id, category_ids=[group_cat_id],
    )

    resp = await client.get("/base-budgets", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert {b["name"] for b in data} == {"Personal Budget", "Family Budget"}


async def test_list_base_budgets_group_member_without_permission_excluded(client):
    """Non-admin group member without explicit permission does not see group base budgets."""
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
    await _create_base_budget(
        client, headers, name="Family Budget", group_id=group_id, category_ids=[group_cat_id],
    )

    resp = await client.get("/base-budgets", headers=other_headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_base_budgets_group_member_with_permission(client):
    """Non-admin group member with READ permission sees the group base budget."""
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
        client, headers, name="Family Budget", group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    # Grant READ permission
    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "read"},
        headers=headers,
    )

    resp = await client.get("/base-budgets", headers=other_headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["name"] == "Family Budget"


async def test_list_base_budgets_excludes_other_users_base_budgets(client):
    """User does not see another user's personal base budgets."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    await _create_base_budget(client, headers, name="My Budget")

    resp = await client.get("/base-budgets", headers=other_headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_base_budgets_no_duplicates_for_group_base_budget(client):
    """Group base budget appears once even though the user is both owner and member."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    await _create_base_budget(
        client, headers, name="Family Budget", group_id=group_id, category_ids=[group_cat_id],
    )

    resp = await client.get("/base-budgets", headers=headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["name"] == "Family Budget"


async def test_list_base_budgets_excludes_soft_deleted_categories(client):
    """Listed base budgets only include currently-active tracked categories."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_keep = await _create_category(client, headers, name="Test Groceries")
    cat_remove = await _create_category(client, headers, name="Test Takeout")
    create_resp = await _create_base_budget(
        client, headers, category_ids=[cat_keep, cat_remove],
    )
    base_budget_id = create_resp.json()["id"]

    # Soft-delete `cat_remove` by PATCHing to the remaining category only
    await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"category_ids": [cat_keep]},
        headers=headers,
    )

    resp = await client.get("/base-budgets", headers=headers)

    assert resp.status_code == 200
    assert resp.json()[0]["category_ids"] == [cat_keep]


async def test_list_base_budgets_promoted_admin_sees_group_base_budgets(client):
    """A member promoted to admin (not the group owner) sees the group's base budgets."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    # Add the second user as a member, then promote to admin
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )
    await client.patch(
        f"/groups/{group_id}/members/{other_user_id}",
        json={"is_admin": True},
        headers=headers,
    )

    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    await _create_base_budget(
        client, headers, name="Family Budget", group_id=group_id, category_ids=[group_cat_id],
    )

    resp = await client.get("/base-budgets", headers=other_headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["name"] == "Family Budget"


async def test_list_base_budgets_unauthenticated_returns_401(client):
    """Listing base budgets without auth returns 401."""
    resp = await client.get("/base-budgets")

    assert resp.status_code == 401
