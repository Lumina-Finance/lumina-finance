from tests.routes.conftest import _create_user, _get_auth_header

# --- Helpers ---

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"


async def _create_second_user(client):
    """Sign up a second user and return (headers, user_id)."""
    resp = await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "securepassword123",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    return _get_auth_header(resp), resp.json()["user"]["id"]


async def _create_category(client, headers, **overrides):
    """Create a category via POST /categories."""
    payload = {"name": "Groceries", "kind": "expense", **overrides}
    resp = await client.post("/categories", json=payload, headers=headers)
    return resp.json()["id"]


async def _create_group(client, headers, **overrides):
    """Create a group via POST /groups."""
    payload = {"name": "Smith Family", **overrides}
    resp = await client.post("/groups", json=payload, headers=headers)
    return resp.json()["id"]


async def _create_base_budget(client, headers, *, category_ids=None, **overrides):
    """Create a base budget via POST /base-budgets.

    Defaults: name="March Budget", currency="CAD", one freshly-created tracked category.
    Pass category_ids explicitly to override.
    """
    if category_ids is None:
        category_ids = [await _create_category(client, headers, name="Default Cat")]
    payload = {
        "name": "March Budget",
        "currency": "CAD",
        "category_ids": category_ids,
        **overrides,
    }
    return await client.post("/base-budgets", json=payload, headers=headers)


async def _create_budget_instance(client, headers, base_budget_id, **overrides):
    """Create a budget instance via POST /base-budgets/{id}/budgets.

    Defaults: period 2026-03-01 to 2026-03-31, overall_limit=100000 (1000 CAD in minor units).
    """
    payload = {
        "period_start": "2026-03-01",
        "period_end": "2026-03-31",
        "overall_limit": 100000,
        **overrides,
    }
    return await client.post(
        f"/base-budgets/{base_budget_id}/budgets", json=payload, headers=headers,
    )


# --- POST /base-budgets/{base_budget_id}/budgets ---


async def test_create_budget_instance_returns_201(client):
    """Valid payload creates a per-period instance with the parent base embedded."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    cat_id = await _create_category(client, headers)
    base_resp = await _create_base_budget(client, headers, category_ids=[cat_id])
    base_budget_id = base_resp.json()["id"]

    resp = await _create_budget_instance(client, headers, base_budget_id)

    assert resp.status_code == 201
    data = resp.json()
    assert data["id"] is not None
    assert data["base_budget_id"] == base_budget_id
    assert data["period_start"] == "2026-03-01"
    assert data["period_end"] == "2026-03-31"
    assert data["overall_limit"] == 100000
    assert data["created_at"] is not None
    # Parent base embedded with currently-active categories
    base = data["base_budget"]
    assert base["id"] == base_budget_id
    assert base["name"] == "March Budget"
    assert base["owner_id"] == user_id
    assert base["category_ids"] == [cat_id]


async def test_create_budget_instance_same_day_returns_201(client):
    """Single-day instance (period_start == period_end) is accepted."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]

    resp = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-03-15", period_end="2026-03-15",
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["period_start"] == "2026-03-15"
    assert data["period_end"] == "2026-03-15"
    assert data["base_budget"]["id"] == base_budget_id


async def test_create_budget_instance_start_after_end_returns_422(client):
    """period_start after period_end is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]

    resp = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-03-31", period_end="2026-03-01",
    )

    assert resp.status_code == 422


async def test_create_budget_instance_missing_period_start_returns_422(client):
    """period_start is required."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]

    resp = await client.post(
        f"/base-budgets/{base_budget_id}/budgets",
        json={"period_end": "2026-03-31", "overall_limit": 100000},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_create_budget_instance_missing_period_end_returns_422(client):
    """period_end is required."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]

    resp = await client.post(
        f"/base-budgets/{base_budget_id}/budgets",
        json={"period_start": "2026-03-01", "overall_limit": 100000},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_create_budget_instance_missing_overall_limit_returns_422(client):
    """overall_limit is required."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]

    resp = await client.post(
        f"/base-budgets/{base_budget_id}/budgets",
        json={"period_start": "2026-03-01", "period_end": "2026-03-31"},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_create_budget_instance_zero_overall_limit_returns_422(client):
    """overall_limit must be strictly positive — zero is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]

    resp = await _create_budget_instance(client, headers, base_budget_id, overall_limit=0)

    assert resp.status_code == 422


async def test_create_budget_instance_negative_overall_limit_returns_422(client):
    """overall_limit must be strictly positive — negative values are rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]

    resp = await _create_budget_instance(client, headers, base_budget_id, overall_limit=-100)

    assert resp.status_code == 422


async def test_create_budget_instance_duplicate_period_returns_409(client):
    """A second instance with the same period is rejected; the first stays untouched."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]

    first = await _create_budget_instance(client, headers, base_budget_id)
    assert first.status_code == 201
    first_id = first.json()["id"]
    first_limit = first.json()["overall_limit"]

    second = await _create_budget_instance(client, headers, base_budget_id, overall_limit=50000)

    assert second.status_code == 409
    assert second.json()["detail"] == "A budget instance already exists for this period"

    # The rejected attempt must not have mutated the existing instance
    get_resp = await client.get(f"/budgets/{first_id}", headers=headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["overall_limit"] == first_limit


async def test_create_budget_instance_consecutive_periods_accepted(client):
    """Two instances with non-overlapping periods under the same base both succeed."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]

    march = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-03-01", period_end="2026-03-31",
    )
    assert march.status_code == 201

    april = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-04-01", period_end="2026-04-30",
    )
    assert april.status_code == 201
    assert april.json()["id"] != march.json()["id"]


async def test_create_budget_instance_same_period_different_base_accepted(client):
    """The same period under a different base budget is accepted — uniqueness is per base."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id = await _create_category(client, headers)
    base_a = (await _create_base_budget(
        client, headers, name="Budget A", category_ids=[cat_id],
    )).json()["id"]
    base_b = (await _create_base_budget(
        client, headers, name="Budget B", category_ids=[cat_id],
    )).json()["id"]

    first = await _create_budget_instance(client, headers, base_a)
    assert first.status_code == 201

    second = await _create_budget_instance(client, headers, base_b)
    assert second.status_code == 201


async def test_create_budget_instance_nonexistent_base_returns_404(client):
    """POST with a non-existent base_budget_id returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_budget_instance(client, headers, NONEXISTENT_ID)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_create_budget_instance_other_users_base_returns_404(client):
    """User cannot create an instance under another user's personal base budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]

    resp = await _create_budget_instance(client, other_headers, base_budget_id)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_create_group_budget_instance_as_admin(client):
    """Admin can create an instance under a group base budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = base_resp.json()["id"]

    resp = await _create_budget_instance(client, headers, base_budget_id)

    assert resp.status_code == 201
    data = resp.json()
    assert data["base_budget_id"] == base_budget_id
    assert data["base_budget"]["group_id"] == group_id


async def test_create_group_budget_instance_as_non_admin_without_permission_returns_404(client):
    """Non-admin group member without a permission row cannot create an instance."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = base_resp.json()["id"]

    resp = await _create_budget_instance(client, other_headers, base_budget_id)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_create_group_budget_instance_as_non_member_returns_404(client):
    """A user who is not a group member cannot create an instance — 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = base_resp.json()["id"]

    resp = await _create_budget_instance(client, other_headers, base_budget_id)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_create_group_budget_instance_with_read_permission_returns_403(client):
    """Non-admin with READ permission cannot create an instance (requires ADMIN)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = base_resp.json()["id"]

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "read"},
        headers=headers,
    )

    resp = await _create_budget_instance(client, other_headers, base_budget_id)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_create_group_budget_instance_with_write_permission_returns_403(client):
    """Non-admin with WRITE permission cannot create an instance (requires ADMIN)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = base_resp.json()["id"]

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "write"},
        headers=headers,
    )

    resp = await _create_budget_instance(client, other_headers, base_budget_id)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_create_budget_instance_unauthenticated_returns_401(client):
    """Creating an instance without auth returns 401."""
    resp = await client.post(
        f"/base-budgets/{NONEXISTENT_ID}/budgets",
        json={"period_start": "2026-03-01", "period_end": "2026-03-31", "overall_limit": 100000},
    )

    assert resp.status_code == 401


async def test_create_budget_instance_cascades_on_base_deletion(client):
    """Deleting the parent base budget cascades to its instances."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]

    instance_resp = await _create_budget_instance(client, headers, base_budget_id)
    instance_id = instance_resp.json()["id"]

    # Delete the parent base — should cascade to the instance
    del_resp = await client.delete(f"/base-budgets/{base_budget_id}", headers=headers)
    assert del_resp.status_code == 204

    # The instance should be gone via GET /budgets/{id}
    get_resp = await client.get(f"/budgets/{instance_id}", headers=headers)
    assert get_resp.status_code == 404
