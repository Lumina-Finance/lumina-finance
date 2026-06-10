
from tests.routes.budgets._helpers import (
    NONEXISTENT_ID,
    _create_base_budget,
    _create_budget_instance,
    _create_category,
    _create_group,
    _create_second_user,
)
from tests.routes.support import _create_user, _get_auth_header

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


async def test_create_budget_instance_updates_cache_status(client):
    """Creating a budget instance marks app data changed for cache validation."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(client, headers)
    before_resp = await client.get("/me/cache-status", headers=headers)
    resp = await _create_budget_instance(client, headers, base_resp.json()["id"])
    after_resp = await client.get("/me/cache-status", headers=headers)

    assert before_resp.status_code == 200
    assert resp.status_code == 201
    assert after_resp.status_code == 200
    before_changed_at = before_resp.json()["personal"]["changed_at"]
    after_payload = after_resp.json()
    after_changed_at = after_payload["personal"]["changed_at"]
    assert after_changed_at is not None
    assert after_changed_at != before_changed_at
    assert after_payload["changed_at"] == after_changed_at
    assert after_payload["personal"]["last_change_from_current_session"] is True


async def test_create_budget_instance_misaligned_period_start_returns_422(client):
    """period_start that doesn't match the base's cadence is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    base_resp = await _create_base_budget(client, headers)
    base_budget_id = base_resp.json()["id"]

    # Monthly with dom=1 — starting on the 15th is misaligned
    resp = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-03-15",
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
        json={"overall_limit": 100000},
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
        period_start="2026-03-01",
    )
    assert march.status_code == 201

    april = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-04-01",
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
        json={"period_start": "2026-03-01", "overall_limit": 100000},
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


# --- POST /base-budgets/{base_budget_id}/budgets — cadence variants ---


async def test_create_budget_instance_monthly_dom_15_returns_201(client):
    """Monthly budget anchored on day 15 computes period_end correctly."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(
        client, headers, recurrence_dom=15,
    )
    base_budget_id = base_resp.json()["id"]

    resp = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-03-15",
    )

    assert resp.status_code == 201
    assert resp.json()["period_start"] == "2026-03-15"
    assert resp.json()["period_end"] == "2026-04-14"


async def test_create_budget_instance_monthly_dom_31_fallback_returns_201(client):
    """Monthly budget with dom=31 on a 30-day month falls back to the last day."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(
        client, headers, recurrence_dom=31,
    )
    base_budget_id = base_resp.json()["id"]

    # April has 30 days, so dom=31 falls back to 30
    resp = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-04-30",
    )

    assert resp.status_code == 201
    assert resp.json()["period_start"] == "2026-04-30"
    assert resp.json()["period_end"] == "2026-05-30"


async def test_create_budget_instance_weekly_returns_201(client):
    """Weekly budget anchored on Monday computes a 7-day period."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(
        client, headers,
        recurrence_freq="weekly",
        recurrence_weekday=0,
        recurrence_dom=None,
    )
    base_budget_id = base_resp.json()["id"]

    # 2026-03-02 is a Monday
    resp = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-03-02",
    )

    assert resp.status_code == 201
    assert resp.json()["period_start"] == "2026-03-02"
    assert resp.json()["period_end"] == "2026-03-08"


async def test_create_budget_instance_yearly_returns_201(client):
    """Yearly budget anchored on Jul 1 computes a full fiscal-year period."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(
        client, headers,
        recurrence_freq="yearly",
        recurrence_dom=1,
        recurrence_month=7,
        recurrence_weekday=None,
    )
    base_budget_id = base_resp.json()["id"]

    resp = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-07-01",
    )

    assert resp.status_code == 201
    assert resp.json()["period_start"] == "2026-07-01"
    assert resp.json()["period_end"] == "2027-06-30"


async def test_create_budget_instance_quarterly_returns_201(client):
    """Quarterly budget (monthly with instance_length=3) spans three months."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(
        client, headers, instance_length=3,
    )
    base_budget_id = base_resp.json()["id"]

    resp = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-01-01",
    )

    assert resp.status_code == 201
    assert resp.json()["period_start"] == "2026-01-01"
    assert resp.json()["period_end"] == "2026-03-31"


async def test_create_budget_instance_biweekly_returns_201(client):
    """Biweekly budget (weekly with instance_length=2) spans 14 days."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(
        client, headers,
        recurrence_freq="weekly",
        recurrence_weekday=0,
        recurrence_dom=None,
        instance_length=2,
    )
    base_budget_id = base_resp.json()["id"]

    # 2026-03-02 is a Monday
    resp = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-03-02",
    )

    assert resp.status_code == 201
    assert resp.json()["period_start"] == "2026-03-02"
    assert resp.json()["period_end"] == "2026-03-15"


async def test_create_budget_instance_weekly_misaligned_returns_422(client):
    """Weekly budget rejects a period_start on the wrong weekday."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(
        client, headers,
        recurrence_freq="weekly",
        recurrence_weekday=0,
        recurrence_dom=None,
    )
    base_budget_id = base_resp.json()["id"]

    # 2026-03-03 is a Tuesday — misaligned for a Monday-anchored budget
    resp = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-03-03",
    )

    assert resp.status_code == 422


async def test_create_budget_instance_yearly_misaligned_returns_422(client):
    """Yearly budget rejects a period_start in the wrong month."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    base_resp = await _create_base_budget(
        client, headers,
        recurrence_freq="yearly",
        recurrence_dom=1,
        recurrence_month=7,
        recurrence_weekday=None,
    )
    base_budget_id = base_resp.json()["id"]

    # March instead of July — misaligned
    resp = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-03-01",
    )

    assert resp.status_code == 422


async def test_create_group_budget_instance_weekly_returns_201(client):
    """Group base budget with weekly cadence creates instances correctly."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers,
        group_id=group_id,
        category_ids=[group_cat_id],
        recurrence_freq="weekly",
        recurrence_weekday=0,
        recurrence_dom=None,
    )
    base_budget_id = base_resp.json()["id"]

    resp = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-03-02",
    )

    assert resp.status_code == 201
    assert resp.json()["period_start"] == "2026-03-02"
    assert resp.json()["period_end"] == "2026-03-08"
    assert resp.json()["base_budget"]["group_id"] == group_id


async def test_create_group_budget_instance_yearly_returns_201(client):
    """Group base budget with yearly cadence creates instances correctly."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, headers)
    group_cat_id = await _create_category(client, headers, name="Shared", group_id=group_id)
    base_resp = await _create_base_budget(
        client, headers,
        group_id=group_id,
        category_ids=[group_cat_id],
        recurrence_freq="yearly",
        recurrence_dom=1,
        recurrence_month=7,
        recurrence_weekday=None,
    )
    base_budget_id = base_resp.json()["id"]

    resp = await _create_budget_instance(
        client, headers, base_budget_id,
        period_start="2026-07-01",
    )

    assert resp.status_code == 201
    assert resp.json()["period_start"] == "2026-07-01"
    assert resp.json()["period_end"] == "2027-06-30"
    assert resp.json()["base_budget"]["group_id"] == group_id
