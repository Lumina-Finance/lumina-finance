import importlib
import uuid
from datetime import UTC, datetime

import sqlalchemy as sa

from app.models.budget import Budget, BudgetTrackedCategory
from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.base_budgets._helpers import (
    NONEXISTENT_ID,
    _create_base_budget,
    _create_category,
    _create_group,
    _create_second_user,
    _get_system_category_id,
)
from tests.routes.support import _create_user, _get_auth_header

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


async def test_create_base_budget_materializes_recurring_periods_through_today(client, monkeypatch):
    """Initial recurring budget creation creates historical periods through local today."""
    base_budget_routes = importlib.import_module("app.routes.base_budgets.router")

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 5, 4, 16, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    monkeypatch.setattr(base_budget_routes, "datetime", FixedDateTime)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    cat_id = await _create_category(client, headers)

    resp = await _create_base_budget(
        client,
        headers,
        category_ids=[cat_id],
        recurs=True,
        period_start="2026-01-01",
        overall_limit=75000,
    )

    assert resp.status_code == 201
    base_budget_id = resp.json()["id"]
    async with TestSession() as session:
        periods = (await session.execute(
            sa.select(Budget)
            .where(Budget.base_budget_id == uuid.UUID(base_budget_id))
            .order_by(Budget.period_start),
        )).scalars().all()
        tracked = (await session.execute(
            sa.select(BudgetTrackedCategory).where(BudgetTrackedCategory.category_id == cat_id),
        )).scalar_one()

    assert [
        (period.period_start.isoformat(), period.period_end.isoformat(), period.overall_limit)
        for period in periods
    ] == [
        ("2026-01-01", "2026-01-31", 75000),
        ("2026-02-01", "2026-02-28", 75000),
        ("2026-03-01", "2026-03-31", 75000),
        ("2026-04-01", "2026-04-30", 75000),
        ("2026-05-01", "2026-05-31", 75000),
    ]
    assert tracked.added_at.isoformat() == "2026-01-01"


async def test_create_base_budget_initial_period_requires_limit(client):
    """The atomic create path requires period_start and overall_limit together."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _create_base_budget(client, headers, period_start="2026-01-01")

    assert resp.status_code == 422


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
