from tests.routes.conftest import _create_user, _get_auth_header

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
    payload = {"name": "Groceries", "kind": "expense", **overrides}
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
        "category_ids": [cat_id],
    }, headers=headers)
    return resp.json()["id"]


async def _create_personal_base_budget(client, headers):
    """Create a personal base budget and return its ID."""
    cat_id = await _create_category(client, headers)
    resp = await client.post("/base-budgets", json={
        "name": "Personal Budget",
        "currency": "CAD",
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


async def test_grant_base_budget_permission_as_non_admin_returns_403(client):
    """Non-admin group member cannot grant permissions on a base budget."""
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

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"


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

