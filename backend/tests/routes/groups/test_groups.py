from tests.routes.support import _create_user, _get_auth_header

# --- Helpers ---

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"


async def _create_group(client, headers, **overrides):
    """Create a group via POST /groups.

    Defaults: name="Smith Family".

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        **overrides: Fields to override in the default payload.

    Returns:
        The HTTP response from the API.
    """
    payload = {"name": "Smith Family", **overrides}
    return await client.post("/groups", json=payload, headers=headers)


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


# --- POST /groups ---


async def test_create_group_returns_201(client):
    """Valid payload creates a group with correct fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    resp = await _create_group(client, headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Smith Family"
    assert data["owner_id"] == user_id
    assert data["profile_pic"] is None
    assert data["is_archived"] is False
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_create_group_auto_adds_creator_as_admin(client):
    """Creator is auto-added as an admin member."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    group_resp = await _create_group(client, headers)
    group_id = group_resp.json()["id"]

    members_resp = await client.get(f"/groups/{group_id}/members", headers=headers)

    assert members_resp.status_code == 200
    members = members_resp.json()
    assert len(members) == 1
    assert members[0]["user_id"] == user_id
    assert members[0]["is_admin"] is True


async def test_create_group_with_profile_pic(client):
    """Profile pic is stored and returned when provided."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_group(client, headers, profile_pic="https://example.com/pic.jpg")

    assert resp.status_code == 201
    assert resp.json()["profile_pic"] == "https://example.com/pic.jpg"


async def test_create_group_empty_name_returns_422(client):
    """Empty name violates min_length=1 and returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_group(client, headers, name="")
    assert resp.status_code == 422


async def test_create_group_name_too_long_returns_422(client):
    """Name exceeding 128 characters returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_group(client, headers, name="A" * 129)
    assert resp.status_code == 422


async def test_create_group_without_auth_returns_401(client):
    """POST /groups without an Authorization header returns 401."""
    resp = await client.post("/groups", json={"name": "Test"})
    assert resp.status_code == 401


# --- GET /groups ---


async def test_list_groups_returns_empty_list(client):
    """User with no groups gets an empty list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/groups", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_groups_returns_user_groups(client):
    """User sees groups they are a member of."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_group(client, headers, name="Family")
    await _create_group(client, headers, name="Roommates")

    resp = await client.get("/groups", headers=headers)

    assert resp.status_code == 200
    names = [h["name"] for h in resp.json()]
    assert names == ["Family", "Roommates"]


async def test_list_groups_excludes_other_users(client):
    """User does not see groups they are not a member of."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _create_group(client, headers, name="My Group")

    other_headers, _ = await _create_second_user(client)
    await _create_group(client, other_headers, name="Their Group")

    resp = await client.get("/groups", headers=headers)

    assert len(resp.json()) == 1
    assert resp.json()[0]["name"] == "My Group"


async def test_list_groups_includes_archived_by_default(client):
    """Archived groups are included in the default list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_group(client, headers, name="Active")
    archived_resp = await _create_group(client, headers, name="Old")
    archived_id = archived_resp.json()["id"]
    await client.patch(f"/groups/{archived_id}", json={"is_archived": True}, headers=headers)

    resp = await client.get("/groups", headers=headers)

    assert len(resp.json()) == 2
    names = {h["name"] for h in resp.json()}
    assert names == {"Active", "Old"}


async def test_list_groups_exclude_archived(client):
    """exclude_archived=true hides archived groups."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_group(client, headers, name="Active")
    archived_resp = await _create_group(client, headers, name="Old")
    archived_id = archived_resp.json()["id"]
    await client.patch(f"/groups/{archived_id}", json={"is_archived": True}, headers=headers)

    resp = await client.get("/groups?exclude_archived=true", headers=headers)

    assert len(resp.json()) == 1
    assert resp.json()[0]["name"] == "Active"


async def test_list_groups_without_auth_returns_401(client):
    """GET /groups without an Authorization header returns 401."""
    resp = await client.get("/groups")
    assert resp.status_code == 401


# --- GET /groups/{id} ---


async def test_get_group_returns_group(client):
    """Member can retrieve a group by ID."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    resp = await client.get(f"/groups/{group_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["id"] == group_id
    assert resp.json()["name"] == "Smith Family"


async def test_get_group_non_member_returns_404(client):
    """Non-member cannot see a group."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    other_headers, _ = await _create_second_user(client)

    resp = await client.get(f"/groups/{group_id}", headers=other_headers)
    assert resp.status_code == 404


async def test_get_group_not_found_returns_404(client):
    """Nonexistent group ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/groups/{NONEXISTENT_ID}", headers=headers)
    assert resp.status_code == 404


async def test_get_group_without_auth_returns_401(client):
    """GET /groups/{id} without auth returns 401."""
    resp = await client.get(f"/groups/{NONEXISTENT_ID}")
    assert resp.status_code == 401


# --- PATCH /groups/{id} ---


async def test_update_group_name(client):
    """Admin can update group name."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    resp = await client.patch(f"/groups/{group_id}", json={"name": "Jones Family"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "Jones Family"


async def test_update_group_archives(client):
    """Admin can archive a group."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    resp = await client.patch(f"/groups/{group_id}", json={"is_archived": True}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["is_archived"] is True


async def test_update_group_empty_body_returns_unchanged(client):
    """PATCH with empty body returns 200 with no changes."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    resp = await client.patch(f"/groups/{group_id}", json={}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "Smith Family"


async def test_update_group_by_non_admin_returns_403(client):
    """Non-admin member cannot update group."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    other_headers, other_user_id = await _create_second_user(client)
    await client.post(f"/groups/{group_id}/members", json={"user_id": other_user_id}, headers=headers)

    resp = await client.patch(f"/groups/{group_id}", json={"name": "Nope"}, headers=other_headers)
    assert resp.status_code == 403


async def test_update_group_non_member_returns_404(client):
    """Non-member cannot update group."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    other_headers, _ = await _create_second_user(client)

    resp = await client.patch(f"/groups/{group_id}", json={"name": "Nope"}, headers=other_headers)
    assert resp.status_code == 404


async def test_update_group_profile_pic(client):
    """Admin can set and clear profile_pic."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    resp = await client.patch(f"/groups/{group_id}", json={"profile_pic": "https://example.com/pic.jpg"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["profile_pic"] == "https://example.com/pic.jpg"

    resp = await client.patch(f"/groups/{group_id}", json={"profile_pic": None}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["profile_pic"] is None


async def test_update_group_empty_name_returns_422(client):
    """Empty name on PATCH violates min_length=1 and returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    resp = await client.patch(f"/groups/{group_id}", json={"name": ""}, headers=headers)
    assert resp.status_code == 422


async def test_update_group_without_auth_returns_401(client):
    """PATCH /groups/{id} without auth returns 401."""
    resp = await client.patch(f"/groups/{NONEXISTENT_ID}", json={"name": "Nope"})
    assert resp.status_code == 401


# --- DELETE /groups/{id} ---


async def test_delete_group_by_owner_returns_204(client):
    """Owner can delete a group."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    resp = await client.delete(f"/groups/{group_id}", headers=headers)
    assert resp.status_code == 204

    get_resp = await client.get(f"/groups/{group_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_group_by_admin_non_owner_returns_403(client):
    """Admin who is not the owner cannot delete."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    other_headers, other_user_id = await _create_second_user(client)
    await client.post(f"/groups/{group_id}/members", json={"user_id": other_user_id}, headers=headers)
    await client.patch(f"/groups/{group_id}/members/{other_user_id}", json={"is_admin": True}, headers=headers)

    resp = await client.delete(f"/groups/{group_id}", headers=other_headers)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Only the owner can delete this group"


async def test_delete_group_by_non_member_returns_404(client):
    """Non-member cannot delete group."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    other_headers, _ = await _create_second_user(client)

    resp = await client.delete(f"/groups/{group_id}", headers=other_headers)
    assert resp.status_code == 404


async def test_delete_group_nonexistent_id_returns_404(client):
    """Deleting a nonexistent group returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.delete(f"/groups/{NONEXISTENT_ID}", headers=headers)
    assert resp.status_code == 404


async def test_delete_group_twice_returns_404(client):
    """Deleting the same group twice returns 204 then 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    resp1 = await client.delete(f"/groups/{group_id}", headers=headers)
    resp2 = await client.delete(f"/groups/{group_id}", headers=headers)

    assert resp1.status_code == 204
    assert resp2.status_code == 404


async def test_delete_group_without_auth_returns_401(client):
    """DELETE /groups/{id} without auth returns 401."""
    resp = await client.delete(f"/groups/{NONEXISTENT_ID}")
    assert resp.status_code == 401


# --- GET /groups/{id}/members ---


async def test_list_members_returns_all_members(client):
    """Lists all members including creator and added member."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    _, other_user_id = await _create_second_user(client)
    await client.post(f"/groups/{group_id}/members", json={"user_id": other_user_id}, headers=headers)

    resp = await client.get(f"/groups/{group_id}/members", headers=headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 2
    admin_flags = {m["is_admin"] for m in resp.json()}
    assert admin_flags == {True, False}


async def test_list_members_by_non_member_returns_404(client):
    """Non-member cannot list members."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    other_headers, _ = await _create_second_user(client)

    resp = await client.get(f"/groups/{group_id}/members", headers=other_headers)
    assert resp.status_code == 404


async def test_list_members_without_auth_returns_401(client):
    """GET /groups/{id}/members without auth returns 401."""
    resp = await client.get(f"/groups/{NONEXISTENT_ID}/members")
    assert resp.status_code == 401


# --- POST /groups/{id}/members ---


async def test_add_member_returns_201(client):
    """Admin adds a member who defaults to non-admin."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    _, other_user_id = await _create_second_user(client)

    resp = await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )

    assert resp.status_code == 201
    assert resp.json()["user_id"] == other_user_id
    assert resp.json()["is_admin"] is False


async def test_add_member_duplicate_returns_409(client):
    """Adding an existing member returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    _, other_user_id = await _create_second_user(client)
    await client.post(f"/groups/{group_id}/members", json={"user_id": other_user_id}, headers=headers)

    resp = await client.post(f"/groups/{group_id}/members", json={"user_id": other_user_id}, headers=headers)

    assert resp.status_code == 409
    assert resp.json()["detail"] == "User is already a member"


async def test_add_member_nonexistent_user_id_returns_422(client):
    """Adding a nonexistent user returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    resp = await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": NONEXISTENT_ID},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid user"


async def test_add_member_by_non_owner_admin_returns_201(client):
    """Non-owner admin can add members."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    other_headers, other_user_id = await _create_second_user(client)
    await client.post(f"/groups/{group_id}/members", json={"user_id": other_user_id}, headers=headers)
    await client.patch(f"/groups/{group_id}/members/{other_user_id}", json={"is_admin": True}, headers=headers)

    third_resp = await client.post("/auth/signup", json={
        "email": "third@example.com", "password": "SecurePassword123!",
        "first_name": "Third", "tz": "America/Toronto", "base_currency": "CAD",
    })
    third_user_id = third_resp.json()["user"]["id"]

    resp = await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": third_user_id},
        headers=other_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["is_admin"] is False


async def test_add_member_by_non_admin_returns_403(client):
    """Non-admin member cannot add members."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    other_headers, other_user_id = await _create_second_user(client)
    await client.post(f"/groups/{group_id}/members", json={"user_id": other_user_id}, headers=headers)

    resp = await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": NONEXISTENT_ID},
        headers=other_headers,
    )
    assert resp.status_code == 403


async def test_add_member_by_non_member_returns_404(client):
    """Non-member cannot add members."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    other_headers, _ = await _create_second_user(client)

    resp = await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": NONEXISTENT_ID},
        headers=other_headers,
    )
    assert resp.status_code == 404


async def test_add_member_without_auth_returns_401(client):
    """POST /groups/{id}/members without auth returns 401."""
    resp = await client.post(f"/groups/{NONEXISTENT_ID}/members", json={"user_id": NONEXISTENT_ID})
    assert resp.status_code == 401


# --- PATCH /groups/{id}/members/{member_id} ---


async def test_promote_member_to_admin_returns_200(client):
    """Owner can promote a member to admin."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    _, other_user_id = await _create_second_user(client)
    await client.post(f"/groups/{group_id}/members", json={"user_id": other_user_id}, headers=headers)

    resp = await client.patch(
        f"/groups/{group_id}/members/{other_user_id}",
        json={"is_admin": True},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["is_admin"] is True


async def test_demote_admin_returns_200(client):
    """Owner can demote an admin to regular member."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    _, other_user_id = await _create_second_user(client)
    await client.post(f"/groups/{group_id}/members", json={"user_id": other_user_id}, headers=headers)
    await client.patch(f"/groups/{group_id}/members/{other_user_id}", json={"is_admin": True}, headers=headers)

    resp = await client.patch(
        f"/groups/{group_id}/members/{other_user_id}",
        json={"is_admin": False},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["is_admin"] is False


async def test_demote_owner_returns_403(client):
    """Cannot demote the group owner."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/groups/{group_id}/members/{user_id}",
        json={"is_admin": False},
        headers=headers,
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Cannot demote the owner"


async def test_promote_member_nonexistent_returns_404(client):
    """Promoting a nonexistent member returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/groups/{group_id}/members/{NONEXISTENT_ID}",
        json={"is_admin": True},
        headers=headers,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Member not found"


async def test_non_owner_admin_cannot_promote_returns_403(client):
    """Admin who is not the owner cannot promote/demote members."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    other_headers, other_user_id = await _create_second_user(client)
    await client.post(f"/groups/{group_id}/members", json={"user_id": other_user_id}, headers=headers)
    # Promote other user to admin
    await client.patch(f"/groups/{group_id}/members/{other_user_id}", json={"is_admin": True}, headers=headers)

    # Create a third user to be the target
    third_resp = await client.post("/auth/signup", json={
        "email": "third@example.com", "password": "SecurePassword123!",
        "first_name": "Third", "tz": "America/Toronto", "base_currency": "CAD",
    })
    third_user_id = third_resp.json()["user"]["id"]
    await client.post(f"/groups/{group_id}/members", json={"user_id": third_user_id}, headers=headers)

    # Non-owner admin tries to promote third user
    resp = await client.patch(
        f"/groups/{group_id}/members/{third_user_id}",
        json={"is_admin": True},
        headers=other_headers,
    )
    assert resp.status_code == 403


async def test_regular_member_cannot_promote_returns_403(client):
    """Non-admin member cannot promote/demote."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    other_headers, other_user_id = await _create_second_user(client)
    await client.post(f"/groups/{group_id}/members", json={"user_id": other_user_id}, headers=headers)

    resp = await client.patch(
        f"/groups/{group_id}/members/{other_user_id}",
        json={"is_admin": True},
        headers=other_headers,
    )
    assert resp.status_code == 403


async def test_promote_member_non_member_returns_404(client):
    """Non-member cannot change admin status."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    other_headers, _ = await _create_second_user(client)

    resp = await client.patch(
        f"/groups/{group_id}/members/{user_id}",
        json={"is_admin": True},
        headers=other_headers,
    )
    assert resp.status_code == 404


async def test_promote_member_without_auth_returns_401(client):
    """PATCH /groups/{id}/members/{id} without auth returns 401."""
    resp = await client.patch(f"/groups/{NONEXISTENT_ID}/members/{NONEXISTENT_ID}", json={"is_admin": True})
    assert resp.status_code == 401


# --- DELETE /groups/{id}/members/{member_id} ---


async def test_remove_member_admin_removes_other_returns_204(client):
    """Admin removes another member. Follow-up confirms removal."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    _, other_user_id = await _create_second_user(client)
    await client.post(f"/groups/{group_id}/members", json={"user_id": other_user_id}, headers=headers)

    resp = await client.delete(f"/groups/{group_id}/members/{other_user_id}", headers=headers)
    assert resp.status_code == 204

    members_resp = await client.get(f"/groups/{group_id}/members", headers=headers)
    assert len(members_resp.json()) == 1


async def test_remove_member_self_leave_returns_204(client):
    """Non-admin member can leave the group."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    other_headers, other_user_id = await _create_second_user(client)
    await client.post(f"/groups/{group_id}/members", json={"user_id": other_user_id}, headers=headers)

    resp = await client.delete(f"/groups/{group_id}/members/{other_user_id}", headers=other_headers)
    assert resp.status_code == 204

    members_resp = await client.get(f"/groups/{group_id}/members", headers=headers)
    assert len(members_resp.json()) == 1


async def test_remove_member_owner_cannot_be_removed_returns_403(client):
    """Admin cannot remove the owner."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    other_headers, other_user_id = await _create_second_user(client)
    await client.post(f"/groups/{group_id}/members", json={"user_id": other_user_id}, headers=headers)
    await client.patch(f"/groups/{group_id}/members/{other_user_id}", json={"is_admin": True}, headers=headers)

    resp = await client.delete(f"/groups/{group_id}/members/{user_id}", headers=other_headers)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Cannot remove the owner"


async def test_remove_member_owner_cannot_self_leave_returns_403(client):
    """Owner cannot leave their own group."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    resp = await client.delete(f"/groups/{group_id}/members/{user_id}", headers=headers)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Cannot remove the owner"


async def test_remove_member_non_admin_cannot_remove_others_returns_403(client):
    """Non-admin member cannot remove other members."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    other_headers, other_user_id = await _create_second_user(client)
    await client.post(f"/groups/{group_id}/members", json={"user_id": other_user_id}, headers=headers)

    # Create a third user to be the removal target
    third_resp = await client.post("/auth/signup", json={
        "email": "third@example.com",
        "password": "SecurePassword123!",
        "first_name": "Third",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    third_user_id = third_resp.json()["user"]["id"]
    await client.post(f"/groups/{group_id}/members", json={"user_id": third_user_id}, headers=headers)

    resp = await client.delete(f"/groups/{group_id}/members/{third_user_id}", headers=other_headers)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"


async def test_remove_member_nonexistent_member_returns_404(client):
    """Removing nonexistent member returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    resp = await client.delete(f"/groups/{group_id}/members/{NONEXISTENT_ID}", headers=headers)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Member not found"


async def test_remove_member_non_member_returns_404(client):
    """Non-member cannot remove members."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    create_resp = await _create_group(client, headers)
    group_id = create_resp.json()["id"]

    other_headers, _ = await _create_second_user(client)

    resp = await client.delete(f"/groups/{group_id}/members/{user_id}", headers=other_headers)
    assert resp.status_code == 404


async def test_remove_member_without_auth_returns_401(client):
    """DELETE /groups/{id}/members/{id} without auth returns 401."""
    resp = await client.delete(f"/groups/{NONEXISTENT_ID}/members/{NONEXISTENT_ID}")
    assert resp.status_code == 401
