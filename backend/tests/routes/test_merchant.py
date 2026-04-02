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
