from tests.routes.support import _create_user, _get_auth_header

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
        "password": "SecurePassword123!",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    return _get_auth_header(resp), resp.json()["user"]["id"]


async def _create_group(client, headers):
    """Create a group and return its ID.

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.

    Returns:
        The created group's ID.
    """
    resp = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    return resp.json()["id"]


async def _create_group_account(client, headers, group_id):
    """Create a group-scoped account via POST /accounts.

    Args:
        client: The async test client.
        headers: Auth headers for an admin of the group.
        group_id: UUID of the group.

    Returns:
        The created account's ID.
    """
    resp = await client.post("/accounts", json={
        "account_kind": "asset",
        "account_type": "checking",
        "name": "Joint Checking",
        "currency": "CAD",
        "group_id": group_id,
    }, headers=headers)
    return resp.json()["id"]


async def _setup_group_with_member_and_account(client):
    """Create a group with an admin (owner), a regular member, and a group account.

    Args:
        client: The async test client.

    Returns:
        Tuple of (admin_headers, member_headers, member_user_id, group_id, account_id).
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

    account_id = await _create_group_account(client, admin_headers, group_id)

    return admin_headers, member_headers, member_user_id, group_id, account_id


# --- POST /accounts/{account_id}/permissions ---


async def test_grant_account_permission_returns_201(client):
    """Admin can grant read permission to a member."""
    admin_headers, _, member_user_id, group_id, account_id = await _setup_group_with_member_and_account(client)

    resp = await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["user_id"] == member_user_id
    assert data["account_id"] == account_id
    assert data["group_id"] == group_id
    assert data["level"] == "read"
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_grant_account_permission_write_level(client):
    """Admin can grant write permission."""
    admin_headers, _, member_user_id, _, account_id = await _setup_group_with_member_and_account(client)

    resp = await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": member_user_id, "level": "write"},
        headers=admin_headers,
    )

    assert resp.status_code == 201
    assert resp.json()["level"] == "write"


async def test_grant_account_permission_admin_level_on_account(client):
    """Admin can grant account-level admin permission (full control over the account)."""
    admin_headers, _, member_user_id, _, account_id = await _setup_group_with_member_and_account(client)

    resp = await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": member_user_id, "level": "admin"},
        headers=admin_headers,
    )

    assert resp.status_code == 201
    assert resp.json()["level"] == "admin"


async def test_grant_account_permission_updating_level(client):
    """Elevating a member's permission on the same account updates in place."""
    admin_headers, _, member_user_id, _, account_id = await _setup_group_with_member_and_account(client)

    resp1 = await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    permission_id = resp1.json()["id"]

    resp2 = await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": member_user_id, "level": "write"},
        headers=admin_headers,
    )

    assert resp2.status_code == 201
    assert resp2.json()["id"] == permission_id
    assert resp2.json()["level"] == "write"


async def test_grant_account_permission_invalid_level_returns_422(client):
    """Invalid permission level is rejected."""
    admin_headers, _, member_user_id, _, account_id = await _setup_group_with_member_and_account(client)

    resp = await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": member_user_id, "level": "superadmin"},
        headers=admin_headers,
    )

    assert resp.status_code == 422


async def test_grant_account_permission_to_admin_member_returns_422(client):
    """Cannot grant permission to an admin member (they have implicit full access)."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    group_id = await _create_group(client, admin_headers)
    account_id = await _create_group_account(client, admin_headers, group_id)

    resp = await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": user_id, "level": "read"},
        headers=admin_headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Admins have implicit full access"


async def test_grant_account_permission_to_promoted_admin_returns_422(client):
    """Cannot grant permission to a member who was promoted to admin."""
    admin_headers, _, member_user_id, group_id, account_id = await _setup_group_with_member_and_account(client)

    await client.patch(
        f"/groups/{group_id}/members/{member_user_id}",
        json={"is_admin": True},
        headers=admin_headers,
    )

    resp = await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Admins have implicit full access"


async def test_grant_account_permission_to_non_member_returns_422(client):
    """Cannot grant permission to a user who is not a group member."""
    admin_headers, _, _, _, account_id = await _setup_group_with_member_and_account(client)

    resp = await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": NONEXISTENT_ID, "level": "read"},
        headers=admin_headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "User is not a member of this group"


async def test_grant_account_permission_personal_account_returns_404(client):
    """Granting permission on a personal account returns 404 to avoid leaking existence."""
    admin_headers, _, member_user_id, _, _ = await _setup_group_with_member_and_account(client)

    personal_resp = await client.post("/accounts", json={
        "account_kind": "asset", "account_type": "checking", "name": "Personal", "currency": "CAD",
    }, headers=admin_headers)
    personal_account_id = personal_resp.json()["id"]

    resp = await client.post(
        f"/accounts/{personal_account_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Account not found"


async def test_grant_account_permission_nonexistent_account_returns_404(client):
    """Cannot grant permission on a nonexistent account."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post(
        f"/accounts/{NONEXISTENT_ID}/permissions",
        json={"user_id": NONEXISTENT_ID, "level": "read"},
        headers=headers,
    )

    assert resp.status_code == 404


async def test_grant_account_permission_by_non_admin_returns_404(client):
    """A non-admin member cannot see the group account, so granting is not disclosed"""
    _, member_headers, member_user_id, _, account_id = await _setup_group_with_member_and_account(client)

    resp = await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=member_headers,
    )

    assert resp.status_code == 404


async def test_grant_account_permission_by_non_member_returns_404(client):
    """Non-member cannot grant permissions."""
    _, _, member_user_id, _, account_id = await _setup_group_with_member_and_account(client)

    third_resp = await client.post("/auth/signup", json={
        "email": "third@example.com", "password": "SecurePassword123!",
        "first_name": "Third", "tz": "America/Toronto", "base_currency": "CAD",
    })
    third_headers = _get_auth_header(third_resp)

    resp = await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=third_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Account not found"


async def test_grant_account_permission_unauthenticated_returns_401(client):
    """Granting permission without auth returns 401."""
    resp = await client.post(
        f"/accounts/{NONEXISTENT_ID}/permissions",
        json={"user_id": NONEXISTENT_ID, "level": "read"},
    )

    assert resp.status_code == 401


# --- DELETE /accounts/{account_id}/permissions/{permission_id} ---


async def test_revoke_account_permission_returns_204(client):
    """Admin can revoke a permission."""
    admin_headers, _, member_user_id, _, account_id = await _setup_group_with_member_and_account(client)

    grant_resp = await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    permission_id = grant_resp.json()["id"]

    resp = await client.delete(
        f"/accounts/{account_id}/permissions/{permission_id}",
        headers=admin_headers,
    )

    assert resp.status_code == 204

    list_resp = await client.get(f"/accounts/{account_id}/permissions", headers=admin_headers)
    assert list_resp.json() == []


async def test_revoke_account_permission_double_revoke_returns_404(client):
    """Revoking the same permission twice returns 404 on the second call."""
    admin_headers, _, member_user_id, _, account_id = await _setup_group_with_member_and_account(client)

    grant_resp = await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    permission_id = grant_resp.json()["id"]

    first = await client.delete(f"/accounts/{account_id}/permissions/{permission_id}", headers=admin_headers)
    assert first.status_code == 204

    second = await client.delete(f"/accounts/{account_id}/permissions/{permission_id}", headers=admin_headers)
    assert second.status_code == 404


async def test_revoke_account_permission_nonexistent_returns_404(client):
    """Revoking a nonexistent permission returns 404."""
    admin_headers, _, _, _, account_id = await _setup_group_with_member_and_account(client)

    resp = await client.delete(
        f"/accounts/{account_id}/permissions/{NONEXISTENT_ID}",
        headers=admin_headers,
    )

    assert resp.status_code == 404


async def test_revoke_account_permission_wrong_account_returns_404(client):
    """Permission ID from a different account returns 404."""
    admin_headers, _, member_user_id, group_id, account_id = await _setup_group_with_member_and_account(client)

    grant_resp = await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    permission_id = grant_resp.json()["id"]

    second_account_id = await _create_group_account(client, admin_headers, group_id)

    resp = await client.delete(
        f"/accounts/{second_account_id}/permissions/{permission_id}",
        headers=admin_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Permission not found"


async def test_revoke_account_permission_by_non_admin_returns_403(client):
    """Non-admin cannot revoke permissions."""
    admin_headers, member_headers, member_user_id, _, account_id = await _setup_group_with_member_and_account(client)

    grant_resp = await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    permission_id = grant_resp.json()["id"]

    resp = await client.delete(
        f"/accounts/{account_id}/permissions/{permission_id}",
        headers=member_headers,
    )

    assert resp.status_code == 403


async def test_revoke_account_permission_unauthenticated_returns_401(client):
    """Revoking permission without auth returns 401."""
    resp = await client.delete(
        f"/accounts/{NONEXISTENT_ID}/permissions/{NONEXISTENT_ID}",
    )

    assert resp.status_code == 401


# --- GET /accounts/{account_id}/permissions ---


async def test_list_account_permissions_returns_200(client):
    """Admin can list all permissions for an account."""
    admin_headers, _, member_user_id, _, account_id = await _setup_group_with_member_and_account(client)

    await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )

    resp = await client.get(f"/accounts/{account_id}/permissions", headers=admin_headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["user_id"] == member_user_id
    assert resp.json()[0]["account_id"] == account_id
    assert resp.json()[0]["level"] == "read"


async def test_list_account_permissions_empty(client):
    """Empty list when no permissions exist."""
    admin_headers, _, _, _, account_id = await _setup_group_with_member_and_account(client)

    resp = await client.get(f"/accounts/{account_id}/permissions", headers=admin_headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_account_permissions_filter_by_user_id(client):
    """Filter permissions by user_id."""
    admin_headers, _, member_user_id, _, account_id = await _setup_group_with_member_and_account(client)

    await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )

    resp = await client.get(
        f"/accounts/{account_id}/permissions?user_id={member_user_id}",
        headers=admin_headers,
    )

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["user_id"] == member_user_id
    assert resp.json()[0]["level"] == "read"

    resp2 = await client.get(
        f"/accounts/{account_id}/permissions?user_id={NONEXISTENT_ID}",
        headers=admin_headers,
    )
    assert resp2.json() == []


async def test_list_account_permissions_multiple_ordered_by_created_at(client):
    """Multiple permissions are returned ordered by created_at."""
    admin_headers, _, member_user_id, group_id, account_id = await _setup_group_with_member_and_account(client)

    third_resp = await client.post("/auth/signup", json={
        "email": "third@example.com", "password": "SecurePassword123!",
        "first_name": "Third", "tz": "America/Toronto", "base_currency": "CAD",
    })
    third_user_id = third_resp.json()["user"]["id"]
    await client.post(f"/groups/{group_id}/members", json={"user_id": third_user_id}, headers=admin_headers)

    await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": member_user_id, "level": "read"},
        headers=admin_headers,
    )
    await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": third_user_id, "level": "write"},
        headers=admin_headers,
    )

    resp = await client.get(f"/accounts/{account_id}/permissions", headers=admin_headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 2
    assert resp.json()[0]["user_id"] == member_user_id
    assert resp.json()[0]["level"] == "read"
    assert resp.json()[1]["user_id"] == third_user_id
    assert resp.json()[1]["level"] == "write"


async def test_list_account_permissions_by_non_admin_returns_404(client):
    """A non-admin member cannot see the group account, so its permissions are not disclosed"""
    _, member_headers, _, _, account_id = await _setup_group_with_member_and_account(client)

    resp = await client.get(f"/accounts/{account_id}/permissions", headers=member_headers)

    assert resp.status_code == 404


async def test_list_account_permissions_unauthenticated_returns_401(client):
    """Listing permissions without auth returns 401."""
    resp = await client.get(f"/accounts/{NONEXISTENT_ID}/permissions")

    assert resp.status_code == 401


# --- Permission enforcement on account endpoints ---


async def _grant_account_permission(client, admin_headers, account_id, member_user_id, level):
    """Grant an account permission to a member via POST /accounts/{id}/permissions.

    Args:
        client: The async test client.
        admin_headers: Auth headers for a group admin.
        account_id: UUID of the account.
        member_user_id: UUID of the member receiving permission.
        level: Permission level ("read", "write", or "admin").
    """
    await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": member_user_id, "level": level},
        headers=admin_headers,
    )


async def test_read_permission_allows_get_account(client):
    """Member with READ permission can retrieve the account."""
    admin_headers, member_headers, member_user_id, _, account_id = await _setup_group_with_member_and_account(client)
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "read")

    resp = await client.get(f"/accounts/{account_id}", headers=member_headers)

    assert resp.status_code == 200
    assert resp.json()["id"] == account_id


async def test_read_permission_blocks_patch_account(client):
    """Member with READ permission cannot update the account (requires ADMIN)."""
    admin_headers, member_headers, member_user_id, _, account_id = await _setup_group_with_member_and_account(client)
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "read")

    resp = await client.patch(
        f"/accounts/{account_id}",
        json={"name": "Hacked"},
        headers=member_headers,
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_read_permission_blocks_delete_account(client):
    """Member with READ permission cannot delete the account (requires ADMIN)."""
    admin_headers, member_headers, member_user_id, _, account_id = await _setup_group_with_member_and_account(client)
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "read")

    resp = await client.delete(f"/accounts/{account_id}", headers=member_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_write_permission_blocks_patch_account(client):
    """Member with WRITE permission cannot update the account (requires ADMIN)."""
    admin_headers, member_headers, member_user_id, _, account_id = await _setup_group_with_member_and_account(client)
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "write")

    resp = await client.patch(
        f"/accounts/{account_id}",
        json={"name": "Hacked"},
        headers=member_headers,
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_write_permission_blocks_delete_account(client):
    """Member with WRITE permission cannot delete the account (requires ADMIN)."""
    admin_headers, member_headers, member_user_id, _, account_id = await _setup_group_with_member_and_account(client)
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "write")

    resp = await client.delete(f"/accounts/{account_id}", headers=member_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_admin_permission_allows_patch_account(client):
    """Member with ADMIN permission can update the account."""
    admin_headers, member_headers, member_user_id, _, account_id = await _setup_group_with_member_and_account(client)
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "admin")

    resp = await client.patch(
        f"/accounts/{account_id}",
        json={"name": "Renamed by member"},
        headers=member_headers,
    )

    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed by member"


async def test_admin_permission_allows_delete_account(client):
    """Member with ADMIN permission can delete the account."""
    admin_headers, member_headers, member_user_id, _, account_id = await _setup_group_with_member_and_account(client)
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "admin")

    resp = await client.delete(f"/accounts/{account_id}", headers=member_headers)

    assert resp.status_code == 204


async def test_no_permission_returns_404_on_get_account(client):
    """Group member without any explicit permission gets 404 on GET."""
    _, member_headers, _, _, account_id = await _setup_group_with_member_and_account(client)

    resp = await client.get(f"/accounts/{account_id}", headers=member_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Account not found"
