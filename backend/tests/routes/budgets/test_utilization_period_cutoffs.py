"""Route tests for budget utilization endpoints."""
import uuid
from datetime import date

import sqlalchemy as sa

from app.models.budget import BudgetTrackedCategory
from tests.conftest import TestSession
from tests.routes.budgets._utilization_helpers import (
    _create_base_budget,
    _create_base_with_instance,
    _create_budget_instance,
    _create_category,
    _create_transaction,
    _set_tracked_category_timestamps,
)
from tests.routes.support import _create_account, _create_user, _get_auth_header

# --- GET /budgets/{id}/utilization — period_end cutoff semantics ---


async def test_get_budget_utilization_category_added_after_period_end_is_not_tracked(client):
    """A category whose added_at is after the instance's period_end is not tracked.

    Positive counterpart to the historical-accuracy guarantee: creating a base
    budget today and attaching it to a past instance does NOT retroactively pull
    that category into the past period. The predicate is `added_at <= period_end`,
    so a category added "now" (well after the past period_end) fails it entirely.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    # A transaction dated inside the would-be period
    await _create_transaction(client, headers, account_id, groceries, dt="2026-01-15", amount=-4000)

    # Create the base budget + past-period instance via low-level helpers so
    # added_at stays at the user's local today (well after Jan 31). The
    # high-level _create_base_with_instance helper backdates added_at, which
    # would mask the behavior under test.
    base_resp = await _create_base_budget(client, headers, category_ids=[groceries])
    base_id = base_resp.json()["id"]
    inst_resp = await _create_budget_instance(
        client, headers, base_id,
        period_start="2026-01-01",
    )
    budget_id = inst_resp.json()["id"]

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_spent"] == 0
    assert data["categories"] == []


async def test_get_budget_utilization_mid_period_category_addition_counts_whole_period_retroactively(client):
    """Mid-period category additions count transactions from the start of the period.

    Predicate is `added_at <= period_end`, not `added_at <= transaction_day`. So a
    category added on March 15 for a March 1-31 instance sweeps in transactions
    dated March 5 — the add applies to the whole period retroactively.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    # Force added_at to mid-period (Mar 15). Direct DB edit because the public
    # API sets added_at to the user's local today.
    await _set_tracked_category_timestamps(
        base_id, groceries, added_at=date(2026, 3, 15),
    )

    # One txn before added_at (Mar 5) and one after (Mar 20). Both should count.
    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-05", amount=-1000)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-20", amount=-2000)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 3000
    assert len(data["categories"]) == 1
    assert data["categories"][0]["spent"] == 3000


async def test_get_budget_utilization_mid_period_category_removal_excludes_whole_period(client):
    """Mid-period category removal excludes the whole period, not just post-removal spend.

    Predicate is `removed_at IS NULL OR removed_at > period_end`. If removed_at
    lands inside the period (strictly before period_end), the category fails the
    predicate entirely and ALL of its in-period spend is dropped — including
    transactions that predate the removal.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    # added_at before period_start, removed_at mid-period. Forces the removed branch.
    await _set_tracked_category_timestamps(
        base_id, groceries,
        added_at=date(2026, 2, 1),
        removed_at=date(2026, 3, 15),
    )

    # Both txns should be excluded — the one before removal AND the one after.
    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-05", amount=-1000)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-20", amount=-2000)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 0
    assert data["categories"] == []


async def test_get_budget_utilization_past_period_frozen_when_category_removed_today(client):
    """Removing a category today leaves a past period's utilization unchanged.

    When a user edits their base budget in April to remove a category, the
    January instance that already ended must not retroactively lose that
    category's spend. `removed_at` (April) > `period_end` (Jan 31), so the
    category still satisfies the predicate for the past period.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    base_id, budget_id = await _create_base_with_instance(
        client, headers,
        category_ids=[groceries],
        instance_overrides={"period_start": "2026-01-01"},
    )

    # Backdate added_at to before the past period so the base was "tracking"
    # groceries during January. Without this, added_at = today > Jan 31 and the
    # category would never enter the tracked set in the first place.
    await _set_tracked_category_timestamps(
        base_id, groceries, added_at=date(2025, 12, 1),
    )

    await _create_transaction(
        client, headers, account_id, groceries,
        dt="2026-01-15", amount=-5000,
    )

    # Remove groceries via PATCH. removed_at is set to the user's local today — well after Jan 31.
    new_cat = await _create_category(client, headers, name="Replacement")
    patch_resp = await client.patch(
        f"/base-budgets/{base_id}",
        json={"category_ids": [new_cat]},
        headers=headers,
    )
    assert patch_resp.status_code == 200

    # The January period still reports the old groceries spend because removed_at
    # > period_end. The replacement category's added_at is today > Jan 31, so it
    # is NOT in the tracked set for January.
    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 5000
    assert len(data["categories"]) == 1
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 5000


async def test_get_budget_utilization_past_period_frozen_when_category_added_today(client):
    """Adding a category today does not pull it into a past period's tracked set.

    The inverse of the removal-freeze test: a category added to the base budget
    in April (added_at = now) fails the `added_at <= period_end` predicate for
    a January instance, so it never appears in that period's response — even
    if there are January transactions in its category.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    original = await _create_category(client, headers, name="Original")
    addon = await _create_category(client, headers, name="Addon")

    base_id, budget_id = await _create_base_with_instance(
        client, headers,
        category_ids=[original],
        instance_overrides={"period_start": "2026-01-01"},
    )
    await _set_tracked_category_timestamps(
        base_id, original, added_at=date(2025, 12, 1),
    )

    # One txn in each category, both dated inside the January period
    await _create_transaction(client, headers, account_id, original, dt="2026-01-10", amount=-3000)
    await _create_transaction(client, headers, account_id, addon, dt="2026-01-20", amount=-7777)

    # PATCH the base today to start tracking `addon` — added_at is the user's local today, well after Jan 31.
    patch_resp = await client.patch(
        f"/base-budgets/{base_id}",
        json={"category_ids": [original, addon]},
        headers=headers,
    )
    assert patch_resp.status_code == 200

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    # Only `original` is in the tracked set for January; the `addon` 7777 must not appear
    assert data["total_spent"] == 3000
    assert len(data["categories"]) == 1
    assert data["categories"][0]["category_id"] == original
    assert data["categories"][0]["spent"] == 3000


async def test_get_budget_utilization_re_add_after_remove_single_counts(client):
    """Re-adding a category after removal does not double-count its transactions.

    The re-add pattern creates a second BudgetTrackedCategory row for the same
    (base_budget_id, category_id) pair — row 1 (removed), row 2 (active). The
    utilization query's DISTINCT + GROUP BY ensure the in-period spend is
    aggregated once per category, not once per historical row.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    base_id, budget_id = await _create_base_with_instance(
        client, headers,
        category_ids=[groceries],
        # Future period so both old and new rows have added_at/removed_at <= period_end
        instance_overrides={"period_start": "2099-01-01"},
    )

    # Remove, then re-add
    replacement = await _create_category(client, headers, name="Replacement")
    await client.patch(
        f"/base-budgets/{base_id}",
        json={"category_ids": [replacement]},
        headers=headers,
    )
    await client.patch(
        f"/base-budgets/{base_id}",
        json={"category_ids": [groceries, replacement]},
        headers=headers,
    )

    # Verify two historical rows exist for `groceries` — row 1 soft-deleted, row 2 active
    async with TestSession() as session:
        result = await session.execute(
            sa.select(BudgetTrackedCategory).where(
                BudgetTrackedCategory.base_budget_id == uuid.UUID(base_id),
                BudgetTrackedCategory.category_id == uuid.UUID(groceries),
            ),
        )
        rows = result.scalars().all()
    assert len(rows) == 2
    removed_count = sum(1 for r in rows if r.removed_at is not None)
    active_count = sum(1 for r in rows if r.removed_at is None)
    assert removed_count == 1
    assert active_count == 1

    await _create_transaction(
        client, headers, account_id, groceries,
        dt="2099-01-15", amount=-5000,
    )

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 5000
    # Single entry for groceries — not doubled
    groceries_entries = [c for c in data["categories"] if c["category_id"] == groceries]
    assert len(groceries_entries) == 1
    assert groceries_entries[0]["spent"] == 5000


async def test_get_budget_utilization_current_period_uses_currently_active_categories(client):
    """For a period_end in the future, the tracked set is exactly the currently active categories.

    Validates the "current period = currently active" reduction of the
    period_end cutoff predicate: added_at <= period_end is trivially true (now
    is before the future period_end), and removed_at IS NULL trivially wins.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers, name="Test Groceries")
    transit = await _create_category(client, headers, name="Transit")

    _, budget_id = await _create_base_with_instance(
        client, headers,
        category_ids=[groceries, transit],
        instance_overrides={"period_start": "2099-01-01"},
    )

    await _create_transaction(
        client, headers, account_id, groceries,
        dt="2099-01-10", amount=-4000,
    )
    await _create_transaction(
        client, headers, account_id, transit,
        dt="2099-01-20", amount=-1500,
    )

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 5500
    by_id = {c["category_id"]: c["spent"] for c in data["categories"]}
    assert by_id[groceries] == 4000
    assert by_id[transit] == 1500
    assert len(data["categories"]) == 2
