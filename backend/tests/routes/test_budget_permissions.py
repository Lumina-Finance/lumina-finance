from tests.routes.conftest import _create_user, _get_auth_header

# --- Helpers ---

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"


async def _create_second_user(client):
    """Sign up a second user and return (headers, user_id).

    Args:
        client: The async test client.

    Returns:
        Tuple of (auth_headers, user_id).
    """
    resp = await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "securepassword123",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    return _get_auth_header(resp), resp.json()["user"]["id"]


async def _create_household(client, headers):
    """Create a household and return its ID.

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.

    Returns:
        The created household's ID.
    """
    resp = await client.post("/households", json={"name": "Smith Family"}, headers=headers)
    return resp.json()["id"]


async def _create_household_budget(client, headers, household_id):
    """Create a household-scoped budget via POST /budgets.

    Args:
        client: The async test client.
        headers: Auth headers for an admin of the household.
        household_id: UUID of the household.

    Returns:
        The created budget's ID.
    """
    resp = await client.post("/budgets", json={
        "name": "March Budget",
        "period_start": "2026-03-01",
        "period_end": "2026-03-31",
        "currency": "CAD",
        "household_id": household_id,
    }, headers=headers)
    return resp.json()["id"]


async def _setup_household_with_member_and_budget(client):
    """Create a household with an admin (owner), a regular member, and a household budget.

    Args:
        client: The async test client.

    Returns:
        Tuple of (admin_headers, member_headers, member_user_id, household_id, budget_id).
    """
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    household_id = await _create_household(client, admin_headers)

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )

    budget_id = await _create_household_budget(client, admin_headers, household_id)

    return admin_headers, member_headers, member_user_id, household_id, budget_id


# --- POST /budgets/{budget_id}/permissions ---


async def test_grant_budget_permission_returns_201(client):
    """Admin can grant read permission to a member."""
    admin_headers, _, member_user_id, household_id, budget_id = await _setup_household_with_member_and_budget(client)

    resp = await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["user_id"] == member_user_id
    assert data["budget_id"] == budget_id
    assert data["household_id"] == household_id
    assert data["level"] == "read"
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_grant_budget_permission_write_level(client):
    """Admin can grant write permission."""
    admin_headers, _, member_user_id, _, budget_id = await _setup_household_with_member_and_budget(client)

    resp = await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": member_user_id, "level": "write"},
        headers=admin_headers,
    )

    assert resp.status_code == 201
    assert resp.json()["level"] == "write"


async def test_grant_budget_permission_admin_level_on_budget(client):
    """Admin can grant budget-level admin permission (full control over the budget)."""
    admin_headers, _, member_user_id, _, budget_id = await _setup_household_with_member_and_budget(client)

    resp = await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": member_user_id, "level": "admin"},
        headers=admin_headers,
    )

    assert resp.status_code == 201
    assert resp.json()["level"] == "admin"


async def test_grant_budget_permission_elevating_level(client):
    """Elevating a member's permission on the same budget updates in place."""
    admin_headers, _, member_user_id, _, budget_id = await _setup_household_with_member_and_budget(client)

    resp1 = await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    permission_id = resp1.json()["id"]

    resp2 = await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": member_user_id, "level": "write"},
        headers=admin_headers,
    )

    assert resp2.status_code == 201
    assert resp2.json()["id"] == permission_id
    assert resp2.json()["level"] == "write"


async def test_grant_budget_permission_invalid_level_returns_422(client):
    """Invalid permission level is rejected."""
    admin_headers, _, member_user_id, _, budget_id = await _setup_household_with_member_and_budget(client)

    resp = await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": member_user_id, "level": "superadmin"},
        headers=admin_headers,
    )

    assert resp.status_code == 422


async def test_grant_budget_permission_to_admin_member_returns_422(client):
    """Cannot grant permission to an admin member (they have implicit full access)."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    household_id = await _create_household(client, admin_headers)
    budget_id = await _create_household_budget(client, admin_headers, household_id)

    resp = await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": user_id, "level": "read"},
        headers=admin_headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Admins have implicit full access"


async def test_grant_budget_permission_to_promoted_admin_returns_422(client):
    """Cannot grant permission to a member who was promoted to admin."""
    admin_headers, _, member_user_id, household_id, budget_id = await _setup_household_with_member_and_budget(client)

    await client.patch(
        f"/households/{household_id}/members/{member_user_id}",
        json={"is_admin": True},
        headers=admin_headers,
    )

    resp = await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Admins have implicit full access"


async def test_grant_budget_permission_to_non_member_returns_422(client):
    """Cannot grant permission to a user who is not a household member."""
    admin_headers, _, _, _, budget_id = await _setup_household_with_member_and_budget(client)

    resp = await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": NONEXISTENT_ID, "level": "read"},
        headers=admin_headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "User is not a member of this household"


async def test_grant_permission_on_personal_budget_returns_404(client):
    """Personal budgets don't support permissions; returns 404 to avoid leaking existence."""
    admin_headers, _, member_user_id, _, _ = await _setup_household_with_member_and_budget(client)

    personal_resp = await client.post("/budgets", json={
        "name": "Personal Budget",
        "period_start": "2026-03-01",
        "period_end": "2026-03-31",
        "currency": "CAD",
    }, headers=admin_headers)
    personal_budget_id = personal_resp.json()["id"]

    resp = await client.post(
        f"/budgets/{personal_budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_grant_budget_permission_nonexistent_budget_returns_404(client):
    """Cannot grant permission on a nonexistent budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post(
        f"/budgets/{NONEXISTENT_ID}/permissions",
        json={"user_id": NONEXISTENT_ID, "level": "read"},
        headers=headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_grant_budget_permission_by_non_admin_returns_403(client):
    """Non-admin member cannot grant permissions."""
    _, member_headers, member_user_id, _, budget_id = await _setup_household_with_member_and_budget(client)

    resp = await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=member_headers,
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"


async def test_grant_budget_permission_by_non_member_returns_404(client):
    """Non-member cannot grant permissions."""
    _, _, member_user_id, _, budget_id = await _setup_household_with_member_and_budget(client)

    third_resp = await client.post("/auth/signup", json={
        "email": "third@example.com", "password": "securepassword123",
        "first_name": "Third", "tz": "America/Toronto", "base_currency": "CAD",
    })
    third_headers = _get_auth_header(third_resp)

    resp = await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=third_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_grant_budget_permission_unauthenticated_returns_401(client):
    """Granting permission without auth returns 401."""
    resp = await client.post(
        f"/budgets/{NONEXISTENT_ID}/permissions",
        json={"user_id": NONEXISTENT_ID, "level": "read"},
    )

    assert resp.status_code == 401


# --- DELETE /budgets/{budget_id}/permissions/{permission_id} ---


async def test_revoke_budget_permission_returns_204(client):
    """Admin can revoke a permission."""
    admin_headers, _, member_user_id, _, budget_id = await _setup_household_with_member_and_budget(client)

    grant_resp = await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    permission_id = grant_resp.json()["id"]

    resp = await client.delete(
        f"/budgets/{budget_id}/permissions/{permission_id}",
        headers=admin_headers,
    )

    assert resp.status_code == 204

    list_resp = await client.get(f"/budgets/{budget_id}/permissions", headers=admin_headers)
    assert list_resp.json() == []


async def test_revoke_budget_permission_double_revoke_returns_404(client):
    """Revoking the same permission twice returns 404 on the second call."""
    admin_headers, _, member_user_id, _, budget_id = await _setup_household_with_member_and_budget(client)

    grant_resp = await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    permission_id = grant_resp.json()["id"]

    first = await client.delete(f"/budgets/{budget_id}/permissions/{permission_id}", headers=admin_headers)
    assert first.status_code == 204

    second = await client.delete(f"/budgets/{budget_id}/permissions/{permission_id}", headers=admin_headers)
    assert second.status_code == 404


async def test_revoke_budget_permission_nonexistent_returns_404(client):
    """Revoking a nonexistent permission returns 404."""
    admin_headers, _, _, _, budget_id = await _setup_household_with_member_and_budget(client)

    resp = await client.delete(
        f"/budgets/{budget_id}/permissions/{NONEXISTENT_ID}",
        headers=admin_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Permission not found"


async def test_revoke_budget_permission_wrong_budget_returns_404(client):
    """Permission ID from a different budget returns 404."""
    admin_headers, _, member_user_id, household_id, budget_id = await _setup_household_with_member_and_budget(client)

    grant_resp = await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    permission_id = grant_resp.json()["id"]

    second_budget_id = await _create_household_budget(client, admin_headers, household_id)

    resp = await client.delete(
        f"/budgets/{second_budget_id}/permissions/{permission_id}",
        headers=admin_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Permission not found"


async def test_revoke_budget_permission_by_non_admin_returns_403(client):
    """Non-admin cannot revoke permissions."""
    admin_headers, member_headers, member_user_id, _, budget_id = await _setup_household_with_member_and_budget(client)

    grant_resp = await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    permission_id = grant_resp.json()["id"]

    resp = await client.delete(
        f"/budgets/{budget_id}/permissions/{permission_id}",
        headers=member_headers,
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"


async def test_revoke_budget_permission_unauthenticated_returns_401(client):
    """Revoking permission without auth returns 401."""
    resp = await client.delete(
        f"/budgets/{NONEXISTENT_ID}/permissions/{NONEXISTENT_ID}",
    )

    assert resp.status_code == 401


# --- GET /budgets/{budget_id}/permissions ---


async def test_list_budget_permissions_returns_200(client):
    """Admin can list all permissions for a budget."""
    admin_headers, _, member_user_id, _, budget_id = await _setup_household_with_member_and_budget(client)

    await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )

    resp = await client.get(f"/budgets/{budget_id}/permissions", headers=admin_headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["user_id"] == member_user_id
    assert resp.json()[0]["budget_id"] == budget_id
    assert resp.json()[0]["level"] == "read"


async def test_list_budget_permissions_empty(client):
    """Empty list when no permissions exist."""
    admin_headers, _, _, _, budget_id = await _setup_household_with_member_and_budget(client)

    resp = await client.get(f"/budgets/{budget_id}/permissions", headers=admin_headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_budget_permissions_filter_by_user_id(client):
    """Filter permissions by user_id."""
    admin_headers, _, member_user_id, _, budget_id = await _setup_household_with_member_and_budget(client)

    await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )

    resp = await client.get(
        f"/budgets/{budget_id}/permissions?user_id={member_user_id}",
        headers=admin_headers,
    )

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["user_id"] == member_user_id
    assert resp.json()[0]["level"] == "read"

    resp2 = await client.get(
        f"/budgets/{budget_id}/permissions?user_id={NONEXISTENT_ID}",
        headers=admin_headers,
    )
    assert resp2.json() == []


async def test_list_budget_permissions_multiple_ordered_by_created_at(client):
    """Multiple permissions are returned ordered by created_at."""
    admin_headers, _, member_user_id, household_id, budget_id = await _setup_household_with_member_and_budget(client)

    third_resp = await client.post("/auth/signup", json={
        "email": "third@example.com", "password": "securepassword123",
        "first_name": "Third", "tz": "America/Toronto", "base_currency": "CAD",
    })
    third_user_id = third_resp.json()["user"]["id"]
    await client.post(f"/households/{household_id}/members", json={"user_id": third_user_id}, headers=admin_headers)

    await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": third_user_id, "level": "write"},
        headers=admin_headers,
    )

    resp = await client.get(f"/budgets/{budget_id}/permissions", headers=admin_headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 2
    assert resp.json()[0]["user_id"] == member_user_id
    assert resp.json()[0]["level"] == "read"
    assert resp.json()[1]["user_id"] == third_user_id
    assert resp.json()[1]["level"] == "write"


async def test_list_budget_permissions_by_non_admin_returns_403(client):
    """Non-admin cannot list permissions."""
    _, member_headers, _, _, budget_id = await _setup_household_with_member_and_budget(client)

    resp = await client.get(f"/budgets/{budget_id}/permissions", headers=member_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"


async def test_list_budget_permissions_unauthenticated_returns_401(client):
    """Listing permissions without auth returns 401."""
    resp = await client.get(f"/budgets/{NONEXISTENT_ID}/permissions")

    assert resp.status_code == 401


# --- Permission enforcement on budget endpoints ---


async def _grant_budget_permission(client, admin_headers, budget_id, member_user_id, level):
    """Grant a budget permission to a member via POST /budgets/{id}/permissions.

    Args:
        client: The async test client.
        admin_headers: Auth headers for a household admin.
        budget_id: UUID of the budget.
        member_user_id: UUID of the member receiving permission.
        level: Permission level ("read", "write", or "admin").
    """
    await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": member_user_id, "level": level},
        headers=admin_headers,
    )


async def test_read_permission_allows_get_budget(client):
    """Member with READ permission can retrieve the budget."""
    admin_headers, member_headers, member_user_id, _, budget_id = await _setup_household_with_member_and_budget(client)
    await _grant_budget_permission(client, admin_headers, budget_id, member_user_id, "read")

    resp = await client.get(f"/budgets/{budget_id}", headers=member_headers)

    assert resp.status_code == 200
    assert resp.json()["id"] == budget_id


async def test_read_permission_blocks_patch_budget(client):
    """Member with READ permission cannot update the budget (requires ADMIN)."""
    admin_headers, member_headers, member_user_id, _, budget_id = await _setup_household_with_member_and_budget(client)
    await _grant_budget_permission(client, admin_headers, budget_id, member_user_id, "read")

    resp = await client.patch(
        f"/budgets/{budget_id}",
        json={"name": "Hacked"},
        headers=member_headers,
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_read_permission_blocks_delete_budget(client):
    """Member with READ permission cannot delete the budget (requires ADMIN)."""
    admin_headers, member_headers, member_user_id, _, budget_id = await _setup_household_with_member_and_budget(client)
    await _grant_budget_permission(client, admin_headers, budget_id, member_user_id, "read")

    resp = await client.delete(f"/budgets/{budget_id}", headers=member_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_write_permission_blocks_patch_budget(client):
    """Member with WRITE permission cannot update the budget (requires ADMIN)."""
    admin_headers, member_headers, member_user_id, _, budget_id = await _setup_household_with_member_and_budget(client)
    await _grant_budget_permission(client, admin_headers, budget_id, member_user_id, "write")

    resp = await client.patch(
        f"/budgets/{budget_id}",
        json={"name": "Hacked"},
        headers=member_headers,
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_write_permission_blocks_delete_budget(client):
    """Member with WRITE permission cannot delete the budget (requires ADMIN)."""
    admin_headers, member_headers, member_user_id, _, budget_id = await _setup_household_with_member_and_budget(client)
    await _grant_budget_permission(client, admin_headers, budget_id, member_user_id, "write")

    resp = await client.delete(f"/budgets/{budget_id}", headers=member_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_admin_permission_allows_patch_budget(client):
    """Member with ADMIN permission can update the budget."""
    admin_headers, member_headers, member_user_id, _, budget_id = await _setup_household_with_member_and_budget(client)
    await _grant_budget_permission(client, admin_headers, budget_id, member_user_id, "admin")

    resp = await client.patch(
        f"/budgets/{budget_id}",
        json={"name": "Renamed by member"},
        headers=member_headers,
    )

    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed by member"


async def test_admin_permission_allows_delete_budget(client):
    """Member with ADMIN permission can delete the budget."""
    admin_headers, member_headers, member_user_id, _, budget_id = await _setup_household_with_member_and_budget(client)
    await _grant_budget_permission(client, admin_headers, budget_id, member_user_id, "admin")

    resp = await client.delete(f"/budgets/{budget_id}", headers=member_headers)

    assert resp.status_code == 204


async def test_no_permission_returns_404_on_get_budget(client):
    """Household member without any explicit permission gets 404 on GET."""
    _, member_headers, _, _, budget_id = await _setup_household_with_member_and_budget(client)

    resp = await client.get(f"/budgets/{budget_id}", headers=member_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"
