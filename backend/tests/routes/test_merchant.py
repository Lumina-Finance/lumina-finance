from tests.routes.conftest import _create_user, _get_auth_header

# --- Helpers ---

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"

MERCHANT_PAYLOAD = {
    "name": "Costco",
}


async def _create_merchant(client, headers, **overrides):
    """Create a merchant via POST /merchants.

    Defaults: name="Costco".

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        **overrides: Fields to override in the default payload.

    Returns:
        The HTTP response from the API.
    """
    payload = {**MERCHANT_PAYLOAD, **overrides}
    return await client.post("/merchants", json=payload, headers=headers)


async def _create_category(client, headers, **overrides):
    """Create a category via POST /categories.

    Defaults: name="Groceries", kind="expense".

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        **overrides: Fields to override in the default payload.

    Returns:
        The HTTP response from the API.
    """
    payload = {"name": "Groceries", "kind": "expense", **overrides}
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


# --- GET /merchants ---


async def test_list_merchants_returns_empty_list(client):
    """User with no merchants gets an empty list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/merchants", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_merchants_returns_user_merchants(client):
    """User sees their own merchants and not another user's."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_merchant(client, headers, name="Costco")
    await _create_merchant(client, headers, name="Walmart")

    other_headers = _get_auth_header(await _create_second_user(client))
    await _create_merchant(client, other_headers, name="Other Store")

    resp = await client.get("/merchants", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    names = {m["name"] for m in data}
    assert names == {"Costco", "Walmart"}


async def test_list_merchants_without_auth_returns_401(client):
    """GET /merchants without an Authorization header returns 401."""
    resp = await client.get("/merchants")
    assert resp.status_code == 401


# --- GET /merchants/{merchant_id} ---


async def test_get_merchant_returns_merchant(client):
    """Valid merchant ID returns the merchant with all fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_merchant(client, headers)
    merchant_id = create_resp.json()["id"]

    resp = await client.get(f"/merchants/{merchant_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Costco"
    assert data["default_category_id"] is None


async def test_get_merchant_not_found_returns_404(client):
    """Non-existent merchant ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/merchants/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Merchant not found"


async def test_get_merchant_other_user_returns_404(client):
    """Accessing another user's merchant returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_merchant(client, headers)
    merchant_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.get(f"/merchants/{merchant_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_get_merchant_without_auth_returns_401(client):
    """GET /merchants/{id} without an Authorization header returns 401."""
    resp = await client.get(f"/merchants/{NONEXISTENT_ID}")
    assert resp.status_code == 401


# --- POST /merchants ---


async def test_create_merchant_returns_201(client):
    """Valid payload creates a merchant with correct fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_merchant(client, headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Costco"
    assert data["default_category_id"] is None
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_create_merchant_with_default_category(client):
    """Merchant can be created with a valid default_category_id."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    resp = await _create_merchant(client, headers, default_category_id=category_id)

    assert resp.status_code == 201
    assert resp.json()["default_category_id"] == category_id


async def test_create_personal_merchant_duplicate_returns_409(client):
    """Creating two personal merchants with the same name returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_merchant(client, headers, name="Costco")
    resp = await _create_merchant(client, headers, name="Costco")

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_create_merchant_invalid_category_returns_422(client):
    """Non-existent default_category_id returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_merchant(client, headers, default_category_id=NONEXISTENT_ID)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Category not found"


async def test_create_merchant_other_users_category_returns_422(client):
    """Using another user's category as default_category_id returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await _create_merchant(client, other_headers, default_category_id=category_id)

    assert resp.status_code == 422


async def test_create_merchant_empty_name_returns_422(client):
    """Empty name returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_merchant(client, headers, name="")

    assert resp.status_code == 422


async def test_create_merchant_without_auth_returns_401(client):
    """POST /merchants without an Authorization header returns 401."""
    resp = await client.post("/merchants", json=MERCHANT_PAYLOAD)
    assert resp.status_code == 401


# --- PATCH /merchants/{merchant_id} ---


async def test_patch_merchant_updates_name(client):
    """PATCH updates name and returns the updated merchant."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_merchant(client, headers)
    merchant_id = create_resp.json()["id"]

    resp = await client.patch(f"/merchants/{merchant_id}", json={"name": "Renamed"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"


async def test_patch_merchant_updates_default_category(client):
    """PATCH can set a default_category_id."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    create_resp = await _create_merchant(client, headers)
    merchant_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/merchants/{merchant_id}",
        json={"default_category_id": category_id},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["default_category_id"] == category_id


async def test_patch_merchant_clears_default_category(client):
    """PATCH with default_category_id=null clears the category link."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]

    create_resp = await _create_merchant(client, headers, default_category_id=category_id)
    merchant_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/merchants/{merchant_id}",
        json={"default_category_id": None},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["default_category_id"] is None


async def test_patch_merchant_invalid_category_returns_422(client):
    """PATCH with non-existent default_category_id returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_merchant(client, headers)
    merchant_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/merchants/{merchant_id}",
        json={"default_category_id": NONEXISTENT_ID},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Category not found"


async def test_patch_merchant_empty_body_returns_unchanged(client):
    """PATCH with empty body returns 200 with no changes."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_merchant(client, headers)
    merchant_id = create_resp.json()["id"]

    before = await client.get(f"/merchants/{merchant_id}", headers=headers)
    resp = await client.patch(f"/merchants/{merchant_id}", json={}, headers=headers)

    assert resp.status_code == 200
    assert resp.json() == before.json()


async def test_patch_merchant_not_found_returns_404(client):
    """PATCH non-existent merchant returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(f"/merchants/{NONEXISTENT_ID}", json={"name": "X"}, headers=headers)

    assert resp.status_code == 404


async def test_patch_merchant_other_user_returns_404(client):
    """PATCH on another user's merchant returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_merchant(client, headers)
    merchant_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.patch(f"/merchants/{merchant_id}", json={"name": "Hacked"}, headers=other_headers)

    assert resp.status_code == 404


async def test_patch_merchant_rename_to_duplicate_returns_409(client):
    """Renaming a merchant to an existing name returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_merchant(client, headers, name="Costco")
    create_resp = await _create_merchant(client, headers, name="Walmart")
    merchant_id = create_resp.json()["id"]

    resp = await client.patch(f"/merchants/{merchant_id}", json={"name": "Costco"}, headers=headers)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]

    # Verify the merchant was not mutated
    get_resp = await client.get(f"/merchants/{merchant_id}", headers=headers)
    assert get_resp.json()["name"] == "Walmart"


async def test_patch_merchant_without_auth_returns_401(client):
    """PATCH /merchants/{id} without an Authorization header returns 401."""
    resp = await client.patch(f"/merchants/{NONEXISTENT_ID}", json={"name": "X"})
    assert resp.status_code == 401


# --- DELETE /merchants/{merchant_id} ---


async def test_delete_merchant_returns_204(client):
    """DELETE removes the merchant and returns 204."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_merchant(client, headers)
    merchant_id = create_resp.json()["id"]

    resp = await client.delete(f"/merchants/{merchant_id}", headers=headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/merchants/{merchant_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_merchant_not_found_returns_404(client):
    """DELETE non-existent merchant returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.delete(f"/merchants/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404


async def test_delete_merchant_other_user_returns_404(client):
    """Deleting another user's merchant returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_merchant(client, headers)
    merchant_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.delete(f"/merchants/{merchant_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_delete_merchant_without_auth_returns_401(client):
    """DELETE /merchants/{id} without an Authorization header returns 401."""
    resp = await client.delete(f"/merchants/{NONEXISTENT_ID}")
    assert resp.status_code == 401


# --- Group merchants: POST /merchants ---


async def test_create_group_merchant_as_member_returns_201(client):
    """Any group member can create a group merchant."""
    _, member_headers, _, group_id = await _setup_group_with_member(client)

    resp = await _create_merchant(client, member_headers, name="Costco", group_id=group_id)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Costco"
    assert data["group_id"] == group_id


async def test_create_group_merchant_as_admin_returns_201(client):
    """Admin can create a group merchant."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    resp = await _create_merchant(client, admin_headers, name="Walmart", group_id=group_id)

    assert resp.status_code == 201
    assert resp.json()["group_id"] == group_id


async def test_create_group_merchant_non_member_returns_404(client):
    """Non-member cannot create a merchant in a group."""
    _, _, _, group_id = await _setup_group_with_member(client)

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await _create_merchant(client, outsider_headers, group_id=group_id)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Group not found"


async def test_create_group_merchant_nonexistent_group_returns_404(client):
    """Creating a merchant with a fake group_id returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_merchant(client, headers, group_id=NONEXISTENT_ID)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Group not found"


async def test_create_group_merchant_duplicate_returns_409(client):
    """Duplicate name within the same group returns 409."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_merchant(client, admin_headers, name="Costco", group_id=group_id)
    resp = await _create_merchant(client, admin_headers, name="Costco", group_id=group_id)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_create_group_merchant_same_name_as_personal_allowed(client):
    """Personal and group merchants with the same name can coexist."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    personal = await _create_merchant(client, admin_headers, name="Costco")
    group = await _create_merchant(client, admin_headers, name="Costco", group_id=group_id)

    assert personal.status_code == 201
    assert group.status_code == 201
    assert personal.json()["id"] != group.json()["id"]


async def test_create_group_merchant_with_group_category(client):
    """Group merchant can use a group category as default."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    cat_resp = await _create_category(client, admin_headers, name="Groceries", group_id=group_id)
    category_id = cat_resp.json()["id"]

    resp = await _create_merchant(client, admin_headers, name="Costco", group_id=group_id, default_category_id=category_id)

    assert resp.status_code == 201
    assert resp.json()["default_category_id"] == category_id


async def test_create_group_merchant_with_personal_category(client):
    """Group merchant can use the creator's personal category as default."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    cat_resp = await _create_category(client, admin_headers, name="Groceries")
    category_id = cat_resp.json()["id"]

    resp = await _create_merchant(client, admin_headers, name="Costco", group_id=group_id, default_category_id=category_id)

    assert resp.status_code == 201
    assert resp.json()["default_category_id"] == category_id


# --- Group merchants: GET /merchants ---


async def test_list_merchants_with_group_filter_as_admin(client):
    """Admin passing group_id returns personal + that group's merchants."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_merchant(client, admin_headers, name="Personal Store")
    await _create_merchant(client, admin_headers, name="Shared Store", group_id=group_id)

    resp = await client.get(f"/merchants?group_id={group_id}", headers=admin_headers)

    assert resp.status_code == 200
    names = {m["name"] for m in resp.json()}
    assert "Personal Store" in names
    assert "Shared Store" in names


async def test_list_merchants_with_group_filter_as_member(client):
    """Non-admin member passing group_id also sees group merchants."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    await _create_merchant(client, admin_headers, name="Shared Store", group_id=group_id)

    resp = await client.get(f"/merchants?group_id={group_id}", headers=member_headers)

    assert resp.status_code == 200
    names = {m["name"] for m in resp.json()}
    assert "Shared Store" in names


async def test_list_merchants_without_group_filter_excludes_group(client):
    """Without group_id filter, only personal merchants are returned."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_merchant(client, admin_headers, name="Personal Store")
    await _create_merchant(client, admin_headers, name="Shared Store", group_id=group_id)

    resp = await client.get("/merchants", headers=admin_headers)

    assert resp.status_code == 200
    names = {m["name"] for m in resp.json()}
    assert "Personal Store" in names
    assert "Shared Store" not in names


async def test_list_merchants_group_filter_non_member_returns_404(client):
    """Non-member passing group_id filter returns 404."""
    _, _, _, group_id = await _setup_group_with_member(client)

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.get(f"/merchants?group_id={group_id}", headers=outsider_headers)

    assert resp.status_code == 404


async def test_get_group_merchant_as_member(client):
    """Non-admin member can view a group merchant."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_merchant(client, admin_headers, name="Shared", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    resp = await client.get(f"/merchants/{merchant_id}", headers=member_headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "Shared"
    assert resp.json()["group_id"] == group_id


async def test_get_group_merchant_non_member_returns_404(client):
    """Non-member cannot view a group merchant."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_merchant(client, admin_headers, name="Shared", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.get(f"/merchants/{merchant_id}", headers=outsider_headers)

    assert resp.status_code == 404


async def test_list_merchants_with_group_filter_excludes_other_groups(client):
    """Merchant created in Group A must not appear when listing with Group B's filter."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_a = await _create_group(client, headers)
    group_b = await _create_group(client, headers)

    await _create_merchant(client, headers, name="Personal Store")
    await _create_merchant(client, headers, name="Group A Store", group_id=group_a)
    await _create_merchant(client, headers, name="Group B Store", group_id=group_b)

    resp = await client.get(f"/merchants?group_id={group_b}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    names = {m["name"] for m in data}
    assert len(data) == 2
    assert "Personal Store" in names
    assert "Group B Store" in names
    assert "Group A Store" not in names


# --- Group merchants: PATCH /merchants ---


async def test_patch_group_merchant_as_admin(client):
    """Admin can update a group merchant."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_merchant(client, admin_headers, name="Old Name", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    resp = await client.patch(f"/merchants/{merchant_id}", json={"name": "New Name"}, headers=admin_headers)

    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"


async def test_patch_group_merchant_with_group_category(client):
    """Admin can update a group merchant's default category to a group category."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    cat_resp = await _create_category(client, admin_headers, name="Groceries", group_id=group_id)
    category_id = cat_resp.json()["id"]

    create_resp = await _create_merchant(client, admin_headers, name="Costco", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/merchants/{merchant_id}",
        json={"default_category_id": category_id},
        headers=admin_headers,
    )

    assert resp.status_code == 200
    assert resp.json()["default_category_id"] == category_id


async def test_patch_group_merchant_as_non_admin_returns_403(client):
    """Non-admin member cannot update a group merchant."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_merchant(client, admin_headers, name="Shared", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    resp = await client.patch(f"/merchants/{merchant_id}", json={"name": "Hacked"}, headers=member_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"


async def test_patch_group_merchant_non_member_returns_404(client):
    """Non-member cannot see or update a group merchant."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_merchant(client, admin_headers, name="Shared", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.patch(f"/merchants/{merchant_id}", json={"name": "Hacked"}, headers=outsider_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Merchant not found"


async def test_patch_group_merchant_rename_to_duplicate_returns_409(client):
    """Renaming a group merchant to an existing group merchant name returns 409."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    await _create_merchant(client, admin_headers, name="Costco", group_id=group_id)
    create_resp = await _create_merchant(client, admin_headers, name="Walmart", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    resp = await client.patch(f"/merchants/{merchant_id}", json={"name": "Costco"}, headers=admin_headers)

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]

    # Verify the merchant was not mutated
    get_resp = await client.get(f"/merchants/{merchant_id}", headers=admin_headers)
    assert get_resp.json()["name"] == "Walmart"


# --- Group merchants: DELETE /merchants ---


async def test_delete_group_merchant_as_admin(client):
    """Admin can delete a group merchant."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_merchant(client, admin_headers, name="ToDelete", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    resp = await client.delete(f"/merchants/{merchant_id}", headers=admin_headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/merchants/{merchant_id}", headers=admin_headers)
    assert get_resp.status_code == 404


async def test_delete_group_merchant_as_non_admin_returns_403(client):
    """Non-admin member cannot delete a group merchant."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_merchant(client, admin_headers, name="Shared", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    resp = await client.delete(f"/merchants/{merchant_id}", headers=member_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"


async def test_delete_group_merchant_non_member_returns_404(client):
    """Non-member cannot see or delete a group merchant."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)

    create_resp = await _create_merchant(client, admin_headers, name="Shared", group_id=group_id)
    merchant_id = create_resp.json()["id"]

    outsider_resp = await client.post("/auth/signup", json={
        "email": "outsider@example.com", "password": "securepassword123",
        "first_name": "Outsider", "tz": "America/Toronto", "base_currency": "CAD",
    })
    outsider_headers = _get_auth_header(outsider_resp)

    resp = await client.delete(f"/merchants/{merchant_id}", headers=outsider_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Merchant not found"


async def test_delete_merchant_referenced_by_transaction_returns_409(client):
    """Deleting a merchant that has transactions referencing it returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    # Set up category, merchant, account, and a transaction referencing the merchant
    cat_resp = await client.post("/categories", json={
        "name": "Groceries", "kind": "expense",
    }, headers=headers)
    category_id = cat_resp.json()["id"]

    merchant_resp = await _create_merchant(client, headers, name="Costco")
    merchant_id = merchant_resp.json()["id"]

    acct_resp = await client.post("/accounts", json={
        "account_type": "checking", "name": "Chequing", "currency": "CAD",
    }, headers=headers)
    account_id = acct_resp.json()["id"]

    await client.post("/transactions", json={
        "account_id": account_id,
        "category_id": category_id,
        "merchant_id": merchant_id,
        "ts": "2026-03-15T12:00:00Z",
        "amount": -5000,
        "currency": "CAD",
    }, headers=headers)

    resp = await client.delete(f"/merchants/{merchant_id}", headers=headers)

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Merchant is referenced by existing transactions"
