from datetime import datetime

from app.schemas.budget import BudgetResponse
from tests.routes.budgets._helpers import (
    NONEXISTENT_ID,
    _create_base_budget,
    _create_budget_instance,
    _create_category,
    _create_group,
    _create_second_user,
)
from tests.routes.support import _create_user, _get_auth_header

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
        "recurrence_freq", "instance_length", "recurrence_weekday",
        "recurrence_dom", "recurrence_month", "recurs", "is_archived",
        "created_at", "category_ids",
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
    assert base["recurrence_freq"] == "monthly"
    assert base["instance_length"] == 1
    assert base["recurrence_dom"] == 1
    assert base["recurs"] is False
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

    cat_keep = await _create_category(client, headers, name="Test Category A")
    cat_remove = await _create_category(client, headers, name="Test Category B")
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
