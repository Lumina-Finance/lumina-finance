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


async def _create_category(client, headers, **overrides):
    """Create a category via POST /categories.

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        **overrides: Fields to override in the default payload.

    Returns:
        The created category's ID.
    """
    payload = {"name": "Groceries", "kind": "expense", **overrides}
    resp = await client.post("/categories", json=payload, headers=headers)
    return resp.json()["id"]


async def _create_household(client, headers, **overrides):
    """Create a household via POST /households.

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        **overrides: Fields to override in the default payload.

    Returns:
        The created household's ID.
    """
    payload = {"name": "Smith Family", **overrides}
    resp = await client.post("/households", json=payload, headers=headers)
    return resp.json()["id"]


async def _create_budget(client, headers, **overrides):
    """Create a budget via POST /budgets.

    Defaults: name="March Budget", period 2026-03-01 to 2026-03-31, currency CAD.

    Args:
        client: The async test client.
        headers: Auth headers for the requesting user.
        **overrides: Fields to override in the default payload.

    Returns:
        The HTTP response from the API.
    """
    payload = {
        "name": "March Budget",
        "period_start": "2026-03-01",
        "period_end": "2026-03-31",
        "currency": "CAD",
        **overrides,
    }
    return await client.post("/budgets", json=payload, headers=headers)


# --- POST /budgets ---


async def test_create_budget_returns_201(client):
    """Valid payload creates a personal budget with correct fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    resp = await _create_budget(client, headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "March Budget"
    assert data["owner_id"] == user_id
    assert data["household_id"] is None
    assert data["period_start"] == "2026-03-01"
    assert data["period_end"] == "2026-03-31"
    assert data["currency"] == "CAD"
    assert data["overall_limit"] is None
    assert data["recurrence_freq"] is None
    assert data["recurrence_interval"] is None
    assert data["base_budget_id"] is None
    assert data["category_ids"] == []
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_create_budget_with_categories(client):
    """Budget created with tracked categories returns those category IDs."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id_1 = await _create_category(client, headers, name="Groceries")
    cat_id_2 = await _create_category(client, headers, name="Takeout")

    resp = await _create_budget(client, headers, category_ids=[cat_id_1, cat_id_2])

    assert resp.status_code == 201
    assert set(resp.json()["category_ids"]) == {cat_id_1, cat_id_2}


async def test_create_budget_with_recurrence(client):
    """Budget with recurrence fields stores them correctly."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_budget(
        client, headers,
        recurrence_freq="monthly",
        recurrence_interval=1,
        overall_limit=50000,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["recurrence_freq"] == "monthly"
    assert data["recurrence_interval"] == 1
    assert data["overall_limit"] == 50000


async def test_create_budget_invalid_period_returns_422(client):
    """Period start >= period end is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_budget(client, headers, period_start="2026-03-31", period_end="2026-03-01")

    assert resp.status_code == 422


async def test_create_budget_same_start_end_returns_422(client):
    """Period start == period end is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_budget(client, headers, period_start="2026-03-01", period_end="2026-03-01")

    assert resp.status_code == 422


async def test_create_budget_wrong_currency_returns_422(client):
    """Currency that doesn't match user's base_currency is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_budget(client, headers, currency="USD")

    assert resp.status_code == 422


async def test_create_budget_invalid_category_returns_422(client):
    """Non-existent category ID is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_budget(client, headers, category_ids=[NONEXISTENT_ID])

    assert resp.status_code == 422


async def test_create_budget_other_users_category_returns_422(client):
    """Category belonging to another user is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    other_cat_id = await _create_category(client, other_headers, name="Other Cat")

    resp = await _create_budget(client, headers, category_ids=[other_cat_id])

    assert resp.status_code == 422


async def test_create_budget_invalid_base_budget_returns_422(client):
    """Non-existent base_budget_id is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_budget(client, headers, base_budget_id=NONEXISTENT_ID)

    assert resp.status_code == 422


async def test_create_budget_empty_name_returns_422(client):
    """Empty name is rejected by schema validation."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_budget(client, headers, name="")

    assert resp.status_code == 422


async def test_create_budget_unauthenticated_returns_401(client):
    """Creating a budget without auth returns 401."""
    resp = await client.post("/budgets", json={
        "name": "Budget",
        "period_start": "2026-03-01",
        "period_end": "2026-03-31",
        "currency": "CAD",
    })

    assert resp.status_code == 401


async def test_create_household_budget_as_admin(client):
    """Admin can create a budget for a household."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    household_id = await _create_household(client, headers)

    resp = await _create_budget(client, headers, household_id=household_id)

    assert resp.status_code == 201
    data = resp.json()
    assert data["household_id"] == household_id
    assert data["owner_id"] is None


async def test_create_household_budget_as_non_admin_returns_403(client):
    """Non-admin member cannot create a budget for a household."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    household_id = await _create_household(client, headers)
    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )

    resp = await _create_budget(client, other_headers, household_id=household_id)

    assert resp.status_code == 403



async def test_create_household_budget_non_member_returns_404(client):
    """Non-member of the household cannot create a budget for it."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    household_id = await _create_household(client, headers)

    resp = await _create_budget(client, other_headers, household_id=household_id)

    assert resp.status_code == 404


async def test_create_household_budget_with_categories(client):
    """Admin can create a household budget with household categories."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    household_id = await _create_household(client, headers)
    cat_id = await _create_category(client, headers, name="Groceries", household_id=household_id)

    resp = await _create_budget(client, headers, household_id=household_id, category_ids=[cat_id])

    assert resp.status_code == 201
    assert resp.json()["category_ids"] == [cat_id]


async def test_create_budget_with_valid_base_budget_id(client):
    """Personal budget with a valid base_budget_id stores it correctly."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_budget(client, headers, name="Base Budget")
    base_id = base_resp.json()["id"]

    resp = await _create_budget(
        client, headers,
        name="April Budget",
        period_start="2026-04-01",
        period_end="2026-04-30",
        base_budget_id=base_id,
    )

    assert resp.status_code == 201
    assert resp.json()["base_budget_id"] == base_id


async def test_create_household_budget_with_base_budget_id(client):
    """Household budget can reference another household budget as base."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    household_id = await _create_household(client, headers)
    base_resp = await _create_budget(client, headers, name="Base Budget", household_id=household_id)
    base_id = base_resp.json()["id"]

    resp = await _create_budget(
        client, headers,
        name="April Budget",
        period_start="2026-04-01",
        period_end="2026-04-30",
        household_id=household_id,
        base_budget_id=base_id,
    )

    assert resp.status_code == 201
    assert resp.json()["base_budget_id"] == base_id


# --- GET /budgets/{budget_id} ---


async def test_get_budget_returns_200(client):
    """Owner can retrieve their personal budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id = await _create_category(client, headers)
    create_resp = await _create_budget(client, headers, category_ids=[cat_id])
    budget_id = create_resp.json()["id"]

    resp = await client.get(f"/budgets/{budget_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == budget_id
    assert data["name"] == "March Budget"
    assert data["category_ids"] == [cat_id]


async def test_get_budget_nonexistent_returns_404(client):
    """Non-existent budget ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/budgets/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404


async def test_get_budget_other_users_budget_returns_404(client):
    """User cannot retrieve another user's personal budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    create_resp = await _create_budget(client, headers)
    budget_id = create_resp.json()["id"]

    resp = await client.get(f"/budgets/{budget_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_get_household_budget_as_admin(client):
    """Admin can retrieve a household budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    household_id = await _create_household(client, headers)
    create_resp = await _create_budget(client, headers, household_id=household_id)
    budget_id = create_resp.json()["id"]

    resp = await client.get(f"/budgets/{budget_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["id"] == budget_id


async def test_get_household_budget_as_non_admin_without_permission_returns_404(client):
    """Non-admin member without explicit permission cannot retrieve a household budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    household_id = await _create_household(client, headers)
    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )

    create_resp = await _create_budget(client, headers, household_id=household_id)
    budget_id = create_resp.json()["id"]

    resp = await client.get(f"/budgets/{budget_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_get_household_budget_with_read_permission(client):
    """Non-admin member with READ permission can retrieve a household budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    household_id = await _create_household(client, headers)
    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )

    create_resp = await _create_budget(client, headers, household_id=household_id)
    budget_id = create_resp.json()["id"]

    # Grant READ permission
    await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": other_user_id, "level": "read"},
        headers=headers,
    )

    resp = await client.get(f"/budgets/{budget_id}", headers=other_headers)

    assert resp.status_code == 200
    assert resp.json()["id"] == budget_id


async def test_get_budget_unauthenticated_returns_401(client):
    """Getting a budget without auth returns 401."""
    resp = await client.get(f"/budgets/{NONEXISTENT_ID}")

    assert resp.status_code == 401


# --- DELETE /budgets/{budget_id} ---


async def test_delete_budget_returns_204(client):
    """Owner can delete their personal budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_budget(client, headers)
    budget_id = create_resp.json()["id"]

    resp = await client.delete(f"/budgets/{budget_id}", headers=headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/budgets/{budget_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_budget_with_categories_returns_204(client):
    """Deleting a budget with tracked categories succeeds (DB cascade)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id = await _create_category(client, headers)
    create_resp = await _create_budget(client, headers, category_ids=[cat_id])
    budget_id = create_resp.json()["id"]

    resp = await client.delete(f"/budgets/{budget_id}", headers=headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/budgets/{budget_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_budget_nonexistent_returns_404(client):
    """Non-existent budget ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.delete(f"/budgets/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404


async def test_delete_budget_other_users_budget_returns_404(client):
    """User cannot delete another user's personal budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    create_resp = await _create_budget(client, headers)
    budget_id = create_resp.json()["id"]

    resp = await client.delete(f"/budgets/{budget_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_delete_household_budget_as_admin(client):
    """Admin can delete a household budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    household_id = await _create_household(client, headers)
    create_resp = await _create_budget(client, headers, household_id=household_id)
    budget_id = create_resp.json()["id"]

    resp = await client.delete(f"/budgets/{budget_id}", headers=headers)

    assert resp.status_code == 204


async def test_delete_household_budget_as_non_admin_without_permission_returns_404(client):
    """Non-admin member without permission cannot see or delete a household budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    household_id = await _create_household(client, headers)
    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )

    create_resp = await _create_budget(client, headers, household_id=household_id)
    budget_id = create_resp.json()["id"]

    resp = await client.delete(f"/budgets/{budget_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_delete_household_budget_with_write_permission_returns_403(client):
    """Non-admin with WRITE permission cannot delete (requires ADMIN)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    household_id = await _create_household(client, headers)
    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )

    create_resp = await _create_budget(client, headers, household_id=household_id)
    budget_id = create_resp.json()["id"]

    # Grant WRITE — still insufficient for delete
    await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": other_user_id, "level": "write"},
        headers=headers,
    )

    resp = await client.delete(f"/budgets/{budget_id}", headers=other_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_delete_budget_unauthenticated_returns_401(client):
    """Deleting a budget without auth returns 401."""
    resp = await client.delete(f"/budgets/{NONEXISTENT_ID}")

    assert resp.status_code == 401

# --- POST /budgets/{budget_id}/members ---


async def _setup_household_with_budget(client):
    """Create a user, household, and household budget. Return (headers, user_id, household_id, budget_id).

    Args:
        client: The async test client.

    Returns:
        Tuple of (auth_headers, user_id, household_id, budget_id).
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    household_id = await _create_household(client, headers)
    create_resp = await _create_budget(client, headers, household_id=household_id)
    budget_id = create_resp.json()["id"]

    return headers, user_id, household_id, budget_id


async def test_add_budget_member_returns_201(client):
    """Admin can add a household member to a budget."""
    headers, _, household_id, budget_id = await _setup_household_with_budget(client)
    _, other_user_id = await _create_second_user(client)

    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )

    resp = await client.post(
        f"/budgets/{budget_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["budget_id"] == budget_id
    assert data["user_id"] == other_user_id


async def test_add_budget_member_as_non_admin_returns_403(client):
    """Non-admin member cannot add a member to a budget."""
    headers, _, household_id, budget_id = await _setup_household_with_budget(client)
    other_headers, other_user_id = await _create_second_user(client)

    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )

    resp = await client.post(
        f"/budgets/{budget_id}/members",
        json={"user_id": other_user_id},
        headers=other_headers,
    )

    assert resp.status_code == 403


async def test_add_budget_member_personal_budget_returns_422(client):
    """Cannot add a member to a personal budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    _, other_user_id = await _create_second_user(client)

    create_resp = await _create_budget(client, headers)
    budget_id = create_resp.json()["id"]

    resp = await client.post(
        f"/budgets/{budget_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_add_budget_member_non_household_member_returns_422(client):
    """Cannot add a user who is not a household member."""
    headers, _, _, budget_id = await _setup_household_with_budget(client)
    _, other_user_id = await _create_second_user(client)

    resp = await client.post(
        f"/budgets/{budget_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_add_budget_member_duplicate_returns_409(client):
    """Adding the same member twice returns 409."""
    headers, _, household_id, budget_id = await _setup_household_with_budget(client)
    _, other_user_id = await _create_second_user(client)

    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )

    await client.post(
        f"/budgets/{budget_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )

    resp = await client.post(
        f"/budgets/{budget_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )

    assert resp.status_code == 409


async def test_add_budget_member_nonexistent_budget_returns_404(client):
    """Non-existent budget ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post(
        f"/budgets/{NONEXISTENT_ID}/members",
        json={"user_id": NONEXISTENT_ID},
        headers=headers,
    )

    assert resp.status_code == 404


async def test_add_budget_member_unauthenticated_returns_401(client):
    """Adding a budget member without auth returns 401."""
    resp = await client.post(
        f"/budgets/{NONEXISTENT_ID}/members",
        json={"user_id": NONEXISTENT_ID},
    )

    assert resp.status_code == 401


# --- DELETE /budgets/{budget_id}/members/{member_user_id} ---


async def test_remove_budget_member_returns_204(client):
    """Admin can remove a member from a budget."""
    headers, _, household_id, budget_id = await _setup_household_with_budget(client)
    _, other_user_id = await _create_second_user(client)

    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )
    await client.post(
        f"/budgets/{budget_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )

    resp = await client.delete(
        f"/budgets/{budget_id}/members/{other_user_id}",
        headers=headers,
    )

    assert resp.status_code == 204

    # Re-adding should succeed, confirming the member was actually removed
    re_add_resp = await client.post(
        f"/budgets/{budget_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )
    assert re_add_resp.status_code == 201


async def test_remove_budget_member_as_non_admin_returns_403(client):
    """Non-admin member cannot remove a member from a budget."""
    headers, user_id, household_id, budget_id = await _setup_household_with_budget(client)
    other_headers, other_user_id = await _create_second_user(client)

    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )
    # Admin adds themselves to budget scope
    await client.post(
        f"/budgets/{budget_id}/members",
        json={"user_id": user_id},
        headers=headers,
    )

    resp = await client.delete(
        f"/budgets/{budget_id}/members/{user_id}",
        headers=other_headers,
    )

    assert resp.status_code == 403


async def test_remove_budget_member_not_found_returns_404(client):
    """Removing a user not scoped to the budget returns 404."""
    headers, _, household_id, budget_id = await _setup_household_with_budget(client)
    _, other_user_id = await _create_second_user(client)

    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )

    resp = await client.delete(
        f"/budgets/{budget_id}/members/{other_user_id}",
        headers=headers,
    )

    assert resp.status_code == 404


async def test_remove_budget_member_personal_budget_returns_422(client):
    """Cannot remove a member from a personal budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    _, other_user_id = await _create_second_user(client)

    create_resp = await _create_budget(client, headers)
    budget_id = create_resp.json()["id"]

    resp = await client.delete(
        f"/budgets/{budget_id}/members/{other_user_id}",
        headers=headers,
    )

    assert resp.status_code == 422


async def test_remove_budget_member_nonexistent_budget_returns_404(client):
    """Non-existent budget ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.delete(
        f"/budgets/{NONEXISTENT_ID}/members/{NONEXISTENT_ID}",
        headers=headers,
    )

    assert resp.status_code == 404


async def test_remove_budget_member_unauthenticated_returns_401(client):
    """Removing a budget member without auth returns 401."""
    resp = await client.delete(
        f"/budgets/{NONEXISTENT_ID}/members/{NONEXISTENT_ID}",
    )

    assert resp.status_code == 401


# --- PATCH /budgets/{budget_id} ---


async def test_update_budget_name_returns_200(client):
    """Owner can update budget name."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_budget(client, headers)
    budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{budget_id}",
        json={"name": "April Budget"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["name"] == "April Budget"


async def test_update_budget_limit_returns_200(client):
    """Owner can update budget overall_limit."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_budget(client, headers, overall_limit=50000)
    budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{budget_id}",
        json={"overall_limit": 75000},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["overall_limit"] == 75000


async def test_update_budget_period_returns_200(client):
    """Owner can update budget period dates."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_budget(client, headers)
    budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{budget_id}",
        json={"period_start": "2026-04-01", "period_end": "2026-04-30"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["period_start"] == "2026-04-01"
    assert resp.json()["period_end"] == "2026-04-30"


async def test_update_budget_start_only_returns_200(client):
    """Updating only period_start is valid if it stays before existing period_end."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_budget(client, headers)
    budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{budget_id}",
        json={"period_start": "2026-03-15"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["period_start"] == "2026-03-15"


async def test_update_budget_end_only_returns_200(client):
    """Updating only period_end is valid if it stays after existing period_start."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_budget(client, headers)
    budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{budget_id}",
        json={"period_end": "2026-04-15"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["period_end"] == "2026-04-15"


async def test_update_budget_start_after_end_returns_422(client):
    """Updating period_start to >= period_end is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_budget(client, headers)
    budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{budget_id}",
        json={"period_start": "2026-04-01"},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_update_budget_add_categories(client):
    """Adding tracked categories via PATCH returns updated category_ids."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id = await _create_category(client, headers)
    create_resp = await _create_budget(client, headers)
    budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{budget_id}",
        json={"category_ids": [cat_id]},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["category_ids"] == [cat_id]


async def test_update_budget_remove_categories(client):
    """Sending empty category_ids soft-deletes all tracked categories."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id = await _create_category(client, headers)
    create_resp = await _create_budget(client, headers, category_ids=[cat_id])
    budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{budget_id}",
        json={"category_ids": []},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["category_ids"] == []


async def test_update_budget_swap_categories(client):
    """Replacing one tracked category with another works correctly."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id_1 = await _create_category(client, headers, name="Groceries")
    cat_id_2 = await _create_category(client, headers, name="Takeout")
    create_resp = await _create_budget(client, headers, category_ids=[cat_id_1])
    budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{budget_id}",
        json={"category_ids": [cat_id_2]},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["category_ids"] == [cat_id_2]


async def test_update_budget_invalid_category_returns_422(client):
    """Non-existent category ID in PATCH is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_budget(client, headers)
    budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{budget_id}",
        json={"category_ids": [NONEXISTENT_ID]},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_update_budget_empty_body_returns_200(client):
    """Empty PATCH body returns current budget unchanged."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_budget(client, headers)
    budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{budget_id}",
        json={},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["name"] == "March Budget"


async def test_update_budget_nonexistent_returns_404(client):
    """Non-existent budget ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(
        f"/budgets/{NONEXISTENT_ID}",
        json={"name": "New Name"},
        headers=headers,
    )

    assert resp.status_code == 404


async def test_update_budget_other_users_budget_returns_404(client):
    """User cannot update another user's personal budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    create_resp = await _create_budget(client, headers)
    budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{budget_id}",
        json={"name": "Hacked"},
        headers=other_headers,
    )

    assert resp.status_code == 404


async def test_update_household_budget_as_admin(client):
    """Admin can update a household budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    household_id = await _create_household(client, headers)
    create_resp = await _create_budget(client, headers, household_id=household_id)
    budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{budget_id}",
        json={"name": "Updated"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated"


async def test_update_household_budget_as_non_admin_without_permission_returns_404(client):
    """Non-admin member without permission cannot see or update a household budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    household_id = await _create_household(client, headers)
    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )

    create_resp = await _create_budget(client, headers, household_id=household_id)
    budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{budget_id}",
        json={"name": "Hacked"},
        headers=other_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_update_household_budget_with_write_permission_returns_403(client):
    """Non-admin with WRITE permission cannot update (requires ADMIN)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    household_id = await _create_household(client, headers)
    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )

    create_resp = await _create_budget(client, headers, household_id=household_id)
    budget_id = create_resp.json()["id"]

    # Grant WRITE — still insufficient for update
    await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": other_user_id, "level": "write"},
        headers=headers,
    )

    resp = await client.patch(
        f"/budgets/{budget_id}",
        json={"name": "Hacked"},
        headers=other_headers,
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_update_budget_unauthenticated_returns_401(client):
    """Updating a budget without auth returns 401."""
    resp = await client.patch(
        f"/budgets/{NONEXISTENT_ID}",
        json={"name": "Hacked"},
    )

    assert resp.status_code == 401


# --- GET /budgets ---


async def test_list_budgets_returns_200(client):
    """User with budgets gets them in a list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_budget(client, headers, name="March Budget")
    await _create_budget(client, headers, name="April Budget", period_start="2026-04-01", period_end="2026-04-30")

    resp = await client.get("/budgets", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    # Ordered by period_end desc, then name
    assert data[0]["name"] == "April Budget"
    assert data[1]["name"] == "March Budget"


async def test_list_budgets_empty(client):
    """User with no budgets gets an empty list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/budgets", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_budgets_includes_category_ids(client):
    """Listed budgets include their tracked category IDs."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id = await _create_category(client, headers)
    await _create_budget(client, headers, category_ids=[cat_id])

    resp = await client.get("/budgets", headers=headers)

    assert resp.status_code == 200
    assert resp.json()[0]["category_ids"] == [cat_id]


async def test_list_budgets_includes_household_budgets(client):
    """User sees both personal and household budgets."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    household_id = await _create_household(client, headers)
    await _create_budget(client, headers, name="Personal Budget")
    await _create_budget(client, headers, name="Family Budget", household_id=household_id)

    resp = await client.get("/budgets", headers=headers)

    assert resp.status_code == 200
    names = {b["name"] for b in resp.json()}
    assert names == {"Personal Budget", "Family Budget"}


async def test_list_budgets_household_member_without_permission_excluded(client):
    """Non-admin household member without permission does not see household budgets."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    household_id = await _create_household(client, headers)
    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )
    await _create_budget(client, headers, name="Family Budget", household_id=household_id)

    resp = await client.get("/budgets", headers=other_headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_budgets_household_member_with_permission(client):
    """Non-admin household member with READ permission sees household budgets."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    household_id = await _create_household(client, headers)
    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )
    create_resp = await _create_budget(client, headers, name="Family Budget", household_id=household_id)
    budget_id = create_resp.json()["id"]

    # Grant READ permission
    await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": other_user_id, "level": "read"},
        headers=headers,
    )

    resp = await client.get("/budgets", headers=other_headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["name"] == "Family Budget"


async def test_list_budgets_excludes_other_users_budgets(client):
    """User does not see another user's personal budgets."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    await _create_budget(client, headers, name="My Budget")

    resp = await client.get("/budgets", headers=other_headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_budgets_secondary_sort_by_name(client):
    """Budgets with same period_end are sorted alphabetically by name."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    await _create_budget(client, headers, name="Zebra Budget")
    await _create_budget(client, headers, name="Alpha Budget")

    resp = await client.get("/budgets", headers=headers)

    assert resp.status_code == 200
    names = [b["name"] for b in resp.json()]
    assert names == ["Alpha Budget", "Zebra Budget"]


async def test_list_budgets_no_duplicates_for_household_budget(client):
    """Household budget appears exactly once even when user is owner and member."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    household_id = await _create_household(client, headers)
    await _create_budget(client, headers, name="Family Budget", household_id=household_id)

    resp = await client.get("/budgets", headers=headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["name"] == "Family Budget"


async def test_list_budgets_unauthenticated_returns_401(client):
    """Listing budgets without auth returns 401."""
    resp = await client.get("/budgets")

    assert resp.status_code == 401
