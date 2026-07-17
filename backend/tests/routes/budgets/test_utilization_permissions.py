"""Route tests for budget utilization endpoints."""


from tests.routes.budgets._utilization_helpers import (
    NONEXISTENT_ID,
    _create_base_with_instance,
    _create_category,
    _create_group,
    _create_second_user,
    _get_base_budget_utilizations,
    _get_budget_utilization_entry,
    _grant_base_budget_permission,
)
from tests.routes.support import _create_user, _get_auth_header

# --- GET /base-budgets/{id}/utilizations — auth and permissions ---


async def test_get_budget_utilization_unauthenticated_returns_401(client):
    """Anonymous requests are rejected before reaching the handler."""
    resp = await client.get(f"/base-budgets/{NONEXISTENT_ID}/utilizations")
    assert resp.status_code == 401


async def test_get_budget_utilization_other_users_personal_budget_returns_404(client):
    """A second user cannot access another user's personal base budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    base_id, _ = await _create_base_with_instance(client, headers)

    other_headers, _ = await _create_second_user(client)
    resp = await _get_base_budget_utilizations(client, other_headers, base_id)
    assert resp.status_code == 404


async def test_get_budget_utilization_personal_owner_can_read_own(client):
    """A personal budget owner can read its utilization."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_id, budget_id = await _create_base_with_instance(client, headers)

    entry = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    assert entry["budget_id"] == budget_id


async def test_get_budget_utilization_group_admin_can_read_group_budget(client):
    """A group admin has implicit access to read group budget utilization."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    groceries = await _create_category(client, admin_headers, group_id=group_id)
    base_id, budget_id = await _create_base_with_instance(
        client, admin_headers,
        category_ids=[groceries],
        base_overrides={"group_id": group_id},
    )

    entry = await _get_budget_utilization_entry(client, admin_headers, base_id, budget_id)
    assert entry["budget_id"] == budget_id
    assert len(entry["categories"]) == 1
    assert entry["categories"][0]["category_id"] == groceries
    assert entry["categories"][0]["spent"] == 0
    assert entry["total_spent"] == 0


async def test_get_budget_utilization_group_member_with_read_permission_can_access(client):
    """A group member granted READ on the base budget can read its utilization."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    groceries = await _create_category(client, admin_headers, group_id=group_id)
    base_id, budget_id = await _create_base_with_instance(
        client, admin_headers,
        category_ids=[groceries],
        base_overrides={"group_id": group_id},
    )

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )
    await _grant_base_budget_permission(client, admin_headers, base_id, member_user_id, "read")

    entry = await _get_budget_utilization_entry(client, member_headers, base_id, budget_id)
    assert entry["budget_id"] == budget_id
    assert len(entry["categories"]) == 1
    assert entry["total_spent"] == 0


async def test_get_budget_utilization_group_member_with_write_permission_can_read(client):
    """WRITE on a base budget implies READ — utilization is accessible."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    groceries = await _create_category(client, admin_headers, group_id=group_id)
    base_id, budget_id = await _create_base_with_instance(
        client, admin_headers,
        category_ids=[groceries],
        base_overrides={"group_id": group_id},
    )

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )
    await _grant_base_budget_permission(client, admin_headers, base_id, member_user_id, "write")

    entry = await _get_budget_utilization_entry(client, member_headers, base_id, budget_id)
    assert entry["budget_id"] == budget_id
    assert len(entry["categories"]) == 1
    assert entry["total_spent"] == 0


async def test_get_budget_utilization_group_member_with_admin_permission_can_read(client):
    """ADMIN on a base budget implies READ — locks in the WRITE < ADMIN ladder ordering."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    groceries = await _create_category(client, admin_headers, group_id=group_id)
    base_id, budget_id = await _create_base_with_instance(
        client, admin_headers,
        category_ids=[groceries],
        base_overrides={"group_id": group_id},
    )

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )
    await _grant_base_budget_permission(client, admin_headers, base_id, member_user_id, "admin")

    entry = await _get_budget_utilization_entry(client, member_headers, base_id, budget_id)
    assert entry["budget_id"] == budget_id
    assert len(entry["categories"]) == 1
    assert entry["total_spent"] == 0


async def test_get_budget_utilization_group_member_without_permission_returns_404(client):
    """A group member with no explicit permission on the base budget gets 404."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    groceries = await _create_category(client, admin_headers, group_id=group_id)
    base_id, _ = await _create_base_with_instance(
        client, admin_headers,
        category_ids=[groceries],
        base_overrides={"group_id": group_id},
    )

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )

    resp = await _get_base_budget_utilizations(client, member_headers, base_id)
    assert resp.status_code == 404


async def test_get_budget_utilization_non_group_user_returns_404(client):
    """A user who is not a member of the budget's group gets 404."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    groceries = await _create_category(client, admin_headers, group_id=group_id)
    base_id, _ = await _create_base_with_instance(
        client, admin_headers,
        category_ids=[groceries],
        base_overrides={"group_id": group_id},
    )

    other_headers, _ = await _create_second_user(client)
    resp = await _get_base_budget_utilizations(client, other_headers, base_id)
    assert resp.status_code == 404
