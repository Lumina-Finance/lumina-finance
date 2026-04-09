from app.models.currency import Currency
from tests.conftest import TestSession
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
    Pass category_ids explicitly to override (including an empty list, which the API rejects).
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


# --- POST /base-budgets ---


async def test_create_base_budget_returns_201(client):
    """Valid payload creates a personal base budget with correct fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]
    cat_id = await _create_category(client, headers)

    resp = await _create_base_budget(client, headers, category_ids=[cat_id])

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "March Budget"
    assert data["owner_id"] == user_id
    assert data["group_id"] is None
    assert data["currency"] == "CAD"
    assert data["recurrence_freq"] is None
    assert data["recurrence_interval"] is None
    assert data["category_ids"] == [cat_id]
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_create_base_budget_with_multiple_categories(client):
    """Base budget created with multiple tracked categories returns all of them."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id_1 = await _create_category(client, headers, name="Groceries")
    cat_id_2 = await _create_category(client, headers, name="Takeout")

    resp = await _create_base_budget(client, headers, category_ids=[cat_id_1, cat_id_2])

    assert resp.status_code == 201
    assert len(resp.json()["category_ids"]) == 2
    assert set(resp.json()["category_ids"]) == {cat_id_1, cat_id_2}


async def test_create_base_budget_dedupes_category_ids(client):
    """Duplicate category IDs in the payload are deduplicated in the response."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id = await _create_category(client, headers)

    resp = await _create_base_budget(client, headers, category_ids=[cat_id, cat_id])

    assert resp.status_code == 201
    assert resp.json()["category_ids"] == [cat_id]


async def test_create_base_budget_with_recurrence(client):
    """Base budget with recurrence fields stores them correctly."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(
        client, headers,
        recurrence_freq="monthly",
        recurrence_interval=1,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["recurrence_freq"] == "monthly"
    assert data["recurrence_interval"] == 1


async def test_create_base_budget_non_base_currency_returns_201(client):
    """Base budgets may be created in any supported currency, not just the user's base.

    The frontend defaults to the user's base currency, but multi-currency users
    (e.g., a CAD-base user with a USD account) need separate per-currency base
    budgets to track spending against the correct accounts.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    resp = await _create_base_budget(client, headers, currency="USD")

    assert resp.status_code == 201
    assert resp.json()["currency"] == "USD"


async def test_create_base_budget_no_categories_returns_422(client):
    """Base budget must track at least one category — empty list is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(client, headers, category_ids=[])

    assert resp.status_code == 422


async def test_create_base_budget_missing_categories_returns_422(client):
    """category_ids is required — omitting the field is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post(
        "/base-budgets",
        json={"name": "March Budget", "currency": "CAD"},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_create_base_budget_invalid_category_returns_422(client):
    """Non-existent category ID is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(client, headers, category_ids=[NONEXISTENT_ID])

    assert resp.status_code == 422


async def test_create_base_budget_other_users_category_returns_422(client):
    """Category belonging to another user is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    other_cat_id = await _create_category(client, other_headers, name="Other Cat")

    resp = await _create_base_budget(client, headers, category_ids=[other_cat_id])

    assert resp.status_code == 422


async def test_create_base_budget_empty_name_returns_422(client):
    """Empty name is rejected by schema validation."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(client, headers, name="")

    assert resp.status_code == 422


async def test_create_base_budget_name_too_long_returns_422(client):
    """Name over the 256-character limit is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(client, headers, name="x" * 257)

    assert resp.status_code == 422


async def test_create_base_budget_missing_name_returns_422(client):
    """The name field is required — omitting it is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    cat_id = await _create_category(client, headers)

    resp = await client.post(
        "/base-budgets",
        json={"currency": "CAD", "category_ids": [cat_id]},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_create_base_budget_missing_currency_returns_422(client):
    """The currency field is required — omitting it is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    cat_id = await _create_category(client, headers)

    resp = await client.post(
        "/base-budgets",
        json={"name": "March Budget", "category_ids": [cat_id]},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_create_base_budget_invalid_currency_returns_422(client):
    """Currency must reference a valid currency row — unknown codes are rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(client, headers, currency="ZZZ")

    assert resp.status_code == 422


async def test_create_base_budget_recurrence_interval_zero_returns_422(client):
    """recurrence_interval must be >= 1 (Pydantic boundary)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(
        client, headers, recurrence_freq="monthly", recurrence_interval=0,
    )

    assert resp.status_code == 422


async def test_create_base_budget_unauthenticated_returns_401(client):
    """Creating a base budget without auth returns 401."""
    resp = await client.post("/base-budgets", json={
        "name": "Budget",
        "currency": "CAD",
        "category_ids": [NONEXISTENT_ID],
    })

    assert resp.status_code == 401


async def test_create_group_base_budget_as_admin(client):
    """Admin can create a base budget for a group."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    cat_id = await _create_category(client, headers, name="Groceries", group_id=group_id)

    resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[cat_id],
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["group_id"] == group_id
    assert data["owner_id"] is None


async def test_create_group_base_budget_as_non_admin_returns_403(client):
    """Non-admin member cannot create a base budget for a group."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": other_user_id},
        headers=headers,
    )
    cat_id = await _create_category(client, headers, name="Groceries", group_id=group_id)

    resp = await _create_base_budget(
        client, other_headers, group_id=group_id, category_ids=[cat_id],
    )

    assert resp.status_code == 403


async def test_create_group_base_budget_non_member_returns_404(client):
    """Non-member of the group cannot create a base budget for it."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    other_cat_id = await _create_category(client, other_headers, name="Other Cat")

    resp = await _create_base_budget(
        client, other_headers, group_id=group_id, category_ids=[other_cat_id],
    )

    assert resp.status_code == 404


async def test_create_group_base_budget_nonexistent_group_returns_404(client):
    """Non-existent group_id is indistinguishable from 'not a member' — returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    cat_id = await _create_category(client, headers)

    resp = await _create_base_budget(
        client, headers, group_id=NONEXISTENT_ID, category_ids=[cat_id],
    )

    assert resp.status_code == 404


async def test_create_group_base_budget_with_personal_category_returns_422(client):
    """A group base budget cannot track a personal category — scopes must match.

    If a group base budget tracked a personal category, only the creator could see
    and post to it; other group members would see a tracked-category UUID they don't
    own and their own transactions wouldn't reconcile against the group totals.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    personal_cat_id = await _create_category(client, headers, name="Groceries")

    resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[personal_cat_id],
    )

    assert resp.status_code == 422


async def test_create_personal_base_budget_with_group_category_returns_422(client):
    """A personal base budget cannot track a group category — symmetry of the group rule.

    Even if the user is a member of the group that owns the category, mixing a
    group category into a personal base budget would let them aggregate spend
    other group members can also see, blurring the personal/group boundary.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Groceries", group_id=group_id)

    resp = await _create_base_budget(client, headers, category_ids=[group_cat_id])

    assert resp.status_code == 422


# --- GET /base-budgets ---


async def test_list_base_budgets_returns_200(client):
    """User with base budgets gets them back alphabetically ordered by name."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    cat_id = await _create_category(client, headers)

    await _create_base_budget(client, headers, name="March Budget", category_ids=[cat_id])
    await _create_base_budget(client, headers, name="April Budget", category_ids=[cat_id])

    resp = await client.get("/base-budgets", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert [b["name"] for b in data] == ["April Budget", "March Budget"]


async def test_list_base_budgets_empty(client):
    """User with no base budgets gets an empty list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/base-budgets", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_base_budgets_includes_category_ids(client):
    """Listed base budgets include their currently-active tracked category IDs."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id = await _create_category(client, headers)
    await _create_base_budget(client, headers, category_ids=[cat_id])

    resp = await client.get("/base-budgets", headers=headers)

    assert resp.status_code == 200
    assert resp.json()[0]["category_ids"] == [cat_id]


async def test_list_base_budgets_includes_group_base_budgets(client):
    """User sees both personal and group base budgets they administer."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    await _create_base_budget(client, headers, name="Personal Budget")
    await _create_base_budget(
        client, headers, name="Family Budget", group_id=group_id, category_ids=[group_cat_id],
    )

    resp = await client.get("/base-budgets", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert {b["name"] for b in data} == {"Personal Budget", "Family Budget"}


async def test_list_base_budgets_group_member_without_permission_excluded(client):
    """Non-admin group member without explicit permission does not see group base budgets."""
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
    await _create_base_budget(
        client, headers, name="Family Budget", group_id=group_id, category_ids=[group_cat_id],
    )

    resp = await client.get("/base-budgets", headers=other_headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_base_budgets_group_member_with_permission(client):
    """Non-admin group member with READ permission sees the group base budget."""
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
    create_resp = await _create_base_budget(
        client, headers, name="Family Budget", group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    # Grant READ permission
    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "read"},
        headers=headers,
    )

    resp = await client.get("/base-budgets", headers=other_headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["name"] == "Family Budget"


async def test_list_base_budgets_excludes_other_users_base_budgets(client):
    """User does not see another user's personal base budgets."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    await _create_base_budget(client, headers, name="My Budget")

    resp = await client.get("/base-budgets", headers=other_headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_base_budgets_no_duplicates_for_group_base_budget(client):
    """Group base budget appears once even though the user is both owner and member."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    await _create_base_budget(
        client, headers, name="Family Budget", group_id=group_id, category_ids=[group_cat_id],
    )

    resp = await client.get("/base-budgets", headers=headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["name"] == "Family Budget"


async def test_list_base_budgets_excludes_soft_deleted_categories(client):
    """Listed base budgets only include currently-active tracked categories."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_keep = await _create_category(client, headers, name="Groceries")
    cat_remove = await _create_category(client, headers, name="Takeout")
    create_resp = await _create_base_budget(
        client, headers, category_ids=[cat_keep, cat_remove],
    )
    base_budget_id = create_resp.json()["id"]

    # Soft-delete `cat_remove` by PATCHing to the remaining category only
    await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"category_ids": [cat_keep]},
        headers=headers,
    )

    resp = await client.get("/base-budgets", headers=headers)

    assert resp.status_code == 200
    assert resp.json()[0]["category_ids"] == [cat_keep]


async def test_list_base_budgets_promoted_admin_sees_group_base_budgets(client):
    """A member promoted to admin (not the group owner) sees the group's base budgets."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, other_user_id = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    # Add the second user as a member, then promote to admin
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
    await _create_base_budget(
        client, headers, name="Family Budget", group_id=group_id, category_ids=[group_cat_id],
    )

    resp = await client.get("/base-budgets", headers=other_headers)

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["name"] == "Family Budget"


async def test_list_base_budgets_unauthenticated_returns_401(client):
    """Listing base budgets without auth returns 401."""
    resp = await client.get("/base-budgets")

    assert resp.status_code == 401
