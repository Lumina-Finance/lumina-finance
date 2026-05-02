from tests.routes.conftest import _create_account, _create_user, _get_auth_header

# --- Helpers ---

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"

TAG_PAYLOAD = {
    "name": "vacation",
}


async def _create_tag(client, headers, **overrides):
    """Create a tag via POST /tags.

    Defaults: name="vacation".

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        **overrides: Fields to override in the default payload.

    Returns:
        The HTTP response from the API.
    """
    payload = {**TAG_PAYLOAD, **overrides}
    return await client.post("/tags", json=payload, headers=headers)


async def _create_second_user(client):
    """Sign up a second user for ownership-isolation tests.

    Args:
        client: The async test client.

    Returns:
        The HTTP response from the signup endpoint.
    """
    return await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "securepassword123",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })


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


async def _setup_group_with_member(client):
    """Create a group with an admin (owner) and a regular member.

    Args:
        client: The async test client.

    Returns:
        Tuple of (admin_headers, member_headers, member_user_id, group_id).
    """
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)

    member_resp = await client.post("/auth/signup", json={
        "email": "member@example.com",
        "password": "securepassword123",
        "first_name": "Member",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    member_headers = _get_auth_header(member_resp)
    member_user_id = member_resp.json()["user"]["id"]

    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )

    return admin_headers, member_headers, member_user_id, group_id


# --- GET /tags ---


async def test_list_tags_returns_empty_list(client):
    """User with no tags gets an empty list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/tags", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_tags_returns_user_tags(client):
    """User sees their own tags and not another user's."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_tag(client, headers, name="vacation")
    await _create_tag(client, headers, name="reimbursable")

    other_headers = _get_auth_header(await _create_second_user(client))
    await _create_tag(client, other_headers, name="other-tag")

    resp = await client.get("/tags", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    names = {t["name"] for t in data}
    assert names == {"vacation", "reimbursable"}


async def test_list_tags_supports_search(client):
    """Q filters the user's tags by case-insensitive partial name."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_tag(client, headers, name="Vacation")
    await _create_tag(client, headers, name="reimbursable")

    other_headers = _get_auth_header(await _create_second_user(client))
    await _create_tag(client, other_headers, name="reimbursable")

    resp = await client.get("/tags?q=IMB", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert [tag["name"] for tag in data] == ["reimbursable"]


async def test_list_tags_supports_limit_and_offset(client):
    """Limit and offset return deterministic name-sorted pages."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    for name in ["charlie", "alpha", "bravo"]:
        await _create_tag(client, headers, name=name)

    first_page = await client.get("/tags?limit=2", headers=headers)
    second_page = await client.get("/tags?limit=2&offset=2", headers=headers)

    assert first_page.status_code == 200
    assert second_page.status_code == 200
    assert [tag["name"] for tag in first_page.json()] == ["alpha", "bravo"]
    assert [tag["name"] for tag in second_page.json()] == ["charlie"]


async def test_list_tags_rejects_invalid_pagination_params(client):
    """Invalid limit and offset query params return 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    for url in ["/tags?limit=0", "/tags?limit=51", "/tags?offset=-1"]:
        resp = await client.get(url, headers=headers)
        assert resp.status_code == 422


async def test_list_tags_without_auth_returns_401(client):
    """GET /tags without an Authorization header returns 401."""
    resp = await client.get("/tags")
    assert resp.status_code == 401


# --- GET /tags/{tag_id} ---


async def test_get_tag_returns_tag(client):
    """Valid tag ID returns the tag with all fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_tag(client, headers)
    tag_id = create_resp.json()["id"]

    resp = await client.get(f"/tags/{tag_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "vacation"
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_get_tag_not_found_returns_404(client):
    """Non-existent tag ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/tags/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Tag not found"


async def test_get_tag_other_user_returns_404(client):
    """Accessing another user's tag returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tag(client, headers)
    tag_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.get(f"/tags/{tag_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_get_tag_without_auth_returns_401(client):
    """GET /tags/{id} without an Authorization header returns 401."""
    resp = await client.get(f"/tags/{NONEXISTENT_ID}")
    assert resp.status_code == 401


# --- POST /tags ---


async def test_create_tag_returns_201(client):
    """Valid payload creates a tag with correct fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    resp = await _create_tag(client, headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "vacation"
    assert data["group_id"] is None
    assert data["owner_id"] == user_id
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_create_tag_duplicate_name_returns_409(client):
    """Same name for the same user returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_tag(client, headers, name="vacation")
    resp = await _create_tag(client, headers, name="vacation")

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_create_tag_same_name_different_user_allowed(client):
    """Two different users can have tags with the same name."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    other_headers = _get_auth_header(await _create_second_user(client))

    resp1 = await _create_tag(client, headers, name="vacation")
    resp2 = await _create_tag(client, other_headers, name="vacation")

    assert resp1.status_code == 201
    assert resp2.status_code == 201
    assert resp1.json()["id"] != resp2.json()["id"]


async def test_create_tag_empty_name_returns_422(client):
    """Empty name returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_tag(client, headers, name="")

    assert resp.status_code == 422


async def test_create_tag_without_auth_returns_401(client):
    """POST /tags without an Authorization header returns 401."""
    resp = await client.post("/tags", json=TAG_PAYLOAD)
    assert resp.status_code == 401


# --- PATCH /tags/{tag_id} ---


async def test_patch_tag_updates_name(client):
    """PATCH updates name and returns the updated tag."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tag(client, headers)
    tag_id = create_resp.json()["id"]

    resp = await client.patch(f"/tags/{tag_id}", json={"name": "renamed"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "renamed"


async def test_patch_tag_empty_body_returns_unchanged(client):
    """PATCH with empty body returns 200 with no changes."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tag(client, headers)
    tag_id = create_resp.json()["id"]

    before = await client.get(f"/tags/{tag_id}", headers=headers)
    resp = await client.patch(f"/tags/{tag_id}", json={}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == before.json()


async def test_patch_tag_not_found_returns_404(client):
    """PATCH non-existent tag returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(f"/tags/{NONEXISTENT_ID}", json={"name": "X"}, headers=headers)

    assert resp.status_code == 404


async def test_patch_tag_other_user_returns_404(client):
    """PATCH on another user's tag returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tag(client, headers)
    tag_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.patch(f"/tags/{tag_id}", json={"name": "hacked"}, headers=other_headers)

    assert resp.status_code == 404


async def test_patch_tag_rename_to_duplicate_returns_409(client):
    """Renaming a tag to an existing name returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_tag(client, headers, name="alpha")
    create_resp = await _create_tag(client, headers, name="beta")
    tag_id = create_resp.json()["id"]

    resp = await client.patch(f"/tags/{tag_id}", json={"name": "alpha"}, headers=headers)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_patch_tag_without_auth_returns_401(client):
    """PATCH /tags/{id} without an Authorization header returns 401."""
    resp = await client.patch(f"/tags/{NONEXISTENT_ID}", json={"name": "X"})
    assert resp.status_code == 401


# --- DELETE /tags/{tag_id} ---


async def test_delete_tag_returns_204(client):
    """DELETE removes the tag and returns 204."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tag(client, headers)
    tag_id = create_resp.json()["id"]

    resp = await client.delete(f"/tags/{tag_id}", headers=headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/tags/{tag_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_tag_not_found_returns_404(client):
    """DELETE non-existent tag returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.delete(f"/tags/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404


async def test_delete_tag_other_user_returns_404(client):
    """Deleting another user's tag returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_tag(client, headers)
    tag_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.delete(f"/tags/{tag_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_delete_tag_without_auth_returns_401(client):
    """DELETE /tags/{id} without an Authorization header returns 401."""
    resp = await client.delete(f"/tags/{NONEXISTENT_ID}")
    assert resp.status_code == 401


async def test_delete_tag_referenced_by_transaction_returns_409(client):
    """Deleting a tag that is linked to a transaction returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    tag_resp = await _create_tag(client, headers)
    tag_id = tag_resp.json()["id"]

    acct_resp = await _create_account(client, headers)
    account_id = acct_resp.json()["id"]

    cat_resp = await client.post("/categories", json={
        "name": "Misc", "kind": "expense",
    }, headers=headers)
    category_id = cat_resp.json()["id"]

    txn_resp = await client.post("/transactions", json={
        "account_id": account_id,
        "category_id": category_id,
        "dt": "2026-03-15",
        "amount": -5000,
        "currency": "CAD",
        "tag_ids": [tag_id],
    }, headers=headers)
    assert txn_resp.status_code == 201

    resp = await client.delete(f"/tags/{tag_id}", headers=headers)

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Tag is referenced by existing transactions"


# --- Group tags: POST /tags ---


async def test_create_group_tag_as_member_returns_201(client):
    """Any group member can create a group tag. Owner is the creating member."""
    _, member_headers, member_user_id, group_id = await _setup_group_with_member(client)

    resp = await _create_tag(client, member_headers, name="shared-expense", group_id=group_id)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "shared-expense"
    assert data["group_id"] == group_id
    assert data["owner_id"] == member_user_id


async def test_create_group_tag_as_admin_returns_201(client):
    """Admin can create a group tag."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    resp = await _create_tag(client, admin_headers, name="household", group_id=group_id)

    assert resp.status_code == 201
    assert resp.json()["group_id"] == group_id


async def test_create_group_tag_non_member_returns_404(client):
    """Non-member cannot create a tag in a group."""
    _, _, _, group_id = await _setup_group_with_member(client)

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await _create_tag(client, outsider_headers, group_id=group_id)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Group not found"


async def test_create_group_tag_duplicate_returns_409(client):
    """Duplicate name within the same group returns 409."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_tag(client, admin_headers, name="shared", group_id=group_id)
    resp = await _create_tag(client, admin_headers, name="shared", group_id=group_id)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_create_group_tag_same_name_as_personal_allowed(client):
    """Personal and group tags with the same name can coexist."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    personal = await _create_tag(client, admin_headers, name="vacation")
    group = await _create_tag(client, admin_headers, name="vacation", group_id=group_id)

    assert personal.status_code == 201
    assert group.status_code == 201
    assert personal.json()["id"] != group.json()["id"]


async def test_create_group_tag_nonexistent_group_returns_404(client):
    """Creating a tag with a fake group_id returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_tag(client, headers, group_id=NONEXISTENT_ID)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Group not found"


# --- Group tags: GET /tags ---


async def test_list_tags_with_group_filter_as_admin(client):
    """Admin passing group_id returns personal + that group's tags."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_tag(client, admin_headers, name="personal-tag")
    await _create_tag(client, admin_headers, name="shared-tag", group_id=group_id)

    resp = await client.get(f"/tags?group_id={group_id}", headers=admin_headers)

    assert resp.status_code == 200
    names = {t["name"] for t in resp.json()}
    assert "personal-tag" in names
    assert "shared-tag" in names


async def test_list_tags_with_group_filter_as_member(client):
    """Non-admin member passing group_id also sees group tags."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    await _create_tag(client, admin_headers, name="shared-tag", group_id=group_id)

    resp = await client.get(f"/tags?group_id={group_id}", headers=member_headers)

    assert resp.status_code == 200
    names = {t["name"] for t in resp.json()}
    assert "shared-tag" in names


async def test_list_tags_without_group_filter_excludes_group(client):
    """Without group_id filter, only personal tags are returned."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_tag(client, admin_headers, name="personal-tag")
    await _create_tag(client, admin_headers, name="shared-tag", group_id=group_id)

    resp = await client.get("/tags", headers=admin_headers)

    assert resp.status_code == 200
    names = {t["name"] for t in resp.json()}
    assert "personal-tag" in names
    assert "shared-tag" not in names


async def test_list_tags_group_filter_supports_search_and_pagination(client):
    """group_id, q, limit, and offset compose for lazy-loaded group tag pickers."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_tag(client, admin_headers, name="shared-alpha", group_id=group_id)
    await _create_tag(client, admin_headers, name="shared-bravo", group_id=group_id)
    await _create_tag(client, admin_headers, name="shared-charlie", group_id=group_id)
    await _create_tag(client, admin_headers, name="personal-shared")
    await _create_tag(client, admin_headers, name="private")

    first_page = await client.get(
        f"/tags?group_id={group_id}&q=shared&limit=2",
        headers=admin_headers,
    )
    second_page = await client.get(
        f"/tags?group_id={group_id}&q=shared&limit=2&offset=2",
        headers=admin_headers,
    )

    assert first_page.status_code == 200
    assert second_page.status_code == 200
    assert [tag["name"] for tag in first_page.json()] == ["personal-shared", "shared-alpha"]
    assert [tag["name"] for tag in second_page.json()] == ["shared-bravo", "shared-charlie"]


async def test_list_tags_group_filter_non_member_returns_404(client):
    """Non-member passing group_id filter returns 404."""
    _, _, _, group_id = await _setup_group_with_member(client)

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.get(f"/tags?group_id={group_id}", headers=outsider_headers)

    assert resp.status_code == 404


async def test_get_group_tag_as_member(client):
    """Non-admin member can view a group tag."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_tag(client, admin_headers, name="shared", group_id=group_id)
    tag_id = create_resp.json()["id"]

    resp = await client.get(f"/tags/{tag_id}", headers=member_headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "shared"
    assert resp.json()["group_id"] == group_id


async def test_get_group_tag_non_member_returns_404(client):
    """Non-member cannot view a group tag."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_tag(client, admin_headers, name="shared", group_id=group_id)
    tag_id = create_resp.json()["id"]

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.get(f"/tags/{tag_id}", headers=outsider_headers)

    assert resp.status_code == 404


async def test_list_tags_with_group_filter_excludes_other_groups(client):
    """Tag created in Group A must not appear when listing with Group B's filter."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_a = await _create_group(client, headers)
    group_b = await _create_group(client, headers)

    await _create_tag(client, headers, name="personal-tag")
    await _create_tag(client, headers, name="group-a-tag", group_id=group_a)
    await _create_tag(client, headers, name="group-b-tag", group_id=group_b)

    resp = await client.get(f"/tags?group_id={group_b}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    names = {t["name"] for t in data}
    assert len(data) == 2
    assert "personal-tag" in names
    assert "group-b-tag" in names
    assert "group-a-tag" not in names


# --- Group tags: PATCH /tags ---


async def test_patch_group_tag_as_admin(client):
    """Admin can update a group tag."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_tag(client, admin_headers, name="old-name", group_id=group_id)
    tag_id = create_resp.json()["id"]

    resp = await client.patch(f"/tags/{tag_id}", json={"name": "new-name"}, headers=admin_headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "new-name"


async def test_patch_group_tag_as_non_admin_returns_403(client):
    """Non-admin member cannot update a group tag."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_tag(client, admin_headers, name="shared", group_id=group_id)
    tag_id = create_resp.json()["id"]

    resp = await client.patch(f"/tags/{tag_id}", json={"name": "hacked"}, headers=member_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"

    # Verify the tag was not mutated
    get_resp = await client.get(f"/tags/{tag_id}", headers=admin_headers)
    assert get_resp.json()["name"] == "shared"


async def test_patch_group_tag_non_member_returns_404(client):
    """Non-member cannot see or update a group tag."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_tag(client, admin_headers, name="shared", group_id=group_id)
    tag_id = create_resp.json()["id"]

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.patch(f"/tags/{tag_id}", json={"name": "hacked"}, headers=outsider_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Tag not found"


async def test_patch_group_tag_rename_to_duplicate_returns_409(client):
    """Renaming a group tag to an existing group tag name returns 409."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_tag(client, admin_headers, name="alpha", group_id=group_id)
    create_resp = await _create_tag(client, admin_headers, name="beta", group_id=group_id)
    tag_id = create_resp.json()["id"]

    resp = await client.patch(f"/tags/{tag_id}", json={"name": "alpha"}, headers=admin_headers)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


# --- Group tags: DELETE /tags ---


async def test_delete_group_tag_as_admin(client):
    """Admin can delete a group tag."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_tag(client, admin_headers, name="to-delete", group_id=group_id)
    tag_id = create_resp.json()["id"]

    resp = await client.delete(f"/tags/{tag_id}", headers=admin_headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/tags/{tag_id}", headers=admin_headers)
    assert get_resp.status_code == 404


async def test_delete_group_tag_as_non_admin_returns_403(client):
    """Non-admin member cannot delete a group tag."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_tag(client, admin_headers, name="shared", group_id=group_id)
    tag_id = create_resp.json()["id"]

    resp = await client.delete(f"/tags/{tag_id}", headers=member_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"

    # Verify the tag still exists
    get_resp = await client.get(f"/tags/{tag_id}", headers=admin_headers)
    assert get_resp.status_code == 200


async def test_delete_group_tag_non_member_returns_404(client):
    """Non-member cannot see or delete a group tag."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_tag(client, admin_headers, name="shared", group_id=group_id)
    tag_id = create_resp.json()["id"]

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.delete(f"/tags/{tag_id}", headers=outsider_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Tag not found"
