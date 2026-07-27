import importlib
import uuid
from datetime import UTC, date, datetime

import sqlalchemy as sa

from app.models.budget import Budget, BudgetTrackedCategory
from tests.conftest import TestSession
from tests.routes.base_budgets._helpers import (
    NONEXISTENT_ID,
    _create_base_budget,
    _create_budget_instance,
    _create_category,
    _create_group,
    _create_second_user,
    _get_system_category_id,
)
from tests.routes.support import _create_user, _get_auth_header

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


async def test_update_base_budget_archive_toggle_returns_200(client):
    """Archiving then clearing is_archived round-trips through the column in both directions."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]
    assert create_resp.json()["is_archived"] is False

    archive_resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"is_archived": True},
        headers=headers,
    )

    assert archive_resp.status_code == 200
    assert archive_resp.json()["is_archived"] is True

    unarchive_resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"is_archived": False},
        headers=headers,
    )

    assert unarchive_resp.status_code == 200
    assert unarchive_resp.json()["is_archived"] is False


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
    base_budget_routes = importlib.import_module("app.routes.base_budgets.router")

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
    base_budget_routes = importlib.import_module("app.routes.base_budgets.router")

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
    """PATCH cannot smuggle a group category onto a personal base budget

    Symmetry with the POST rule: personal budgets must stay within the user's own
    scope so aggregated spend never bleeds across the personal/group boundary
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
    """PATCH cannot smuggle a personal category onto a group base budget

    The same scope rule that blocks creation must apply to updates — otherwise
    a client could create the base budget cleanly and then PATCH in a personal
    category, breaking the group-wide reconciliation
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


# --- PATCH /base-budgets/{base_budget_id} — unarchive resume ---


async def test_unarchive_base_budget_resumes_current_period_only(client, monkeypatch):
    """Unarchiving materializes only the current period and carries the newest cap forward

    The archived gap between the last prior instance and the current period is never backfilled
    """
    base_budget_routes = importlib.import_module("app.routes.base_budgets.router")

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 5, 4, 16, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    monkeypatch.setattr(base_budget_routes, "datetime", FixedDateTime)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    # Two prior instances with distinct caps so the carried limit proves resume took the newest
    await _create_budget_instance(
        client, headers, base_budget_id, period_start="2026-02-01", overall_limit=80000,
    )
    await _create_budget_instance(
        client, headers, base_budget_id, period_start="2026-03-01", overall_limit=100000,
    )

    await client.patch(
        f"/base-budgets/{base_budget_id}", json={"is_archived": True}, headers=headers,
    )
    resume_resp = await client.patch(
        f"/base-budgets/{base_budget_id}", json={"is_archived": False}, headers=headers,
    )

    assert resume_resp.status_code == 200
    assert resume_resp.json()["is_archived"] is False

    async with TestSession() as session:
        instances = (await session.execute(
            sa.select(Budget)
            .where(Budget.base_budget_id == uuid.UUID(base_budget_id))
            .order_by(Budget.period_start),
        )).scalars().all()

    # The May current period is added at the newest cap while the archived April gap stays unfilled
    assert [
        (budget.period_start.isoformat(), budget.period_end.isoformat(), budget.overall_limit)
        for budget in instances
    ] == [
        ("2026-02-01", "2026-02-28", 80000),
        ("2026-03-01", "2026-03-31", 100000),
        ("2026-05-01", "2026-05-31", 100000),
    ]


async def test_unarchive_base_budget_with_existing_current_period_is_idempotent(client, monkeypatch):
    """Unarchiving creates no duplicate when an instance already covers the current period."""
    base_budget_routes = importlib.import_module("app.routes.base_budgets.router")

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 5, 4, 16, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    monkeypatch.setattr(base_budget_routes, "datetime", FixedDateTime)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    # The sole instance already covers the current (May) period that resume would target
    instance_resp = await _create_budget_instance(
        client, headers, base_budget_id, period_start="2026-05-01", overall_limit=100000,
    )
    current_period_instance_id = instance_resp.json()["id"]

    await client.patch(
        f"/base-budgets/{base_budget_id}", json={"is_archived": True}, headers=headers,
    )
    resume_resp = await client.patch(
        f"/base-budgets/{base_budget_id}", json={"is_archived": False}, headers=headers,
    )

    assert resume_resp.status_code == 200

    async with TestSession() as session:
        instances = (await session.execute(
            sa.select(Budget).where(Budget.base_budget_id == uuid.UUID(base_budget_id)),
        )).scalars().all()

    assert len(instances) == 1
    assert str(instances[0].id) == current_period_instance_id
    assert instances[0].overall_limit == 100000


async def test_unarchive_base_budget_without_prior_instances_creates_nothing(client):
    """Unarchiving a base budget that never had instances resumes nothing and does not error."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    await client.patch(
        f"/base-budgets/{base_budget_id}", json={"is_archived": True}, headers=headers,
    )
    resume_resp = await client.patch(
        f"/base-budgets/{base_budget_id}", json={"is_archived": False}, headers=headers,
    )

    assert resume_resp.status_code == 200
    assert resume_resp.json()["is_archived"] is False

    async with TestSession() as session:
        instances = (await session.execute(
            sa.select(Budget).where(Budget.base_budget_id == uuid.UUID(base_budget_id)),
        )).scalars().all()

    assert instances == []


async def test_unarchive_multi_unit_base_budget_resumes_phase_aligned_period(client, monkeypatch):
    """A quarterly budget resumes on a period phase-aligned to its series, skipping the gap

    Resumption steps forward in whole three-month periods from the newest instance so the
    resumed period stays on the same cadence phase rather than anchoring to a single month
    """
    base_budget_routes = importlib.import_module("app.routes.base_budgets.router")

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 12, 15, 16, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    monkeypatch.setattr(base_budget_routes, "datetime", FixedDateTime)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    # Quarterly cadence: monthly recurrence spanning three months per instance, dom kept <= 28
    create_resp = await _create_base_budget(client, headers, instance_length=3)
    base_budget_id = create_resp.json()["id"]

    # Two contiguous quarters with distinct caps so the carried cap proves it took the newest
    await _create_budget_instance(
        client, headers, base_budget_id, period_start="2026-01-01", overall_limit=80000,
    )
    await _create_budget_instance(
        client, headers, base_budget_id, period_start="2026-04-01", overall_limit=120000,
    )

    await client.patch(
        f"/base-budgets/{base_budget_id}", json={"is_archived": True}, headers=headers,
    )
    resume_resp = await client.patch(
        f"/base-budgets/{base_budget_id}", json={"is_archived": False}, headers=headers,
    )

    assert resume_resp.status_code == 200

    async with TestSession() as session:
        instances = (await session.execute(
            sa.select(Budget)
            .where(Budget.base_budget_id == uuid.UUID(base_budget_id))
            .order_by(Budget.period_start),
        )).scalars().all()

    # Exactly one Q4 instance is added at the newest cap while the intermediate Q3 gap stays unfilled
    assert [
        (budget.period_start.isoformat(), budget.period_end.isoformat(), budget.overall_limit)
        for budget in instances
    ] == [
        ("2026-01-01", "2026-03-31", 80000),
        ("2026-04-01", "2026-06-30", 120000),
        ("2026-10-01", "2026-12-31", 120000),
    ]

    # The resumed start advances the newest phase origin by a whole multiple of the three-month cadence
    newest_period_start = date(2026, 4, 1)
    resumed = instances[-1]
    months_advanced = (
        (resumed.period_start.year - newest_period_start.year) * 12
        + resumed.period_start.month - newest_period_start.month
    )
    assert months_advanced % 3 == 0
    assert resumed.period_start.day == newest_period_start.day
    assert resumed.period_start <= date(2026, 12, 15) <= resumed.period_end


# --- PATCH /base-budgets/{base_budget_id} — archived edit guard ---


async def test_update_archived_base_budget_name_returns_409(client):
    """Renaming an archived base budget is rejected so historical periods stay frozen."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    await client.patch(
        f"/base-budgets/{base_budget_id}", json={"is_archived": True}, headers=headers,
    )
    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"name": "Renamed"},
        headers=headers,
    )

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Cannot edit an archived base budget"


async def test_update_archived_base_budget_category_ids_returns_409(client):
    """Changing tracked categories on an archived base budget is rejected the same as any other field."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    cat_id = await _create_category(client, headers)
    create_resp = await _create_base_budget(client, headers, category_ids=[cat_id])
    base_budget_id = create_resp.json()["id"]
    other_cat_id = await _create_category(client, headers, name="Test Takeout")

    await client.patch(
        f"/base-budgets/{base_budget_id}", json={"is_archived": True}, headers=headers,
    )
    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"category_ids": [other_cat_id]},
        headers=headers,
    )

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Cannot edit an archived base budget"


async def test_update_archived_base_budget_combined_unarchive_and_edit_returns_409(client):
    """Combining is_archived False with another field in the same patch is rejected

    The guard reads the stored archived state before the patch applies, so bundling an edit
    with the unarchive flag cannot use the unarchive to bypass the block
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    await client.patch(
        f"/base-budgets/{base_budget_id}", json={"is_archived": True}, headers=headers,
    )
    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"is_archived": False, "name": "Renamed"},
        headers=headers,
    )

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Cannot edit an archived base budget"


async def test_update_archived_base_budget_unarchive_only_returns_200(client):
    """An unarchive-only patch is not blocked by the archived-edit guard."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    await client.patch(
        f"/base-budgets/{base_budget_id}", json={"is_archived": True}, headers=headers,
    )
    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"is_archived": False},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["is_archived"] is False


async def test_update_non_archived_base_budget_name_returns_200(client):
    """The archived-edit guard does not fire when the base budget is not archived."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_base_budget(client, headers)
    base_budget_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/base-budgets/{base_budget_id}",
        json={"name": "Renamed"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"
