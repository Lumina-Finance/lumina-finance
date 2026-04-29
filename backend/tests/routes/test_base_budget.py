from datetime import UTC, datetime

import sqlalchemy as sa

from app.models.budget import BudgetTrackedCategory
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
    payload = {"name": "Test Groceries", "kind": "expense", **overrides}
    resp = await client.post("/categories", json=payload, headers=headers)
    return resp.json()["id"]


async def _get_system_category_id(client, headers, name="Groceries"):
    """Return the ID for a seeded system category."""
    resp = await client.get("/categories", headers=headers)
    return next(category["id"] for category in resp.json() if category["name"] == name)


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
        "recurrence_freq": "monthly",
        "recurrence_dom": 1,
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
    assert data["recurrence_freq"] == "monthly"
    assert data["instance_length"] == 1
    assert data["recurrence_dom"] == 1
    assert data["recurrence_weekday"] is None
    assert data["recurrence_month"] is None
    assert data["recurs"] is False
    assert data["category_ids"] == [cat_id]
    assert data["id"] is not None
    assert data["created_at"] is not None


async def test_create_base_budget_with_multiple_categories(client):
    """Base budget created with multiple tracked categories returns all of them."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id_1 = await _create_category(client, headers, name="Test Groceries")
    cat_id_2 = await _create_category(client, headers, name="Test Takeout")

    resp = await _create_base_budget(client, headers, category_ids=[cat_id_1, cat_id_2])

    assert resp.status_code == 201
    assert len(resp.json()["category_ids"]) == 2
    assert set(resp.json()["category_ids"]) == {cat_id_1, cat_id_2}


async def test_create_base_budget_with_system_category(client):
    """Personal base budget can track a system category."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    cat_id = await _get_system_category_id(client, headers)

    resp = await _create_base_budget(client, headers, category_ids=[cat_id])

    assert resp.status_code == 201
    assert resp.json()["category_ids"] == [cat_id]


async def test_create_base_budget_dedupes_category_ids(client):
    """Duplicate category IDs in the payload are deduplicated in the response."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id = await _create_category(client, headers)

    resp = await _create_base_budget(client, headers, category_ids=[cat_id, cat_id])

    assert resp.status_code == 201
    assert resp.json()["category_ids"] == [cat_id]


async def test_create_base_budget_weekly_with_recurrence(client):
    """Weekly base budget with weekday anchor stores cadence fields correctly."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(
        client, headers,
        recurrence_freq="weekly",
        recurrence_weekday=0,
        recurrence_dom=None,
        instance_length=2,
        recurs=True,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["recurrence_freq"] == "weekly"
    assert data["instance_length"] == 2
    assert data["recurrence_weekday"] == 0
    assert data["recurrence_dom"] is None
    assert data["recurrence_month"] is None
    assert data["recurs"] is True


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


async def test_create_base_budget_instance_length_zero_returns_422(client):
    """instance_length must be >= 1 (Pydantic boundary)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(client, headers, instance_length=0)

    assert resp.status_code == 422


# --- POST /base-budgets — cadence field validation ---


async def test_create_base_budget_yearly_returns_201(client):
    """Yearly base budget stores cadence fields correctly."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(
        client, headers,
        recurrence_freq="yearly",
        recurrence_dom=1,
        recurrence_month=7,
        recurrence_weekday=None,
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["recurrence_freq"] == "yearly"
    assert data["instance_length"] == 1
    assert data["recurrence_dom"] == 1
    assert data["recurrence_month"] == 7
    assert data["recurrence_weekday"] is None
    assert data["recurs"] is False


async def test_create_base_budget_weekly_missing_weekday_returns_422(client):
    """Weekly cadence requires recurrence_weekday."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(
        client, headers,
        recurrence_freq="weekly",
        recurrence_dom=None,
    )

    assert resp.status_code == 422


async def test_create_base_budget_weekly_with_dom_returns_422(client):
    """Weekly cadence rejects recurrence_dom."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(
        client, headers,
        recurrence_freq="weekly",
        recurrence_weekday=0,
    )

    assert resp.status_code == 422


async def test_create_base_budget_weekly_with_month_returns_422(client):
    """Weekly cadence rejects recurrence_month."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(
        client, headers,
        recurrence_freq="weekly",
        recurrence_weekday=0,
        recurrence_dom=None,
        recurrence_month=3,
    )

    assert resp.status_code == 422


async def test_create_base_budget_monthly_missing_dom_returns_422(client):
    """Monthly cadence requires recurrence_dom."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(client, headers, recurrence_dom=None)

    assert resp.status_code == 422


async def test_create_base_budget_monthly_with_weekday_returns_422(client):
    """Monthly cadence rejects recurrence_weekday."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(client, headers, recurrence_weekday=0)

    assert resp.status_code == 422


async def test_create_base_budget_monthly_with_month_returns_422(client):
    """Monthly cadence rejects recurrence_month."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(client, headers, recurrence_month=3)

    assert resp.status_code == 422


async def test_create_base_budget_yearly_missing_dom_returns_422(client):
    """Yearly cadence requires recurrence_dom."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(
        client, headers,
        recurrence_freq="yearly",
        recurrence_dom=None,
        recurrence_month=7,
    )

    assert resp.status_code == 422


async def test_create_base_budget_yearly_with_weekday_returns_422(client):
    """Yearly cadence rejects recurrence_weekday."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(
        client, headers,
        recurrence_freq="yearly",
        recurrence_dom=1,
        recurrence_month=7,
        recurrence_weekday=0,
    )

    assert resp.status_code == 422


async def test_create_base_budget_weekday_below_range_returns_422(client):
    """recurrence_weekday below 0 is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(
        client, headers,
        recurrence_freq="weekly",
        recurrence_weekday=-1,
        recurrence_dom=None,
    )

    assert resp.status_code == 422


async def test_create_base_budget_weekday_above_range_returns_422(client):
    """recurrence_weekday above 6 is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(
        client, headers,
        recurrence_freq="weekly",
        recurrence_weekday=7,
        recurrence_dom=None,
    )

    assert resp.status_code == 422


async def test_create_base_budget_dom_below_range_returns_422(client):
    """recurrence_dom below 1 is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(client, headers, recurrence_dom=0)

    assert resp.status_code == 422


async def test_create_base_budget_dom_above_range_returns_422(client):
    """recurrence_dom above 31 is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(client, headers, recurrence_dom=32)

    assert resp.status_code == 422


async def test_create_base_budget_month_below_range_returns_422(client):
    """recurrence_month below 1 is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(
        client, headers,
        recurrence_freq="yearly",
        recurrence_dom=1,
        recurrence_month=0,
    )

    assert resp.status_code == 422


async def test_create_base_budget_month_above_range_returns_422(client):
    """recurrence_month above 12 is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(
        client, headers,
        recurrence_freq="yearly",
        recurrence_dom=1,
        recurrence_month=13,
    )

    assert resp.status_code == 422


async def test_create_base_budget_negative_instance_length_returns_422(client):
    """instance_length below 1 is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(client, headers, instance_length=-1)

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
    cat_id = await _create_category(client, headers, name="Test Groceries", group_id=group_id)

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
    cat_id = await _create_category(client, headers, name="Test Groceries", group_id=group_id)

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
    personal_cat_id = await _create_category(client, headers, name="Test Groceries")

    resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[personal_cat_id],
    )

    assert resp.status_code == 422


async def test_create_group_base_budget_with_system_category(client):
    """Group base budget can track a system category."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    cat_id = await _get_system_category_id(client, headers)

    resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[cat_id],
    )

    assert resp.status_code == 201
    assert resp.json()["category_ids"] == [cat_id]


async def test_create_personal_base_budget_with_group_category_returns_422(client):
    """A personal base budget cannot track a group category — symmetry of the group rule.

    Even if the user is a member of the group that owns the category, mixing a
    group category into a personal base budget would let them aggregate spend
    other group members can also see, blurring the personal/group boundary.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Test Groceries", group_id=group_id)

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

    cat_keep = await _create_category(client, headers, name="Test Groceries")
    cat_remove = await _create_category(client, headers, name="Test Takeout")
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


# --- GET /base-budgets/{base_budget_id} ---


async def test_get_base_budget_returns_200(client):
    """Owner can retrieve their personal base budget with the full response body populated."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    cat_id = await _create_category(client, headers)
    create_resp = await _create_base_budget(client, headers, category_ids=[cat_id])
    base_budget_id = create_resp.json()["id"]

    resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == base_budget_id
    assert data["name"] == "March Budget"
    assert data["owner_id"] == user_id
    assert data["group_id"] is None
    assert data["currency"] == "CAD"
    assert data["recurrence_freq"] == "monthly"
    assert data["instance_length"] == 1
    assert data["recurrence_dom"] == 1
    assert data["recurs"] is False
    assert data["created_at"] is not None
    assert data["category_ids"] == [cat_id]


async def test_get_base_budget_nonexistent_returns_404(client):
    """Non-existent base budget ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/base-budgets/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_get_base_budget_other_users_returns_404(client):
    """User cannot retrieve another user's personal base budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    resp = await client.get(f"/base-budgets/{base_budget_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_get_group_base_budget_as_admin(client):
    """Admin can retrieve a group base budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    create_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == base_budget_id
    assert data["group_id"] == group_id
    assert data["owner_id"] is None


async def test_get_group_base_budget_as_non_admin_without_permission_returns_404(client):
    """Non-admin group member without an explicit permission row returns 404."""
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
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    resp = await client.get(f"/base-budgets/{base_budget_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_get_group_base_budget_as_non_member_returns_404(client):
    """A user who is not a group member at all returns 404 — pins the no-membership branch."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    create_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    resp = await client.get(f"/base-budgets/{base_budget_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_get_group_base_budget_with_read_permission(client):
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
    create_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "read"},
        headers=headers,
    )

    resp = await client.get(f"/base-budgets/{base_budget_id}", headers=other_headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == base_budget_id
    assert data["group_id"] == group_id
    assert data["owner_id"] is None
    assert data["category_ids"] == [group_cat_id]


async def test_get_base_budget_excludes_soft_deleted_categories(client):
    """GET returns only currently-active tracked categories."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_keep = await _create_category(client, headers, name="Test Groceries")
    cat_remove = await _create_category(client, headers, name="Test Takeout")
    create_resp = await _create_base_budget(
        client, headers, category_ids=[cat_keep, cat_remove],
    )
    base_budget_id = create_resp.json()["id"]

    await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"category_ids": [cat_keep]},
        headers=headers,
    )

    resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["category_ids"] == [cat_keep]


async def test_get_base_budget_unauthenticated_returns_401(client):
    """Getting a base budget without auth returns 401."""
    resp = await client.get(f"/base-budgets/{NONEXISTENT_ID}")

    assert resp.status_code == 401


# --- PATCH /base-budgets/{base_budget_id} ---


async def test_update_base_budget_name_returns_200(client):
    """Rename round-trips unchanged for every other field; created_at stays pinned."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = signup_resp.json()["user"]["id"]

    cat_id = await _create_category(client, headers)
    create_resp = await _create_base_budget(client, headers, category_ids=[cat_id])
    base_budget_id = create_resp.json()["id"]
    original_created_at = create_resp.json()["created_at"]

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"name": "April Budget"},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == base_budget_id
    assert data["name"] == "April Budget"
    assert data["owner_id"] == user_id
    assert data["group_id"] is None
    assert data["currency"] == "CAD"
    assert data["category_ids"] == [cat_id]
    assert data["created_at"] == original_created_at


async def test_update_base_budget_recurs_returns_200(client):
    """The recurs flag is editable via PATCH."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"recurs": True},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["recurs"] is True


async def test_update_base_budget_add_categories(client):
    """Adding a tracked category via PATCH returns the updated category_ids."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id_1 = await _create_category(client, headers, name="Test Groceries")
    cat_id_2 = await _create_category(client, headers, name="Test Takeout")
    create_resp = await _create_base_budget(client, headers, category_ids=[cat_id_1])
    base_budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"category_ids": [cat_id_1, cat_id_2]},
        headers=headers,
    )

    assert resp.status_code == 200
    assert len(resp.json()["category_ids"]) == 2
    assert set(resp.json()["category_ids"]) == {cat_id_1, cat_id_2}


async def test_create_base_budget_sets_tracked_category_added_at_from_user_timezone(client, monkeypatch):
    """At Jan 1 01:00 UTC, Toronto-created category links are added on Dec 31."""
    from app.routes import base_budget as base_budget_routes

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 1, 1, 1, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    monkeypatch.setattr(base_budget_routes, "datetime", FixedDateTime)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    cat_id = await _create_category(client, headers)

    resp = await _create_base_budget(client, headers, category_ids=[cat_id])
    assert resp.status_code == 201

    async with TestSession() as session:
        tracked = (await session.execute(
            sa.select(BudgetTrackedCategory).where(BudgetTrackedCategory.category_id == cat_id),
        )).scalar_one()
        assert tracked.added_at.isoformat() == "2025-12-31"


async def test_update_base_budget_remove_categories(client):
    """Removing a tracked category via PATCH soft-deletes it from the response."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_keep = await _create_category(client, headers, name="Test Groceries")
    cat_remove = await _create_category(client, headers, name="Test Takeout")
    create_resp = await _create_base_budget(
        client, headers, category_ids=[cat_keep, cat_remove],
    )
    base_budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"category_ids": [cat_keep]},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["category_ids"] == [cat_keep]


async def test_update_base_budget_sets_removed_at_from_user_timezone(client, monkeypatch):
    """At Jan 1 01:00 UTC, Toronto removals are stamped Dec 31."""
    from app.routes import base_budget as base_budget_routes

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 1, 1, 1, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    monkeypatch.setattr(base_budget_routes, "datetime", FixedDateTime)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    cat_keep = await _create_category(client, headers, name="Test Groceries")
    cat_remove = await _create_category(client, headers, name="Test Takeout")
    base_budget_id = (await _create_base_budget(
        client, headers, category_ids=[cat_keep, cat_remove],
    )).json()["id"]

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"category_ids": [cat_keep]},
        headers=headers,
    )
    assert resp.status_code == 200

    async with TestSession() as session:
        tracked = (await session.execute(
            sa.select(BudgetTrackedCategory).where(BudgetTrackedCategory.category_id == cat_remove),
        )).scalar_one()
        assert tracked.removed_at.isoformat() == "2025-12-31"


async def test_update_base_budget_swap_categories(client):
    """Replacing one tracked category with another works correctly."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id_1 = await _create_category(client, headers, name="Test Groceries")
    cat_id_2 = await _create_category(client, headers, name="Test Takeout")
    create_resp = await _create_base_budget(client, headers, category_ids=[cat_id_1])
    base_budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"category_ids": [cat_id_2]},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["category_ids"] == [cat_id_2]


async def test_update_base_budget_readd_removed_category(client):
    """Re-adding a previously removed category results in a single active row."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id = await _create_category(client, headers)
    create_resp = await _create_base_budget(client, headers, category_ids=[cat_id])
    base_budget_id = create_resp.json()["id"]
    other_cat = await _create_category(client, headers, name="Test Takeout")

    # Remove then re-add the category
    await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"category_ids": [other_cat]},
        headers=headers,
    )
    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"category_ids": [cat_id]},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["category_ids"] == [cat_id]


async def test_update_base_budget_empty_categories_returns_422(client):
    """PATCH must track at least one category — empty list is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"category_ids": []},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_update_base_budget_invalid_category_returns_422(client):
    """Non-existent category ID in PATCH is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"category_ids": [NONEXISTENT_ID]},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_update_base_budget_other_users_category_returns_422(client):
    """PATCH cannot reference a category owned by another user."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]
    foreign_cat_id = await _create_category(client, other_headers, name="Foreign")

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"category_ids": [foreign_cat_id]},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_update_base_budget_with_system_category(client):
    """PATCH can replace tracked categories with a system category."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]
    cat_id = await _get_system_category_id(client, headers)

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"category_ids": [cat_id]},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["category_ids"] == [cat_id]


async def test_update_personal_base_budget_with_group_category_returns_422(client):
    """PATCH cannot smuggle a group category onto a personal base budget.

    Symmetry with the POST rule: personal budgets must stay within the user's own
    scope so aggregated spend never bleeds across the personal/group boundary.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]
    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"category_ids": [group_cat_id]},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_update_group_base_budget_with_personal_category_returns_422(client):
    """PATCH cannot smuggle a personal category onto a group base budget.

    The same scope rule that blocks creation must apply to updates — otherwise
    a client could create the base budget cleanly and then PATCH in a personal
    category, breaking the group-wide reconciliation.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Test Groceries", group_id=group_id)
    personal_cat_id = await _create_category(client, headers, name="Personal Groceries")

    create_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"category_ids": [personal_cat_id]},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_update_base_budget_empty_name_returns_422(client):
    """PATCH with empty name is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"name": ""},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_update_base_budget_name_too_long_returns_422(client):
    """PATCH with a name over the 256-character limit is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"name": "x" * 257},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_update_base_budget_ignores_immutable_cadence_fields(client):
    """PATCH with cadence fields silently ignores them — they are not in the update schema."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    # Send cadence fields alongside name — name updates, cadence stays unchanged
    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"name": "Renamed", "recurrence_freq": "weekly", "instance_length": 5},
        headers=headers,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Renamed"
    assert data["recurrence_freq"] == "monthly"
    assert data["instance_length"] == 1


async def test_update_base_budget_empty_body_returns_200(client):
    """Empty PATCH body returns the stored base budget unchanged in every field."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id = await _create_category(client, headers)
    create_resp = await _create_base_budget(
        client, headers,
        category_ids=[cat_id],
    )
    original = create_resp.json()

    resp = await client.patch(
        f"/base-budgets/{original['id']}",
        json={},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json() == original


async def test_update_base_budget_nonexistent_returns_404(client):
    """PATCH with a non-existent base budget ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.patch(
        f"/base-budgets/{NONEXISTENT_ID}",
        json={"name": "New Name"},
        headers=headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_update_base_budget_other_users_returns_404(client):
    """User cannot PATCH another user's personal base budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"name": "Hacked"},
        headers=other_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_update_group_base_budget_as_admin(client):
    """Admin can PATCH a group base budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    create_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"name": "Updated"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated"


async def test_update_group_base_budget_as_non_admin_without_permission_returns_404(client):
    """Non-admin member without a permission row cannot PATCH the base budget."""
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
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"name": "Hacked"},
        headers=other_headers,
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_update_group_base_budget_with_write_permission_returns_403(client):
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
    create_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "write"},
        headers=headers,
    )

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"name": "Hacked"},
        headers=other_headers,
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_update_group_base_budget_with_read_permission_returns_403(client):
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
    create_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "read"},
        headers=headers,
    )

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"name": "Hacked"},
        headers=other_headers,
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


async def test_update_base_budget_unauthenticated_returns_401(client):
    """PATCH without auth returns 401."""
    resp = await client.patch(
        f"/base-budgets/{NONEXISTENT_ID}",
        json={"name": "Hacked"},
    )

    assert resp.status_code == 401


# --- DELETE /base-budgets/{base_budget_id} ---


async def test_delete_base_budget_returns_204(client):
    """Owner can delete their personal base budget; a subsequent GET returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    resp = await client.delete(f"/base-budgets/{base_budget_id}", headers=headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_base_budget_with_tracked_categories_succeeds(client):
    """Deleting a base budget with tracked categories succeeds via the FK cascade."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    cat_id = await _create_category(client, headers)
    create_resp = await _create_base_budget(client, headers, category_ids=[cat_id])
    base_budget_id = create_resp.json()["id"]

    resp = await client.delete(f"/base-budgets/{base_budget_id}", headers=headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_group_base_budget_with_permissions_cascades(client):
    """Deleting a base budget cascades to its permission rows (FK cascade, not 500)."""
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
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "read"},
        headers=headers,
    )

    resp = await client.delete(f"/base-budgets/{base_budget_id}", headers=headers)

    assert resp.status_code == 204

    # Verify the member can no longer see the base budget
    get_resp = await client.get(f"/base-budgets/{base_budget_id}", headers=other_headers)
    assert get_resp.status_code == 404


async def test_delete_base_budget_twice_returns_404(client):
    """Deleting the same base budget twice — first call 204, second call 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    first = await client.delete(f"/base-budgets/{base_budget_id}", headers=headers)
    assert first.status_code == 204

    second = await client.delete(f"/base-budgets/{base_budget_id}", headers=headers)
    assert second.status_code == 404
    assert second.json()["detail"] == "Budget not found"


async def test_delete_base_budget_nonexistent_returns_404(client):
    """DELETE with a non-existent base budget ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.delete(f"/base-budgets/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"


async def test_delete_base_budget_other_users_returns_404(client):
    """User cannot delete another user's personal base budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    resp = await client.delete(f"/base-budgets/{base_budget_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"

    # Confirm the budget still exists from the owner's perspective
    get_resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)
    assert get_resp.status_code == 200


async def test_delete_group_base_budget_as_admin(client):
    """Admin can delete a group base budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    create_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    resp = await client.delete(f"/base-budgets/{base_budget_id}", headers=headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_group_base_budget_as_non_admin_without_permission_returns_404(client):
    """Non-admin member without a permission row cannot delete — 404, base budget preserved."""
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
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    resp = await client.delete(f"/base-budgets/{base_budget_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"

    # The base budget must still exist from the admin's perspective
    get_resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)
    assert get_resp.status_code == 200


async def test_delete_group_base_budget_as_non_member_returns_404(client):
    """A user who is not a group member cannot delete — 404, base budget preserved."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    create_resp = await _create_base_budget(
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    resp = await client.delete(f"/base-budgets/{base_budget_id}", headers=other_headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Budget not found"

    get_resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)
    assert get_resp.status_code == 200


async def test_delete_group_base_budget_with_read_permission_returns_403(client):
    """Non-admin with READ permission cannot delete — 403, base budget preserved."""
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
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "read"},
        headers=headers,
    )

    resp = await client.delete(f"/base-budgets/{base_budget_id}", headers=other_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"

    get_resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)
    assert get_resp.status_code == 200


async def test_delete_group_base_budget_with_write_permission_returns_403(client):
    """Non-admin with WRITE permission cannot delete — 403, base budget preserved."""
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
        client, headers, group_id=group_id, category_ids=[group_cat_id],
    )
    base_budget_id = create_resp.json()["id"]

    await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": other_user_id, "level": "write"},
        headers=headers,
    )

    resp = await client.delete(f"/base-budgets/{base_budget_id}", headers=other_headers)

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"

    get_resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)
    assert get_resp.status_code == 200


async def test_delete_base_budget_unauthenticated_returns_401(client):
    """DELETE without auth returns 401."""
    resp = await client.delete(f"/base-budgets/{NONEXISTENT_ID}")

    assert resp.status_code == 401
