from tests.routes.conftest import _create_user, _get_auth_header

# --- Helpers ---

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"

CATEGORY_PAYLOAD = {
    "name": "Custom Test Category",
    "kind": "expense",
}


async def _create_category(client, headers, **overrides):
    """Create a category via POST /categories.

    Defaults: name="Custom Test Category", kind="expense".

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        **overrides: Fields to override in the default payload.

    Returns:
        The HTTP response from the API.
    """
    payload = {**CATEGORY_PAYLOAD, **overrides}
    return await client.post("/categories", json=payload, headers=headers)


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


# --- GET /categories ---


async def test_list_categories_returns_seeded_defaults(client):
    """New user sees global system categories."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/categories", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) > 0
    names = {c["name"] for c in data}
    assert "Groceries" in names
    assert "Salary" in names
    assert "Balance Adjustment" in names
    assert "Transfer" in names
    assert "Debt Payment" in names
    assert "Fuel" in names
    assert "Miscellaneous" in names
    assert "Capital Gains" in names
    assert "Gas" not in names
    assert "Capital Gains/Losses" not in names

    by_name = {c["name"]: c for c in data}
    assert by_name["Groceries"]["icon"] == "🛒"
    assert by_name["Miscellaneous"]["kind"] == "expense"
    assert by_name["Debt Payment"]["kind"] == "expense"
    assert by_name["Debt Payment"]["is_system"] is True
    assert by_name["Vehicle Maintenance"]["is_system"] is True
    assert by_name["Balance Adjustment"]["kind"] == "transfer"
    assert by_name["Balance Adjustment"]["is_system"] is True
    assert by_name["Credit Card Payment"]["kind"] == "transfer"
    assert by_name["Credit Card Payment"]["is_system"] is True
    assert by_name["Transfer"]["is_system"] is True
    assert by_name["Groceries"]["owner_id"] is None


async def test_list_categories_returns_user_categories(client):
    """User sees their own categories and not another user's."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    # Count seeded categories, then add a custom one
    seeded_resp = await client.get("/categories", headers=headers)
    seeded_count = len(seeded_resp.json())

    await _create_category(client, headers, name="My Custom")

    # Second user creates a category that should not appear
    other_headers = _get_auth_header(await _create_second_user(client))
    await _create_category(client, other_headers, name="Other Expense")

    resp = await client.get("/categories", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == seeded_count + 1
    names = {c["name"] for c in data}
    assert "My Custom" in names
    assert "Other Expense" not in names



async def test_list_categories_without_auth_returns_401(client):
    """GET /categories without an Authorization header returns 401."""
    resp = await client.get("/categories")
    assert resp.status_code == 401


# --- GET /categories/{category_id} ---


async def test_get_category_returns_category(client):
    """Valid category ID returns the category with all fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_category(client, headers)
    category_id = create_resp.json()["id"]

    resp = await client.get(f"/categories/{category_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Custom Test Category"
    assert data["kind"] == "expense"
    assert data["group_id"] is None


async def test_get_category_not_found_returns_404(client):
    """Non-existent category ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/categories/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Category not found"


async def test_get_category_other_user_returns_404(client):
    """Accessing another user's category returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_category(client, headers)
    category_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.get(f"/categories/{category_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_get_category_without_auth_returns_401(client):
    """GET /categories/{id} without an Authorization header returns 401."""
    resp = await client.get(f"/categories/{NONEXISTENT_ID}")
    assert resp.status_code == 401


# --- POST /categories ---


async def test_create_category_returns_201(client):
    """Valid payload creates a category with correct fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_category(client, headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Custom Test Category"
    assert data["kind"] == "expense"
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_create_category_duplicate_name_returns_409(client):
    """Same name for the same user returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_category(client, headers, name="Duplicate Test", kind="expense")
    resp = await _create_category(client, headers, name="Duplicate Test", kind="expense")

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_create_category_same_name_different_kind_returns_409(client):
    """Same name with a different kind is still a duplicate."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp1 = await _create_category(client, headers, name="Misc", kind="expense")
    resp2 = await _create_category(client, headers, name="Misc", kind="income")

    assert resp1.status_code == 201
    assert resp2.status_code == 409


async def test_create_category_invalid_kind_returns_422(client):
    """Invalid kind returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_category(client, headers, kind="not_a_real_kind")

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid category kind"


async def test_create_category_empty_name_returns_422(client):
    """Empty name returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_category(client, headers, name="")

    assert resp.status_code == 422


async def test_create_category_without_auth_returns_401(client):
    """POST /categories without an Authorization header returns 401."""
    resp = await client.post("/categories", json=CATEGORY_PAYLOAD)
    assert resp.status_code == 401


# --- PATCH /categories/{category_id} ---


async def test_patch_category_updates_name(client):
    """PATCH updates name and returns the updated category."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_category(client, headers)
    category_id = create_resp.json()["id"]

    resp = await client.patch(f"/categories/{category_id}", json={"name": "Renamed"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"


async def test_patch_category_empty_body_returns_unchanged(client):
    """PATCH with empty body returns 200 with no changes."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_category(client, headers)
    category_id = create_resp.json()["id"]

    before = await client.get(f"/categories/{category_id}", headers=headers)
    resp = await client.patch(f"/categories/{category_id}", json={}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == before.json()


async def test_patch_category_not_found_returns_404(client):
    """PATCH non-existent category returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(f"/categories/{NONEXISTENT_ID}", json={"name": "X"}, headers=headers)

    assert resp.status_code == 404


async def test_patch_category_other_user_returns_404(client):
    """PATCH on another user's category returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_category(client, headers)
    category_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.patch(f"/categories/{category_id}", json={"name": "Hacked"}, headers=other_headers)

    assert resp.status_code == 404


async def test_patch_category_rename_to_duplicate_returns_409(client):
    """Renaming a category to an existing name returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_category(client, headers, name="Alpha Unique", kind="expense")
    create_resp = await _create_category(client, headers, name="Beta Unique", kind="expense")
    category_id = create_resp.json()["id"]

    resp = await client.patch(f"/categories/{category_id}", json={"name": "Alpha Unique"}, headers=headers)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]

    # Verify the category was not mutated
    get_resp = await client.get(f"/categories/{category_id}", headers=headers)
    assert get_resp.json()["name"] == "Beta Unique"


async def test_patch_system_category_returns_403(client):
    """System categories cannot be modified."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    categories_resp = await client.get("/categories", headers=headers)
    category_id = next(c["id"] for c in categories_resp.json() if c["name"] == "Transfer")

    resp = await client.patch(f"/categories/{category_id}", json={"name": "Moved Money"}, headers=headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "System categories cannot be modified"


async def test_patch_category_without_auth_returns_401(client):
    """PATCH /categories/{id} without an Authorization header returns 401."""
    resp = await client.patch(f"/categories/{NONEXISTENT_ID}", json={"name": "X"})
    assert resp.status_code == 401


# --- DELETE /categories/{category_id} ---


async def test_delete_category_returns_204(client):
    """DELETE removes the category and returns 204."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_category(client, headers)
    category_id = create_resp.json()["id"]

    resp = await client.delete(f"/categories/{category_id}", headers=headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/categories/{category_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_category_not_found_returns_404(client):
    """DELETE non-existent category returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.delete(f"/categories/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404


async def test_delete_category_other_user_returns_404(client):
    """Deleting another user's category returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_category(client, headers)
    category_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.delete(f"/categories/{category_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_delete_category_without_auth_returns_401(client):
    """DELETE /categories/{id} without an Authorization header returns 401."""
    resp = await client.delete(f"/categories/{NONEXISTENT_ID}")
    assert resp.status_code == 401


async def test_delete_system_category_returns_403(client):
    """System categories cannot be deleted."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    categories_resp = await client.get("/categories", headers=headers)
    category_id = next(c["id"] for c in categories_resp.json() if c["name"] == "Credit Card Payment")

    resp = await client.delete(f"/categories/{category_id}", headers=headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "System categories cannot be deleted"


async def test_double_delete_returns_404_on_second(client):
    """Deleting the same category twice returns 204 then 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_category(client, headers)
    category_id = create_resp.json()["id"]

    resp1 = await client.delete(f"/categories/{category_id}", headers=headers)
    resp2 = await client.delete(f"/categories/{category_id}", headers=headers)

    assert resp1.status_code == 204
    assert resp2.status_code == 404


# --- Group categories: POST /categories ---


async def test_create_group_category_as_member_returns_201(client):
    """Any group member can create a group category."""
    _, member_headers, _, group_id = await _setup_group_with_member(client)

    resp = await _create_category(client, member_headers, name="Games", group_id=group_id)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Games"
    assert data["group_id"] == group_id
    assert data["owner_id"] is None


async def test_create_group_category_as_admin_returns_201(client):
    """Admin can create a group category."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    resp = await _create_category(client, admin_headers, name="Test Utilities", group_id=group_id)

    assert resp.status_code == 201
    assert resp.json()["group_id"] == group_id


async def test_create_group_category_non_member_returns_404(client):
    """Non-member cannot create a category in a group."""
    _, _, _, group_id = await _setup_group_with_member(client)

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await _create_category(client, outsider_headers, group_id=group_id)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Group not found"


async def test_create_group_category_duplicate_returns_409(client):
    """Duplicate name within the same group returns 409."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_category(client, admin_headers, name="Food", kind="expense", group_id=group_id)
    resp = await _create_category(client, admin_headers, name="Food", kind="expense", group_id=group_id)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_create_group_category_same_name_as_personal_allowed(client):
    """Personal and group categories with the same name can coexist."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    personal = await _create_category(client, admin_headers, name="Coexist Test", kind="expense")
    group = await _create_category(client, admin_headers, name="Coexist Test", kind="expense", group_id=group_id)

    assert personal.status_code == 201
    assert group.status_code == 201
    assert personal.json()["id"] != group.json()["id"]


async def test_create_group_category_nonexistent_group_returns_404(client):
    """Creating a category with a fake group_id returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_category(client, headers, group_id=NONEXISTENT_ID)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Group not found"


# --- Group categories: GET /categories ---


async def test_list_categories_with_group_filter_as_admin(client):
    """Admin passing group_id returns personal + that group's categories."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_category(client, admin_headers, name="Personal Cat", kind="expense")
    await _create_category(client, admin_headers, name="Shared Cat", kind="expense", group_id=group_id)

    resp = await client.get(f"/categories?group_id={group_id}", headers=admin_headers)

    assert resp.status_code == 200
    names = {c["name"] for c in resp.json()}
    assert "Personal Cat" in names
    assert "Shared Cat" in names


async def test_list_categories_with_group_filter_as_member(client):
    """Non-admin member passing group_id also sees group categories."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    await _create_category(client, admin_headers, name="Shared Cat", kind="expense", group_id=group_id)

    resp = await client.get(f"/categories?group_id={group_id}", headers=member_headers)

    assert resp.status_code == 200
    names = {c["name"] for c in resp.json()}
    assert "Shared Cat" in names


async def test_list_categories_without_group_filter_excludes_group(client):
    """Without group_id filter, only personal categories are returned."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_category(client, admin_headers, name="Personal Cat", kind="expense")
    await _create_category(client, admin_headers, name="Shared Cat", kind="expense", group_id=group_id)

    resp = await client.get("/categories", headers=admin_headers)

    assert resp.status_code == 200
    names = {c["name"] for c in resp.json()}
    assert "Personal Cat" in names
    assert "Shared Cat" not in names


async def test_list_categories_group_filter_non_member_returns_404(client):
    """Non-member passing group_id filter returns 404."""
    _, _, _, group_id = await _setup_group_with_member(client)

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.get(f"/categories?group_id={group_id}", headers=outsider_headers)

    assert resp.status_code == 404


async def test_get_group_category_as_member(client):
    """Non-admin member can view a group category."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_category(client, admin_headers, name="Shared", group_id=group_id)
    category_id = create_resp.json()["id"]

    resp = await client.get(f"/categories/{category_id}", headers=member_headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "Shared"
    assert resp.json()["group_id"] == group_id


async def test_get_group_category_non_member_returns_404(client):
    """Non-member cannot view a group category."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_category(client, admin_headers, name="Shared", group_id=group_id)
    category_id = create_resp.json()["id"]

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.get(f"/categories/{category_id}", headers=outsider_headers)

    assert resp.status_code == 404


async def test_list_categories_with_group_filter_excludes_other_groups(client):
    """Category created in Group A must not appear when listing with Group B's filter."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_a = await _create_group(client, headers)
    group_b = await _create_group(client, headers)

    await _create_category(client, headers, name="Personal Cat", kind="expense")
    await _create_category(client, headers, name="Group A Cat", kind="expense", group_id=group_a)
    await _create_category(client, headers, name="Group B Cat", kind="expense", group_id=group_b)

    resp = await client.get(f"/categories?group_id={group_b}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    names = {c["name"] for c in data}
    assert "Personal Cat" in names
    assert "Group B Cat" in names
    assert "Group A Cat" not in names


# --- Group categories: PATCH /categories ---


async def test_patch_group_category_as_admin(client):
    """Admin can update a group category."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_category(client, admin_headers, name="Old Name", group_id=group_id)
    category_id = create_resp.json()["id"]

    resp = await client.patch(f"/categories/{category_id}", json={"name": "New Name"}, headers=admin_headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"


async def test_patch_group_category_as_non_admin_returns_403(client):
    """Non-admin member cannot update a group category."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_category(client, admin_headers, name="Shared", group_id=group_id)
    category_id = create_resp.json()["id"]

    resp = await client.patch(f"/categories/{category_id}", json={"name": "Hacked"}, headers=member_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"


async def test_patch_group_category_non_member_returns_404(client):
    """Non-member cannot see or update a group category."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_category(client, admin_headers, name="Shared", group_id=group_id)
    category_id = create_resp.json()["id"]

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.patch(f"/categories/{category_id}", json={"name": "Hacked"}, headers=outsider_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Category not found"


async def test_patch_group_category_rename_to_duplicate_returns_409(client):
    """Renaming a group category to an existing group category name returns 409."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_category(client, admin_headers, name="Food", kind="expense", group_id=group_id)
    create_resp = await _create_category(client, admin_headers, name="Test Transport", kind="expense", group_id=group_id)
    category_id = create_resp.json()["id"]

    resp = await client.patch(f"/categories/{category_id}", json={"name": "Food"}, headers=admin_headers)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]

    # Verify the category was not mutated
    get_resp = await client.get(f"/categories/{category_id}", headers=admin_headers)
    assert get_resp.json()["name"] == "Test Transport"


# --- Group categories: DELETE /categories ---


async def test_delete_group_category_as_admin(client):
    """Admin can delete a group category."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_category(client, admin_headers, name="ToDelete", group_id=group_id)
    category_id = create_resp.json()["id"]

    resp = await client.delete(f"/categories/{category_id}", headers=admin_headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/categories/{category_id}", headers=admin_headers)
    assert get_resp.status_code == 404


async def test_delete_group_category_as_non_admin_returns_403(client):
    """Non-admin member cannot delete a group category."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_category(client, admin_headers, name="Shared", group_id=group_id)
    category_id = create_resp.json()["id"]

    resp = await client.delete(f"/categories/{category_id}", headers=member_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"


async def test_delete_group_category_non_member_returns_404(client):
    """Non-member cannot see or delete a group category."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_category(client, admin_headers, name="Shared", group_id=group_id)
    category_id = create_resp.json()["id"]

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.delete(f"/categories/{category_id}", headers=outsider_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Category not found"


async def test_delete_category_referenced_by_transaction_returns_409(client):
    """Deleting a category that has transactions referencing it returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    # Set up a category, account, and a transaction referencing the category
    cat_resp = await _create_category(client, headers, name="Test Deletable")
    category_id = cat_resp.json()["id"]

    acct_resp = await client.post("/accounts", json={
        "account_kind": "asset", "account_type": "checking", "name": "Chequing", "currency": "CAD",
    }, headers=headers)
    account_id = acct_resp.json()["id"]

    await client.post("/transactions", json={
        "account_id": account_id,
        "category_id": category_id,
        "dt": "2026-03-15",
        "amount": -5000,
        "currency": "CAD",
    }, headers=headers)

    resp = await client.delete(f"/categories/{category_id}", headers=headers)

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Category is referenced by existing transactions"
