from tests.routes.conftest import _create_user, _get_auth_header

# --- Helpers ---

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"

CATEGORY_PAYLOAD = {
    "name": "Groceries",
    "kind": "expense",
}


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


# --- GET /categories ---


async def test_list_categories_returns_empty_list(client):
    """User with no categories gets an empty list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/categories", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_categories_returns_user_categories(client):
    """User sees their own categories and not another user's."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_category(client, headers, name="Groceries")
    await _create_category(client, headers, name="Salary", kind="income")

    # Second user creates a category that should not appear
    other_headers = _get_auth_header(await _create_second_user(client))
    await _create_category(client, other_headers, name="Other Expense")

    resp = await client.get("/categories", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    names = {c["name"] for c in data}
    assert names == {"Groceries", "Salary"}



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
    assert data["name"] == "Groceries"
    assert data["kind"] == "expense"
    assert data["parent_id"] is None
    assert data["household_id"] is None


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
    assert data["name"] == "Groceries"
    assert data["kind"] == "expense"
    assert data["parent_id"] is None
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_create_category_with_parent(client):
    """Category can be created with a valid parent_id."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    parent_resp = await _create_category(client, headers, name="Food")
    parent_id = parent_resp.json()["id"]

    child_resp = await _create_category(client, headers, name="Fast Food", parent_id=parent_id)

    assert child_resp.status_code == 201
    assert child_resp.json()["parent_id"] == parent_id


async def test_create_category_invalid_parent_returns_422(client):
    """Non-existent parent_id returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_category(client, headers, parent_id=NONEXISTENT_ID)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Parent category not found"


async def test_create_category_duplicate_name_and_kind_returns_409(client):
    """Same name + kind for the same user returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_category(client, headers, name="Groceries", kind="expense")
    resp = await _create_category(client, headers, name="Groceries", kind="expense")

    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


async def test_create_category_same_name_different_kind_allowed(client):
    """Same name with a different kind is allowed."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp1 = await _create_category(client, headers, name="Misc", kind="expense")
    resp2 = await _create_category(client, headers, name="Misc", kind="income")

    assert resp1.status_code == 201
    assert resp2.status_code == 201
    assert resp1.json()["id"] != resp2.json()["id"]


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


async def test_patch_category_updates_parent(client):
    """PATCH can set a parent_id on an existing category."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    parent_resp = await _create_category(client, headers, name="Food")
    parent_id = parent_resp.json()["id"]

    child_resp = await _create_category(client, headers, name="Fast Food")
    child_id = child_resp.json()["id"]

    resp = await client.patch(f"/categories/{child_id}", json={"parent_id": parent_id}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["parent_id"] == parent_id


async def test_patch_category_invalid_parent_returns_422(client):
    """PATCH with non-existent parent_id returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_category(client, headers)
    category_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/categories/{category_id}",
        json={"parent_id": NONEXISTENT_ID},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Parent category not found"


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
