from datetime import datetime

from app.schemas.budget import BudgetResponse
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


# --- GET /budgets ---


async def test_list_budgets_returns_200(client):
    """User with instances gets them back ordered by period_end desc, then base name."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]

    await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-03-01", period_end="2026-03-31",
    )
    await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-04-01", period_end="2026-04-30",
    )

    resp = await client.get("/budgets", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    # Order: period_end desc — April (2026-04-30) comes before March (2026-03-31)
    assert data[0]["period_end"] == "2026-04-30"
    assert data[1]["period_end"] == "2026-03-31"


async def test_list_budgets_empty(client):
    """User with no instances gets an empty list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/budgets", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_budgets_includes_base_budget_embed(client):
    """Listed instances round-trip their own fields and embed the parent base budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id = await _create_category(client, headers)
    base_resp = await _create_base_budget(client, headers, category_ids=[cat_id])
    base_budget_id = base_resp.json()["id"]
    await _create_budget_instance(client, headers, base_budget_id)

    resp = await client.get("/budgets", headers=headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    row = resp.json()[0]
    assert row["period_start"] == "2026-03-01"
    assert row["period_end"] == "2026-03-31"
    assert row["overall_limit"] == 100000
    assert row["created_at"] is not None
    base = row["base_budget"]
    assert base["id"] == base_budget_id
    assert base["name"] == "March Budget"
    assert base["category_ids"] == [cat_id]


async def test_list_budgets_includes_group_instances(client):
    """User sees instances from both personal and group base budgets they administer."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    personal_base = (await _create_base_budget(client, headers)).json()["id"]
    await _create_budget_instance(client, headers, personal_base)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    group_base = (await _create_base_budget(
        client, headers, name="Family Budget",
        group_id=group_id, category_ids=[group_cat_id],
    )).json()["id"]
    await _create_budget_instance(client, headers, group_base)

    resp = await client.get("/budgets", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    # Distinct instance IDs — a duplicate-row regression would fail this
    assert len({row["id"] for row in data}) == 2
    assert {row["base_budget_id"] for row in data} == {personal_base, group_base}


async def test_list_budgets_group_member_without_permission_excluded(client):
    """Non-admin group member without a permission row does not see group instances."""
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
    await _create_budget_instance(client, headers, base_budget_id)

    resp = await client.get("/budgets", headers=other_headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_budgets_group_member_with_permission(client):
    """Non-admin group member with READ permission sees the group instance."""
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
    await _create_budget_instance(client, headers, base_budget_id)

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "read"},
        headers=headers,
    )

    resp = await client.get("/budgets", headers=other_headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["base_budget_id"] == base_budget_id


async def test_list_budgets_excludes_other_users_instances(client):
    """User does not see another user's personal budget instances."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    base_resp = await _create_base_budget(client, headers)
    await _create_budget_instance(client, headers, base_resp.json()["id"])

    resp = await client.get("/budgets", headers=other_headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_budgets_secondary_sort_by_base_name(client):
    """Instances with the same period_end are sorted alphabetically by base name."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id = await _create_category(client, headers)
    zebra_base = (await _create_base_budget(
        client, headers, name="Zebra Budget", category_ids=[cat_id],
    )).json()["id"]
    alpha_base = (await _create_base_budget(
        client, headers, name="Alpha Budget", category_ids=[cat_id],
    )).json()["id"]

    await _create_budget_instance(client, headers, zebra_base)
    await _create_budget_instance(client, headers, alpha_base)

    resp = await client.get("/budgets", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["base_budget"]["name"] == "Alpha Budget"
    assert data[1]["base_budget"]["name"] == "Zebra Budget"


async def test_list_budgets_no_duplicates_for_group_instance(client):
    """A group instance appears once even though the user is owner and admin."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    await _create_budget_instance(client, headers, base_resp.json()["id"])

    resp = await client.get("/budgets", headers=headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_list_budgets_excludes_soft_deleted_categories(client):
    """The embedded base budget in each instance only lists currently-active categories."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_keep = await _create_category(client, headers, name="Groceries")
    cat_remove = await _create_category(client, headers, name="Takeout")
    base_resp = await _create_base_budget(
        client, headers, category_ids=[cat_keep, cat_remove],
    )
    base_budget_id = base_resp.json()["id"]
    await _create_budget_instance(client, headers, base_budget_id)

    # Soft-delete cat_remove via PATCH on the base
    await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"category_ids": [cat_keep]},
        headers=headers,
    )

    resp = await client.get("/budgets", headers=headers)

    assert resp.status_code == 200
    assert resp.json()[0]["base_budget"]["category_ids"] == [cat_keep]


async def test_list_budgets_non_member_outsider_sees_nothing(client):
    """A user who is not a member of the group owning an instance's base sees nothing."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    await _create_budget_instance(client, headers, base_resp.json()["id"])

    resp = await client.get("/budgets", headers=other_headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_budgets_promoted_admin_sees_group_instances(client):
    """A member promoted to admin (not the group owner) sees the group's instances."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )
    await client.patch(
        f"/groups/{group_id}/members/{other_user_id}",
        json={"is_admin": True},
        headers=headers,
    )

    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    await _create_budget_instance(client, headers, base_resp.json()["id"])

    resp = await client.get("/budgets", headers=other_headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["base_budget"]["group_id"] == group_id


async def test_list_budgets_unauthenticated_returns_401(client):
    """Listing instances without auth returns 401."""
    resp = await client.get("/budgets")

    assert resp.status_code == 401


# --- GET /budgets/{budget_id} ---


async def test_get_budget_returns_200(client):
    """Owner can retrieve their instance with the full response body and base embed."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    cat_id = await _create_category(client, headers)
    base_resp = await _create_base_budget(client, headers, category_ids=[cat_id])
    base_budget_id = base_resp.json()["id"]
    instance_resp = await _create_budget_instance(client, headers, base_budget_id)
    instance_id = instance_resp.json()["id"]

    resp = await client.get(f"/budgets/{instance_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    # Lock the response key sets so a regression that adds or drops fields is loud
    assert set(data.keys()) == {
        "id", "base_budget_id", "period_start", "period_end",
        "overall_limit", "created_at", "base_budget",
    }
    assert set(data["base_budget"].keys()) == {
        "id", "owner_id", "group_id", "name", "currency",
        "recurrence_freq", "recurrence_interval", "created_at", "category_ids",
    }
    # Instance fields
    assert data["id"] == instance_id
    assert data["base_budget_id"] == base_budget_id
    assert data["period_start"] == "2026-03-01"
    assert data["period_end"] == "2026-03-31"
    assert data["overall_limit"] == 100000
    # Embedded base fields
    base = data["base_budget"]
    assert base["id"] == base_budget_id
    assert base["owner_id"] == user_id
    assert base["group_id"] is None
    assert base["name"] == "March Budget"
    assert base["currency"] == "CAD"
    assert base["recurrence_freq"] is None
    assert base["recurrence_interval"] is None
    assert base["category_ids"] == [cat_id]
    # created_at is a real ISO timestamp on both, and the instance is created
    # at-or-after its parent base (the test creates the base first)
    instance_ts = datetime.fromisoformat(data["created_at"])
    base_ts = datetime.fromisoformat(base["created_at"])
    assert instance_ts >= base_ts
    # Pydantic round-trip catches any type drift in dates, UUIDs, or the embed
    BudgetResponse(**data)


async def test_get_budget_nonexistent_returns_404(client):
    """Non-existent instance ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/budgets/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_get_budget_other_users_returns_404(client):
    """User cannot retrieve another user's personal instance."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.get(f"/budgets/{instance_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_get_group_budget_as_admin(client):
    """Admin can retrieve a group instance with all base fields populated."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.get(f"/budgets/{instance_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == instance_id
    base = data["base_budget"]
    assert base["group_id"] == group_id
    assert base["owner_id"] is None
    assert base["category_ids"] == [group_cat_id]


async def test_get_group_budget_as_non_admin_without_permission_returns_404(client):
    """Non-admin group member without a permission row returns 404."""
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
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.get(f"/budgets/{instance_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_get_group_budget_as_non_member_returns_404(client):
    """A user who is not a group member at all returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.get(f"/budgets/{instance_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_get_group_budget_with_read_permission(client):
    """Non-admin member with READ permission gets the same response shape the admin sees."""
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
    instance_resp = await _create_budget_instance(client, headers, base_budget_id)
    instance_id = instance_resp.json()["id"]

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "read"},
        headers=headers,
    )

    resp = await client.get(f"/budgets/{instance_id}", headers=other_headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == instance_id
    assert data["base_budget"]["id"] == base_budget_id
    assert data["base_budget"]["group_id"] == group_id
    assert data["base_budget"]["category_ids"] == [group_cat_id]


async def test_get_budget_excludes_soft_deleted_categories(client):
    """GET returns only currently-active tracked categories in the embedded base."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_keep = await _create_category(client, headers, name="Groceries")
    cat_remove = await _create_category(client, headers, name="Takeout")
    base_resp = await _create_base_budget(
        client, headers, category_ids=[cat_keep, cat_remove],
    )
    base_budget_id = base_resp.json()["id"]
    instance_resp = await _create_budget_instance(client, headers, base_budget_id)
    instance_id = instance_resp.json()["id"]

    await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"category_ids": [cat_keep]},
        headers=headers,
    )

    resp = await client.get(f"/budgets/{instance_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["base_budget"]["category_ids"] == [cat_keep]


async def test_get_group_budget_promoted_admin_sees_instance(client):
    """A member promoted to admin (not the group creator) can GET the instance."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )
    await client.patch(
        f"/groups/{group_id}/members/{other_user_id}",
        json={"is_admin": True},
        headers=headers,
    )

    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.get(f"/budgets/{instance_id}", headers=other_headers)

    assert resp.status_code == 200
    assert resp.json()["id"] == instance_id


async def test_get_group_budget_with_write_permission(client):
    """Non-admin with WRITE permission satisfies the READ requirement on GET."""
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
    instance_resp = await _create_budget_instance(client, headers, base_budget_id)
    instance_id = instance_resp.json()["id"]

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "write"},
        headers=headers,
    )

    resp = await client.get(f"/budgets/{instance_id}", headers=other_headers)

    assert resp.status_code == 200
    assert resp.json()["id"] == instance_id


async def test_get_group_budget_with_admin_permission(client):
    """Non-admin with ADMIN permission satisfies the READ requirement on GET."""
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
    instance_resp = await _create_budget_instance(client, headers, base_budget_id)
    instance_id = instance_resp.json()["id"]

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "admin"},
        headers=headers,
    )

    resp = await client.get(f"/budgets/{instance_id}", headers=other_headers)

    assert resp.status_code == 200
    assert resp.json()["id"] == instance_id


async def test_get_group_budget_as_admin_of_different_group_returns_404(client):
    """Admin of group A cannot GET an instance belonging to group B — pins the group_id filter."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    # Other user creates their own group (so they're an admin of group B)
    other_group_id = await _create_group(client, other_headers)
    other_group_cat_id = await _create_category(
        client, other_headers, name="Other Group Cat", group_id=other_group_id,
    )
    await _create_base_budget(
        client, other_headers,
        group_id=other_group_id, category_ids=[other_group_cat_id],
    )

    # Original user creates group A and an instance the cross-admin shouldn't see
    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.get(f"/budgets/{instance_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_get_budget_with_base_budget_uuid_returns_404(client):
    """GET /budgets/{base_budget_id} returns 404 — base IDs and instance IDs are distinct namespaces."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]
    await _create_budget_instance(client, headers, base_budget_id)

    # Probing the instance route with the BASE UUID must not resolve
    resp = await client.get(f"/budgets/{base_budget_id}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_get_budget_unauthenticated_returns_401(client):
    """Getting a real instance without auth returns 401 (auth runs before DB lookup)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.get(f"/budgets/{instance_id}")

    assert resp.status_code == 401


# --- PATCH /budgets/{budget_id} ---


async def test_update_budget_period_start_returns_200(client):
    """Owner can update period_start; created_at stays pinned and the embedded base round-trips."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]
    instance_resp = await _create_budget_instance(client, headers, base_budget_id)
    instance_id = instance_resp.json()["id"]
    original_created_at = instance_resp.json()["created_at"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"period_start": "2026-03-05"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == instance_id
    assert data["period_start"] == "2026-03-05"
    assert data["period_end"] == "2026-03-31"
    assert data["overall_limit"] == 100000
    assert data["created_at"] == original_created_at
    assert data["base_budget"]["id"] == base_budget_id


async def test_update_budget_period_end_returns_200(client):
    """Owner can update period_end alone; created_at stays pinned."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]
    original_created_at = instance_resp.json()["created_at"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"period_end": "2026-04-15"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["period_start"] == "2026-03-01"
    assert data["period_end"] == "2026-04-15"
    assert data["created_at"] == original_created_at


async def test_update_budget_overall_limit_returns_200(client):
    """Owner can update overall_limit alone; created_at stays pinned."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]
    original_created_at = instance_resp.json()["created_at"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": 250000},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["overall_limit"] == 250000
    assert resp.json()["created_at"] == original_created_at


async def test_update_budget_all_fields_returns_200(client):
    """Owner can update period_start, period_end, and overall_limit in one call."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]
    original_created_at = instance_resp.json()["created_at"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={
            "period_start": "2026-04-01",
            "period_end": "2026-04-30",
            "overall_limit": 200000,
        },
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == instance_id
    assert data["period_start"] == "2026-04-01"
    assert data["period_end"] == "2026-04-30"
    assert data["overall_limit"] == 200000
    assert data["created_at"] == original_created_at


async def test_update_budget_empty_body_returns_200(client):
    """Empty PATCH body returns the stored instance unchanged in every field."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    original = instance_resp.json()

    resp = await client.patch(
        f"/budgets/{original['id']}",
        json={},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == original


async def test_update_budget_start_after_end_returns_422(client):
    """PATCH with period_start > period_end is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"period_start": "2026-03-31", "period_end": "2026-03-01"},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Period start must not be after period end"


async def test_update_budget_period_start_after_existing_end_returns_422(client):
    """PATCH that would push period_start past the existing (unchanged) period_end is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]
    # Original period: 2026-03-01 to 2026-03-31

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"period_start": "2026-04-15"},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Period start must not be after period end"


async def test_update_budget_period_end_before_existing_start_returns_422(client):
    """PATCH that would pull period_end before the existing (unchanged) period_start is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]
    # Original period: 2026-03-01 to 2026-03-31

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"period_end": "2026-02-15"},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Period start must not be after period end"


async def test_update_budget_same_day_period_returns_200(client):
    """PATCH to a single-day period (period_start == period_end) is accepted."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"period_start": "2026-03-15", "period_end": "2026-03-15"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["period_start"] == "2026-03-15"
    assert data["period_end"] == "2026-03-15"


async def test_update_budget_zero_overall_limit_returns_422(client):
    """PATCH with overall_limit=0 is rejected at the Pydantic layer (gt=0)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": 0},
        headers=headers,
    )

    assert resp.status_code == 422
    # Pydantic 422 — detail is a list of errors, with `loc` pointing at the field
    detail = resp.json()["detail"]
    assert isinstance(detail, list)
    assert any("overall_limit" in err["loc"] for err in detail)


async def test_update_budget_negative_overall_limit_returns_422(client):
    """PATCH with a negative overall_limit is rejected at the Pydantic layer (gt=0)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": -100},
        headers=headers,
    )

    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert isinstance(detail, list)
    assert any("overall_limit" in err["loc"] for err in detail)


async def test_update_budget_does_not_mutate_base_budget(client):
    """PATCHing an instance leaves the parent base budget untouched."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]
    original_base = base_resp.json()
    instance_resp = await _create_budget_instance(client, headers, base_budget_id)
    instance_id = instance_resp.json()["id"]

    patch_resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": 999999},
        headers=headers,
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["overall_limit"] == 999999

    base_after = (await client.get(f"/base-budgets/{base_budget_id}", headers=headers)).json()
    assert base_after == original_base


async def test_update_budget_nonexistent_returns_404(client):
    """PATCH with a non-existent budget ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(
        f"/budgets/{NONEXISTENT_ID}",
        json={"overall_limit": 50000},
        headers=headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_update_budget_other_users_returns_404(client):
    """User cannot PATCH another user's personal instance."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": 99},
        headers=other_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_update_group_budget_as_admin(client):
    """Admin can PATCH a group instance."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": 250000},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["overall_limit"] == 250000


async def test_update_group_budget_as_non_admin_without_permission_returns_404(client):
    """Non-admin group member without a permission row cannot PATCH the instance."""
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
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": 99},
        headers=other_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_update_group_budget_as_non_member_returns_404(client):
    """A user who is not a group member cannot PATCH the instance."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": 99},
        headers=other_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_update_group_budget_with_read_permission_returns_403(client):
    """Non-admin with READ permission cannot PATCH (requires ADMIN)."""
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
    instance_resp = await _create_budget_instance(client, headers, base_budget_id)
    instance_id = instance_resp.json()["id"]

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "read"},
        headers=headers,
    )

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": 99},
        headers=other_headers,
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_update_group_budget_with_write_permission_returns_403(client):
    """Non-admin with WRITE permission cannot PATCH (requires ADMIN)."""
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
    instance_resp = await _create_budget_instance(client, headers, base_budget_id)
    instance_id = instance_resp.json()["id"]

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "write"},
        headers=headers,
    )

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": 99},
        headers=other_headers,
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_update_budget_unauthenticated_returns_401(client):
    """PATCH without auth returns 401."""
    resp = await client.patch(
        f"/budgets/{NONEXISTENT_ID}",
        json={"overall_limit": 99},
    )

    assert resp.status_code == 401


async def test_update_budget_null_period_start_returns_422(client):
    """PATCH with explicit null period_start is rejected — non-nullable field."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"period_start": None},
        headers=headers,
    )

    assert resp.status_code == 422
    assert "period_start" in resp.json()["detail"]


async def test_update_budget_null_period_end_returns_422(client):
    """PATCH with explicit null period_end is rejected — non-nullable field."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"period_end": None},
        headers=headers,
    )

    assert resp.status_code == 422
    assert "period_end" in resp.json()["detail"]


async def test_update_budget_null_overall_limit_returns_422(client):
    """PATCH with explicit null overall_limit is rejected — non-nullable field."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"overall_limit": None},
        headers=headers,
    )

    assert resp.status_code == 422
    assert "overall_limit" in resp.json()["detail"]


async def test_update_budget_duplicate_period_returns_409(client):
    """PATCHing one instance's period onto another existing period under the same base returns 409."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]

    march = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-03-01", period_end="2026-03-31",
    )
    april = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-04-01", period_end="2026-04-30",
    )
    april_id = april.json()["id"]
    march_id = march.json()["id"]

    # Try to PATCH April's period onto March's
    resp = await client.patch(
        f"/budgets/{april_id}",
        json={"period_start": "2026-03-01", "period_end": "2026-03-31"},
        headers=headers,
    )

    assert resp.status_code == 409
    assert resp.json()["detail"] == "A budget instance already exists for this period"

    # March's instance must be untouched
    march_after = (await client.get(f"/budgets/{march_id}", headers=headers)).json()
    assert march_after["period_start"] == "2026-03-01"
    assert march_after["period_end"] == "2026-03-31"


async def test_update_budget_preserves_state_on_validation_error(client):
    """A 422 from period validation must not have mutated the instance."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]
    snapshot = instance_resp.json()

    # Send a body with a valid limit but an invalid period — the limit must
    # not leak through if the period validation rejects the request
    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"period_start": "2026-04-15", "overall_limit": 999999},
        headers=headers,
    )
    assert resp.status_code == 422

    after = (await client.get(f"/budgets/{instance_id}", headers=headers)).json()
    assert after == snapshot


async def test_update_budget_ignores_unknown_fields(client):
    """Unknown extra fields are dropped by Pydantic — no leakage onto unintended columns."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]
    instance_resp = await _create_budget_instance(client, headers, base_budget_id)
    instance_id = instance_resp.json()["id"]

    # Try to smuggle in base_budget_id and an arbitrary extra field
    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={
            "base_budget_id": NONEXISTENT_ID,
            "junk_field": "ignored",
            "overall_limit": 55555,
        },
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    # Known fields applied
    assert data["overall_limit"] == 55555
    # Unknown smuggled field had no effect
    assert data["base_budget_id"] == base_budget_id


async def test_update_budget_period_start_equals_existing_end_returns_200(client):
    """Single-day narrowing — period_start may equal period_end (the route uses strict `>`)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    instance_resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    instance_id = instance_resp.json()["id"]
    # Original period: 2026-03-01 to 2026-03-31

    resp = await client.patch(
        f"/budgets/{instance_id}",
        json={"period_start": "2026-03-31"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["period_start"] == "2026-03-31"
    assert data["period_end"] == "2026-03-31"
