from tests.routes.conftest import _create_user, _get_auth_header

# --- Helpers ---

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"


async def _create_household(client, headers, **overrides):
    """Create a household via POST /households.

    Defaults: name="Smith Family".

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        **overrides: Fields to override in the default payload.

    Returns:
        The HTTP response from the API.
    """
    payload = {"name": "Smith Family", **overrides}
    return await client.post("/households", json=payload, headers=headers)


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


# --- POST /households ---


async def test_create_household_returns_201(client):
    """Valid payload creates a household with correct fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    resp = await _create_household(client, headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Smith Family"
    assert data["owner_id"] == user_id
    assert data["profile_pic"] is None
    assert data["is_archived"] is False
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_create_household_auto_adds_creator_as_admin(client):
    """Creator is auto-added as an admin member."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    household_resp = await _create_household(client, headers)
    household_id = household_resp.json()["id"]

    members_resp = await client.get(f"/households/{household_id}/members", headers=headers)

    assert members_resp.status_code == 200
    members = members_resp.json()
    assert len(members) == 1
    assert members[0]["user_id"] == user_id
    assert members[0]["role"] == "admin"


async def test_create_household_with_profile_pic(client):
    """Profile pic is stored and returned when provided."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_household(client, headers, profile_pic="https://example.com/pic.jpg")

    assert resp.status_code == 201
    assert resp.json()["profile_pic"] == "https://example.com/pic.jpg"


async def test_create_household_empty_name_returns_422(client):
    """Empty name violates min_length=1 and returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_household(client, headers, name="")
    assert resp.status_code == 422


async def test_create_household_name_too_long_returns_422(client):
    """Name exceeding 128 characters returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_household(client, headers, name="A" * 129)
    assert resp.status_code == 422


async def test_create_household_without_auth_returns_401(client):
    """POST /households without an Authorization header returns 401."""
    resp = await client.post("/households", json={"name": "Test"})
    assert resp.status_code == 401


# --- GET /households ---


async def test_list_households_returns_empty_list(client):
    """User with no households gets an empty list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/households", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_households_returns_user_households(client):
    """User sees households they are a member of."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_household(client, headers, name="Family")
    await _create_household(client, headers, name="Roommates")

    resp = await client.get("/households", headers=headers)

    assert resp.status_code == 200
    names = [h["name"] for h in resp.json()]
    assert names == ["Family", "Roommates"]


async def test_list_households_excludes_other_users(client):
    """User does not see households they are not a member of."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _create_household(client, headers, name="My Household")

    other_headers, _ = await _create_second_user(client)
    await _create_household(client, other_headers, name="Their Household")

    resp = await client.get("/households", headers=headers)

    assert len(resp.json()) == 1
    assert resp.json()[0]["name"] == "My Household"


async def test_list_households_includes_archived_by_default(client):
    """Archived households are included in the default list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_household(client, headers, name="Active")
    archived_resp = await _create_household(client, headers, name="Old")
    archived_id = archived_resp.json()["id"]
    await client.patch(f"/households/{archived_id}", json={"is_archived": True}, headers=headers)

    resp = await client.get("/households", headers=headers)

    assert len(resp.json()) == 2
    names = {h["name"] for h in resp.json()}
    assert names == {"Active", "Old"}


async def test_list_households_exclude_archived(client):
    """exclude_archived=true hides archived households."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_household(client, headers, name="Active")
    archived_resp = await _create_household(client, headers, name="Old")
    archived_id = archived_resp.json()["id"]
    await client.patch(f"/households/{archived_id}", json={"is_archived": True}, headers=headers)

    resp = await client.get("/households?exclude_archived=true", headers=headers)

    assert len(resp.json()) == 1
    assert resp.json()[0]["name"] == "Active"


async def test_list_households_without_auth_returns_401(client):
    """GET /households without an Authorization header returns 401."""
    resp = await client.get("/households")
    assert resp.status_code == 401


# --- GET /households/{id} ---


async def test_get_household_returns_household(client):
    """Member can retrieve a household by ID."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    resp = await client.get(f"/households/{household_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["id"] == household_id
    assert resp.json()["name"] == "Smith Family"


async def test_get_household_non_member_returns_404(client):
    """Non-member cannot see a household."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    other_headers, _ = await _create_second_user(client)

    resp = await client.get(f"/households/{household_id}", headers=other_headers)
    assert resp.status_code == 404


async def test_get_household_not_found_returns_404(client):
    """Nonexistent household ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/households/{NONEXISTENT_ID}", headers=headers)
    assert resp.status_code == 404


async def test_get_household_without_auth_returns_401(client):
    """GET /households/{id} without auth returns 401."""
    resp = await client.get(f"/households/{NONEXISTENT_ID}")
    assert resp.status_code == 401


# --- PATCH /households/{id} ---


async def test_update_household_name(client):
    """Admin can update household name."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    resp = await client.patch(f"/households/{household_id}", json={"name": "Jones Family"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "Jones Family"


async def test_update_household_archives(client):
    """Admin can archive a household."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    resp = await client.patch(f"/households/{household_id}", json={"is_archived": True}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["is_archived"] is True


async def test_update_household_empty_body_returns_unchanged(client):
    """PATCH with empty body returns 200 with no changes."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    resp = await client.patch(f"/households/{household_id}", json={}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "Smith Family"


async def test_update_household_by_editor_returns_403(client):
    """Editor cannot update household."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    other_headers, other_user_id = await _create_second_user(client)
    await client.post(f"/households/{household_id}/members", json={"user_id": other_user_id, "role": "editor"}, headers=headers)

    resp = await client.patch(f"/households/{household_id}", json={"name": "Nope"}, headers=other_headers)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"


async def test_update_household_by_viewer_returns_403(client):
    """Viewer cannot update household."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    other_headers, other_user_id = await _create_second_user(client)
    await client.post(f"/households/{household_id}/members", json={"user_id": other_user_id, "role": "viewer"}, headers=headers)

    resp = await client.patch(f"/households/{household_id}", json={"name": "Nope"}, headers=other_headers)
    assert resp.status_code == 403


async def test_update_household_non_member_returns_404(client):
    """Non-member cannot update household."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    other_headers, _ = await _create_second_user(client)

    resp = await client.patch(f"/households/{household_id}", json={"name": "Nope"}, headers=other_headers)
    assert resp.status_code == 404


async def test_update_household_profile_pic(client):
    """Admin can set and clear profile_pic."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    resp = await client.patch(f"/households/{household_id}", json={"profile_pic": "https://example.com/pic.jpg"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["profile_pic"] == "https://example.com/pic.jpg"

    resp = await client.patch(f"/households/{household_id}", json={"profile_pic": None}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["profile_pic"] is None


async def test_update_household_empty_name_returns_422(client):
    """Empty name on PATCH violates min_length=1 and returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    resp = await client.patch(f"/households/{household_id}", json={"name": ""}, headers=headers)
    assert resp.status_code == 422


async def test_update_household_without_auth_returns_401(client):
    """PATCH /households/{id} without auth returns 401."""
    resp = await client.patch(f"/households/{NONEXISTENT_ID}", json={"name": "Nope"})
    assert resp.status_code == 401


# --- DELETE /households/{id} ---


async def test_delete_household_by_owner_returns_204(client):
    """Owner can delete a household."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    resp = await client.delete(f"/households/{household_id}", headers=headers)
    assert resp.status_code == 204

    get_resp = await client.get(f"/households/{household_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_household_by_admin_non_owner_returns_403(client):
    """Admin who is not the owner cannot delete."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    other_headers, other_user_id = await _create_second_user(client)
    await client.post(f"/households/{household_id}/members", json={"user_id": other_user_id, "role": "admin"}, headers=headers)

    resp = await client.delete(f"/households/{household_id}", headers=other_headers)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Only the owner can delete this household"


async def test_delete_household_by_non_member_returns_404(client):
    """Non-member cannot delete household."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    other_headers, _ = await _create_second_user(client)

    resp = await client.delete(f"/households/{household_id}", headers=other_headers)
    assert resp.status_code == 404


async def test_delete_household_nonexistent_id_returns_404(client):
    """Deleting a nonexistent household returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.delete(f"/households/{NONEXISTENT_ID}", headers=headers)
    assert resp.status_code == 404


async def test_delete_household_twice_returns_404(client):
    """Deleting the same household twice returns 204 then 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    resp1 = await client.delete(f"/households/{household_id}", headers=headers)
    resp2 = await client.delete(f"/households/{household_id}", headers=headers)

    assert resp1.status_code == 204
    assert resp2.status_code == 404


async def test_delete_household_without_auth_returns_401(client):
    """DELETE /households/{id} without auth returns 401."""
    resp = await client.delete(f"/households/{NONEXISTENT_ID}")
    assert resp.status_code == 401


# --- GET /households/{id}/members ---


async def test_list_members_returns_all_members(client):
    """Lists all members including creator and added member."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    _, other_user_id = await _create_second_user(client)
    await client.post(f"/households/{household_id}/members", json={"user_id": other_user_id, "role": "viewer"}, headers=headers)

    resp = await client.get(f"/households/{household_id}/members", headers=headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 2
    roles = {m["role"] for m in resp.json()}
    assert roles == {"admin", "viewer"}


async def test_list_members_by_non_member_returns_404(client):
    """Non-member cannot list members."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    other_headers, _ = await _create_second_user(client)

    resp = await client.get(f"/households/{household_id}/members", headers=other_headers)
    assert resp.status_code == 404


async def test_list_members_without_auth_returns_401(client):
    """GET /households/{id}/members without auth returns 401."""
    resp = await client.get(f"/households/{NONEXISTENT_ID}/members")
    assert resp.status_code == 401


# --- POST /households/{id}/members ---


async def test_add_member_returns_201(client):
    """Admin adds a member with default viewer role."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    _, other_user_id = await _create_second_user(client)

    resp = await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )

    assert resp.status_code == 201
    assert resp.json()["user_id"] == other_user_id
    assert resp.json()["role"] == "viewer"


async def test_add_member_with_editor_role(client):
    """Admin adds a member as editor."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    _, other_user_id = await _create_second_user(client)

    resp = await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id, "role": "editor"},
        headers=headers,
    )

    assert resp.status_code == 201
    assert resp.json()["role"] == "editor"


async def test_add_member_duplicate_returns_409(client):
    """Adding an existing member returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    _, other_user_id = await _create_second_user(client)
    await client.post(f"/households/{household_id}/members", json={"user_id": other_user_id}, headers=headers)

    resp = await client.post(f"/households/{household_id}/members", json={"user_id": other_user_id}, headers=headers)

    assert resp.status_code == 409
    assert resp.json()["detail"] == "User is already a member"


async def test_add_member_nonexistent_user_id_returns_422(client):
    """Adding a nonexistent user returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    resp = await client.post(
        f"/households/{household_id}/members",
        json={"user_id": NONEXISTENT_ID},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "User not found"


async def test_add_member_by_editor_returns_403(client):
    """Editor cannot add members."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    other_headers, other_user_id = await _create_second_user(client)
    await client.post(f"/households/{household_id}/members", json={"user_id": other_user_id, "role": "editor"}, headers=headers)

    resp = await client.post(
        f"/households/{household_id}/members",
        json={"user_id": NONEXISTENT_ID},
        headers=other_headers,
    )
    assert resp.status_code == 403


async def test_add_member_by_non_member_returns_404(client):
    """Non-member cannot add members."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    other_headers, _ = await _create_second_user(client)

    resp = await client.post(
        f"/households/{household_id}/members",
        json={"user_id": NONEXISTENT_ID},
        headers=other_headers,
    )
    assert resp.status_code == 404


async def test_add_member_invalid_role_returns_422(client):
    """Adding a member with an invalid role returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    _, other_user_id = await _create_second_user(client)

    resp = await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id, "role": "superadmin"},
        headers=headers,
    )
    assert resp.status_code == 422


async def test_add_member_without_auth_returns_401(client):
    """POST /households/{id}/members without auth returns 401."""
    resp = await client.post(f"/households/{NONEXISTENT_ID}/members", json={"user_id": NONEXISTENT_ID})
    assert resp.status_code == 401


# --- PATCH /households/{id}/members/{member_id} ---


async def test_update_member_role_returns_200(client):
    """Admin changes a viewer to editor."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    _, other_user_id = await _create_second_user(client)
    await client.post(f"/households/{household_id}/members", json={"user_id": other_user_id, "role": "viewer"}, headers=headers)

    resp = await client.patch(
        f"/households/{household_id}/members/{other_user_id}",
        json={"role": "editor"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["role"] == "editor"


async def test_update_member_role_owner_demotion_returns_403(client):
    """Cannot change the owner's role from admin."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/households/{household_id}/members/{user_id}",
        json={"role": "viewer"},
        headers=headers,
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Cannot change the owner's role"


async def test_update_member_role_nonexistent_member_returns_404(client):
    """Changing role of nonexistent member returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/households/{household_id}/members/{NONEXISTENT_ID}",
        json={"role": "editor"},
        headers=headers,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Member not found"


async def test_update_member_role_by_editor_returns_403(client):
    """Editor cannot change roles."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    other_headers, other_user_id = await _create_second_user(client)
    await client.post(f"/households/{household_id}/members", json={"user_id": other_user_id, "role": "editor"}, headers=headers)

    resp = await client.patch(
        f"/households/{household_id}/members/{other_user_id}",
        json={"role": "admin"},
        headers=other_headers,
    )
    assert resp.status_code == 403


async def test_update_member_role_non_member_returns_404(client):
    """Non-member cannot change roles."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    other_headers, _ = await _create_second_user(client)

    resp = await client.patch(
        f"/households/{household_id}/members/{user_id}",
        json={"role": "editor"},
        headers=other_headers,
    )
    assert resp.status_code == 404


async def test_update_member_role_invalid_role_returns_422(client):
    """Updating a member with an invalid role returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    _, other_user_id = await _create_second_user(client)
    await client.post(f"/households/{household_id}/members", json={"user_id": other_user_id}, headers=headers)

    resp = await client.patch(
        f"/households/{household_id}/members/{other_user_id}",
        json={"role": "superadmin"},
        headers=headers,
    )
    assert resp.status_code == 422


async def test_update_member_role_without_auth_returns_401(client):
    """PATCH /households/{id}/members/{id} without auth returns 401."""
    resp = await client.patch(f"/households/{NONEXISTENT_ID}/members/{NONEXISTENT_ID}", json={"role": "editor"})
    assert resp.status_code == 401


# --- DELETE /households/{id}/members/{member_id} ---


async def test_remove_member_admin_removes_other_returns_204(client):
    """Admin removes another member. Follow-up confirms removal."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    _, other_user_id = await _create_second_user(client)
    await client.post(f"/households/{household_id}/members", json={"user_id": other_user_id}, headers=headers)

    resp = await client.delete(f"/households/{household_id}/members/{other_user_id}", headers=headers)
    assert resp.status_code == 204

    members_resp = await client.get(f"/households/{household_id}/members", headers=headers)
    assert len(members_resp.json()) == 1


async def test_remove_member_self_leave_returns_204(client):
    """Non-admin member can leave the household."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    other_headers, other_user_id = await _create_second_user(client)
    await client.post(f"/households/{household_id}/members", json={"user_id": other_user_id, "role": "viewer"}, headers=headers)

    resp = await client.delete(f"/households/{household_id}/members/{other_user_id}", headers=other_headers)
    assert resp.status_code == 204

    members_resp = await client.get(f"/households/{household_id}/members", headers=headers)
    assert len(members_resp.json()) == 1


async def test_remove_member_owner_cannot_be_removed_returns_403(client):
    """Admin cannot remove the owner."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    other_headers, other_user_id = await _create_second_user(client)
    await client.post(f"/households/{household_id}/members", json={"user_id": other_user_id, "role": "admin"}, headers=headers)

    resp = await client.delete(f"/households/{household_id}/members/{user_id}", headers=other_headers)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Cannot remove the owner"


async def test_remove_member_owner_cannot_self_leave_returns_403(client):
    """Owner cannot leave their own household."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    resp = await client.delete(f"/households/{household_id}/members/{user_id}", headers=headers)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Cannot remove the owner"


async def test_remove_member_editor_cannot_remove_others_returns_403(client):
    """Editor cannot remove other members."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    other_headers, other_user_id = await _create_second_user(client)
    await client.post(f"/households/{household_id}/members", json={"user_id": other_user_id, "role": "editor"}, headers=headers)

    # Create a third user to be the removal target
    third_resp = await client.post("/auth/signup", json={
        "email": "third@example.com",
        "password": "securepassword123",
        "first_name": "Third",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    third_user_id = third_resp.json()["user"]["id"]
    await client.post(f"/households/{household_id}/members", json={"user_id": third_user_id, "role": "viewer"}, headers=headers)

    resp = await client.delete(f"/households/{household_id}/members/{third_user_id}", headers=other_headers)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"


async def test_remove_member_nonexistent_member_returns_404(client):
    """Removing nonexistent member returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    resp = await client.delete(f"/households/{household_id}/members/{NONEXISTENT_ID}", headers=headers)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Member not found"


async def test_remove_member_non_member_returns_404(client):
    """Non-member cannot remove members."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    create_resp = await _create_household(client, headers)
    household_id = create_resp.json()["id"]

    other_headers, _ = await _create_second_user(client)

    resp = await client.delete(f"/households/{household_id}/members/{user_id}", headers=other_headers)
    assert resp.status_code == 404


async def test_remove_member_without_auth_returns_401(client):
    """DELETE /households/{id}/members/{id} without auth returns 401."""
    resp = await client.delete(f"/households/{NONEXISTENT_ID}/members/{NONEXISTENT_ID}")
    assert resp.status_code == 401
