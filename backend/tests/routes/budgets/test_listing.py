
from tests.routes.budgets._helpers import (
    _create_base_budget,
    _create_budget_instance,
    _create_category,
    _create_group,
    _create_second_user,
)
from tests.routes.support import _create_user, _get_auth_header

# --- GET /budgets ---


async def test_list_budgets_returns_200(client):
    """User with instances gets them back ordered by period_end desc, then base name."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]

    await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-03-01",
    )
    await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-04-01",
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

    cat_keep = await _create_category(client, headers, name="Test Category A")
    cat_remove = await _create_category(client, headers, name="Test Category B")
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
