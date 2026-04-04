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


async def test_create_household_budget_as_editor(client):
    """Editor can create a budget for a household."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    household_id = await _create_household(client, headers)
    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id, "role": "editor"},
        headers=headers,
    )

    resp = await _create_budget(client, other_headers, household_id=household_id)

    assert resp.status_code == 201
    data = resp.json()
    assert data["household_id"] == household_id
    assert data["owner_id"] is None


async def test_create_household_budget_viewer_returns_403(client):
    """Viewer cannot create a budget for a household."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    household_id = await _create_household(client, headers)
    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": other_user_id, "role": "viewer"},
        headers=headers,
    )

    resp = await _create_budget(client, other_headers, household_id=household_id)

    assert resp.status_code == 403
