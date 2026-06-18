from tests.routes.support import _create_user, _get_auth_header

# --- Helpers ---

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"


async def _create_second_user(client, email="other@example.com", first_name="Other"):
    """Sign up a second user and return (auth_headers, user_id)."""
    resp = await client.post("/auth/signup", json={
        "email": email,
        "password": "securepassword123",
        "first_name": first_name,
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    return _get_auth_header(resp), resp.json()["user"]["id"]


async def _create_group(client, headers):
    """Create a group and return its ID."""
    resp = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    return resp.json()["id"]


async def _create_category(client, headers, **overrides):
    """Create a category and return its ID."""
    payload = {"name": "Test Groceries", "kind": "expense", **overrides}
    resp = await client.post("/categories", json=payload, headers=headers)
    return resp.json()["id"]


async def _create_group_base_budget(client, headers, group_id, *, name="Family Budget", category_name="Shared"):
    """Create a group-scoped base budget and return its ID.

    Caller can override `name` and `category_name` so multiple budgets can be
    created in the same group without tripping the per-group uniqueness on
    either base budget names or category names.
    """
    cat_id = await _create_category(client, headers, name=category_name, group_id=group_id)
    resp = await client.post("/base-budgets", json={
        "name": name,
        "currency": "CAD",
        "group_id": group_id,
        "recurrence_freq": "monthly",
        "recurrence_dom": 1,
        "category_ids": [cat_id],
    }, headers=headers)
    return resp.json()["id"]


async def _create_personal_base_budget(client, headers):
    """Create a personal base budget and return its ID."""
    cat_id = await _create_category(client, headers)
    resp = await client.post("/base-budgets", json={
        "name": "Personal Budget",
        "currency": "CAD",
        "recurrence_freq": "monthly",
        "recurrence_dom": 1,
        "category_ids": [cat_id],
    }, headers=headers)
    return resp.json()["id"]


async def _setup_group_with_member_and_base_budget(client):
    """Create a group with an admin (owner), a regular member, and a group base budget.

    Returns:
        Tuple of (admin_headers, member_headers, member_user_id, group_id, base_budget_id).
    """
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)
    group_id = await _create_group(client, admin_headers)

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )

    base_budget_id = await _create_group_base_budget(client, admin_headers, group_id)

    return admin_headers, member_headers, member_user_id, group_id, base_budget_id


# --- POST /base-budgets/{base_budget_id}/permissions ---


async def test_grant_base_budget_permission_returns_201(client):
    """Admin can grant READ permission to a non-admin group member."""
    admin_headers, _, member_user_id, group_id, base_budget_id = (
        await _setup_group_with_member_and_base_budget(client)
    )

    resp = await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["user_id"] == member_user_id
    assert data["base_budget_id"] == base_budget_id
    assert data["group_id"] == group_id
    assert data["level"] == "read"
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_grant_base_budget_permission_write_level(client):
    """Admin can grant WRITE permission."""
    admin_headers, _, member_user_id, _, base_budget_id = (
        await _setup_group_with_member_and_base_budget(client)
    )

    resp = await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": member_user_id, "level": "write"},
        headers=admin_headers,
    )

    assert resp.status_code == 201
    assert resp.json()["level"] == "write"


async def test_grant_base_budget_permission_admin_level(client):
    """Admin can grant ADMIN permission (full control over the base budget)."""
    admin_headers, _, member_user_id, _, base_budget_id = (
        await _setup_group_with_member_and_base_budget(client)
    )

    resp = await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": member_user_id, "level": "admin"},
        headers=admin_headers,
    )

    assert resp.status_code == 201
    assert resp.json()["level"] == "admin"


async def test_grant_base_budget_permission_updating_level(client):
    """Elevating a member's permission updates the row in place: same id, same created_at, no duplicate."""
    admin_headers, _, member_user_id, _, base_budget_id = (
        await _setup_group_with_member_and_base_budget(client)
    )

    resp1 = await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    assert resp1.status_code == 201
    permission_id = resp1.json()["id"]
    original_created_at = resp1.json()["created_at"]

    resp2 = await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": member_user_id, "level": "write"},
        headers=admin_headers,
    )

    assert resp2.status_code == 201
    assert resp2.json()["id"] == permission_id
    assert resp2.json()["level"] == "write"
    # created_at must be preserved across an update-in-place
    assert resp2.json()["created_at"] == original_created_at

    # Exactly one row exists — no leaked INSERT alongside the UPDATE
    list_resp = await client.get(
        f"/base-budgets/{base_budget_id}/permissions",
        headers=admin_headers,
    )
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1
    assert list_resp.json()[0]["id"] == permission_id
    assert list_resp.json()[0]["level"] == "write"


async def test_grant_base_budget_permission_invalid_level_returns_422(client):
    """Invalid permission level is rejected."""
    admin_headers, _, member_user_id, _, base_budget_id = (
        await _setup_group_with_member_and_base_budget(client)
    )

    resp = await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": member_user_id, "level": "superadmin"},
        headers=admin_headers,
    )

    assert resp.status_code == 422


async def test_grant_base_budget_permission_to_admin_member_returns_422(client):
    """Cannot grant permission to the group creator — admins have implicit full access."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    group_id = await _create_group(client, admin_headers)
    base_budget_id = await _create_group_base_budget(client, admin_headers, group_id)

    resp = await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": user_id, "level": "read"},
        headers=admin_headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Admins have implicit full access"


async def test_grant_base_budget_permission_to_promoted_admin_returns_422(client):
    """Cannot grant permission to a member who was promoted to admin."""
    admin_headers, _, member_user_id, group_id, base_budget_id = (
        await _setup_group_with_member_and_base_budget(client)
    )

    await client.patch(
        f"/groups/{group_id}/members/{member_user_id}",
        json={"is_admin": True},
        headers=admin_headers,
    )

    resp = await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Admins have implicit full access"


async def test_grant_base_budget_permission_to_non_member_returns_422(client):
    """Cannot grant permission to a user who is not a member of the group."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)
    group_id = await _create_group(client, admin_headers)
    base_budget_id = await _create_group_base_budget(client, admin_headers, group_id)

    _, outsider_user_id = await _create_second_user(client)

    resp = await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": outsider_user_id, "level": "read"},
        headers=admin_headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "User is not a member of this group"


async def test_grant_base_budget_permission_nonexistent_base_returns_404(client):
    """Granting on a non-existent base budget returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    _, target_user_id = await _create_second_user(client)

    resp = await client.post(
        f"/base-budgets/{NONEXISTENT_ID}/permissions",
        json={"user_id": target_user_id, "level": "read"},
        headers=headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Base budget not found"


async def test_grant_base_budget_permission_personal_base_returns_404(client):
    """Granting on a personal base budget returns 404 — personal budgets don't accept permissions."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    _, target_user_id = await _create_second_user(client)

    base_budget_id = await _create_personal_base_budget(client, headers)

    resp = await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": target_user_id, "level": "read"},
        headers=headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Base budget not found"


async def test_grant_base_budget_permission_as_non_admin_returns_404(client):
    """A non-admin member cannot see the group base budget, so granting is not disclosed"""
    _, member_headers, _, _, base_budget_id = (
        await _setup_group_with_member_and_base_budget(client)
    )
    _, third_user_id = await _create_second_user(client, email="third@example.com", first_name="Third")

    # Member tries to grant a permission to a third user
    resp = await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": third_user_id, "level": "read"},
        headers=member_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Base budget not found"


async def test_grant_base_budget_permission_as_outsider_returns_404(client):
    """A user who is not a member of the group cannot grant permissions — 404."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)
    group_id = await _create_group(client, admin_headers)
    base_budget_id = await _create_group_base_budget(client, admin_headers, group_id)

    outsider_headers, outsider_user_id = await _create_second_user(client)

    resp = await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": outsider_user_id, "level": "read"},
        headers=outsider_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Base budget not found"


async def test_grant_base_budget_permission_unauthenticated_returns_401(client):
    """POST /base-budgets/{id}/permissions without auth returns 401."""
    resp = await client.post(
        f"/base-budgets/{NONEXISTENT_ID}/permissions",
        json={"user_id": NONEXISTENT_ID, "level": "read"},
    )

    assert resp.status_code == 401


# --- GET /base-budgets/{base_budget_id}/permissions ---


async def test_list_base_budget_permissions_returns_200(client):
    """Admin can list all permissions on a base budget."""
    admin_headers, _, member_user_id, group_id, base_budget_id = (
        await _setup_group_with_member_and_base_budget(client)
    )

    grant_resp = await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": member_user_id, "level": "write"},
        headers=admin_headers,
    )
    assert grant_resp.status_code == 201

    resp = await client.get(
        f"/base-budgets/{base_budget_id}/permissions",
        headers=admin_headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["user_id"] == member_user_id
    assert data[0]["base_budget_id"] == base_budget_id
    assert data[0]["group_id"] == group_id
    assert data[0]["level"] == "write"


async def test_list_base_budget_permissions_empty(client):
    """Listing permissions on a base budget with none returns an empty list."""
    admin_headers, _, _, _, base_budget_id = (
        await _setup_group_with_member_and_base_budget(client)
    )

    resp = await client.get(
        f"/base-budgets/{base_budget_id}/permissions",
        headers=admin_headers,
    )

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_base_budget_permissions_filters_by_user_id(client):
    """The user_id query parameter filters permissions to a single user without dropping the others."""
    admin_headers, _, member_user_id, group_id, base_budget_id = (
        await _setup_group_with_member_and_base_budget(client)
    )
    _, third_user_id = await _create_second_user(
        client, email="third@example.com", first_name="Third",
    )
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": third_user_id},
        headers=admin_headers,
    )

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": third_user_id, "level": "write"},
        headers=admin_headers,
    )

    # Filter to just the third user
    resp = await client.get(
        f"/base-budgets/{base_budget_id}/permissions?user_id={third_user_id}",
        headers=admin_headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["user_id"] == third_user_id
    assert data[0]["level"] == "write"

    # Sanity-check the unfiltered list still has both rows — a regression that
    # filtered-by-default would also produce len==1 for the filtered query
    unfiltered = await client.get(
        f"/base-budgets/{base_budget_id}/permissions",
        headers=admin_headers,
    )
    assert len(unfiltered.json()) == 2


async def test_list_base_budget_permissions_filter_by_user_id_no_matches_returns_empty(client):
    """Filtering by a user with no permission row returns 200 + empty list."""
    admin_headers, _, member_user_id, _, base_budget_id = (
        await _setup_group_with_member_and_base_budget(client)
    )
    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )

    # Filter by a UUID that isn't anywhere in the system
    resp = await client.get(
        f"/base-budgets/{base_budget_id}/permissions?user_id={NONEXISTENT_ID}",
        headers=admin_headers,
    )

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_base_budget_permissions_filter_by_group_member_without_permission_returns_empty(client):
    """Filtering by a real group member who has no permission row returns 200 + empty list."""
    admin_headers, _, _, group_id, base_budget_id = (
        await _setup_group_with_member_and_base_budget(client)
    )
    # Add a third user to the group but never grant them any permission on the base
    _, third_user_id = await _create_second_user(
        client, email="third@example.com", first_name="Third",
    )
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": third_user_id},
        headers=admin_headers,
    )

    resp = await client.get(
        f"/base-budgets/{base_budget_id}/permissions?user_id={third_user_id}",
        headers=admin_headers,
    )

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_base_budget_permissions_orders_by_created_at(client):
    """Permissions are ordered by created_at ascending."""
    admin_headers, _, member_user_id, group_id, base_budget_id = (
        await _setup_group_with_member_and_base_budget(client)
    )
    _, third_user_id = await _create_second_user(
        client, email="third@example.com", first_name="Third",
    )
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": third_user_id},
        headers=admin_headers,
    )

    first = await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    second = await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": third_user_id, "level": "write"},
        headers=admin_headers,
    )

    resp = await client.get(
        f"/base-budgets/{base_budget_id}/permissions",
        headers=admin_headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["id"] == first.json()["id"]
    assert data[1]["id"] == second.json()["id"]


async def test_list_base_budget_permissions_nonexistent_base_returns_404(client):
    """Listing permissions on a non-existent base budget returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(
        f"/base-budgets/{NONEXISTENT_ID}/permissions",
        headers=headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Base budget not found"


async def test_list_base_budget_permissions_personal_base_returns_404(client):
    """Listing permissions on a personal base budget returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_budget_id = await _create_personal_base_budget(client, headers)

    resp = await client.get(
        f"/base-budgets/{base_budget_id}/permissions",
        headers=headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Base budget not found"


async def test_list_base_budget_permissions_as_non_admin_returns_404(client):
    """A non-admin member cannot see the group base budget, so its permissions are not disclosed"""
    _, member_headers, _, _, base_budget_id = (
        await _setup_group_with_member_and_base_budget(client)
    )

    resp = await client.get(
        f"/base-budgets/{base_budget_id}/permissions",
        headers=member_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Base budget not found"


async def test_list_base_budget_permissions_as_outsider_returns_404(client):
    """A user not in the group cannot list permissions — 404."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)
    group_id = await _create_group(client, admin_headers)
    base_budget_id = await _create_group_base_budget(client, admin_headers, group_id)

    outsider_headers, _ = await _create_second_user(client)

    resp = await client.get(
        f"/base-budgets/{base_budget_id}/permissions",
        headers=outsider_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Base budget not found"


async def test_list_base_budget_permissions_unauthenticated_returns_401(client):
    """GET /base-budgets/{id}/permissions without auth returns 401."""
    resp = await client.get(f"/base-budgets/{NONEXISTENT_ID}/permissions")

    assert resp.status_code == 401


# --- DELETE /base-budgets/{base_budget_id}/permissions/{permission_id} ---


async def test_revoke_base_budget_permission_returns_204(client):
    """Admin can revoke a member's permission; a subsequent list does not include it."""
    admin_headers, _, member_user_id, _, base_budget_id = (
        await _setup_group_with_member_and_base_budget(client)
    )
    grant_resp = await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    permission_id = grant_resp.json()["id"]

    resp = await client.delete(
        f"/base-budgets/{base_budget_id}/permissions/{permission_id}",
        headers=admin_headers,
    )

    assert resp.status_code == 204

    list_resp = await client.get(
        f"/base-budgets/{base_budget_id}/permissions",
        headers=admin_headers,
    )
    assert list_resp.json() == []


async def test_revoke_base_budget_permission_does_not_remove_member(client):
    """Revoking a permission does not remove the user from the group."""
    admin_headers, _, member_user_id, group_id, base_budget_id = (
        await _setup_group_with_member_and_base_budget(client)
    )
    grant_resp = await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    permission_id = grant_resp.json()["id"]

    await client.delete(
        f"/base-budgets/{base_budget_id}/permissions/{permission_id}",
        headers=admin_headers,
    )

    members_resp = await client.get(f"/groups/{group_id}/members", headers=admin_headers)
    member_ids = {m["user_id"] for m in members_resp.json()}
    assert member_user_id in member_ids


async def test_revoke_base_budget_permission_nonexistent_permission_returns_404(client):
    """Revoking a non-existent permission returns 404."""
    admin_headers, _, _, _, base_budget_id = (
        await _setup_group_with_member_and_base_budget(client)
    )

    resp = await client.delete(
        f"/base-budgets/{base_budget_id}/permissions/{NONEXISTENT_ID}",
        headers=admin_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Permission not found"


async def test_revoke_base_budget_permission_wrong_base_budget_returns_404(client):
    """A permission belonging to a different base budget cannot be revoked through this one."""
    admin_headers, _, member_user_id, group_id, base_budget_a = (
        await _setup_group_with_member_and_base_budget(client)
    )
    base_budget_b = await _create_group_base_budget(
        client, admin_headers, group_id,
        name="Second Budget", category_name="Other Shared",
    )

    grant_resp = await client.post(
        f"/base-budgets/{base_budget_a}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    permission_id = grant_resp.json()["id"]

    # Attempt to delete via base_budget_b
    resp = await client.delete(
        f"/base-budgets/{base_budget_b}/permissions/{permission_id}",
        headers=admin_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Permission not found"

    # The permission still exists under base_budget_a
    list_resp = await client.get(
        f"/base-budgets/{base_budget_a}/permissions",
        headers=admin_headers,
    )
    assert len(list_resp.json()) == 1


async def test_revoke_base_budget_permission_nonexistent_base_returns_404(client):
    """Revoking a permission on a non-existent base budget returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.delete(
        f"/base-budgets/{NONEXISTENT_ID}/permissions/{NONEXISTENT_ID}",
        headers=headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Base budget not found"


async def test_revoke_base_budget_permission_personal_base_returns_404(client):
    """Revoking on a personal base budget returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    base_budget_id = await _create_personal_base_budget(client, headers)

    resp = await client.delete(
        f"/base-budgets/{base_budget_id}/permissions/{NONEXISTENT_ID}",
        headers=headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Base budget not found"


async def test_revoke_base_budget_permission_as_non_admin_returns_403(client):
    """Non-admin group member cannot revoke permissions."""
    admin_headers, member_headers, member_user_id, _, base_budget_id = (
        await _setup_group_with_member_and_base_budget(client)
    )
    grant_resp = await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    permission_id = grant_resp.json()["id"]

    resp = await client.delete(
        f"/base-budgets/{base_budget_id}/permissions/{permission_id}",
        headers=member_headers,
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"


async def test_revoke_base_budget_permission_as_outsider_returns_404(client):
    """A user not in the group cannot revoke — 404."""
    admin_headers, _, member_user_id, _, base_budget_id = (
        await _setup_group_with_member_and_base_budget(client)
    )
    grant_resp = await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    permission_id = grant_resp.json()["id"]

    outsider_headers, _ = await _create_second_user(
        client, email="outsider@example.com", first_name="Outsider",
    )

    resp = await client.delete(
        f"/base-budgets/{base_budget_id}/permissions/{permission_id}",
        headers=outsider_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Base budget not found"


async def test_revoke_base_budget_permission_unauthenticated_returns_401(client):
    """DELETE /base-budgets/{id}/permissions/{permission_id} without auth returns 401."""
    resp = await client.delete(
        f"/base-budgets/{NONEXISTENT_ID}/permissions/{NONEXISTENT_ID}",
    )

    assert resp.status_code == 401
