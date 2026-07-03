"""Route tests for budget utilization endpoints"""
import uuid
from datetime import date

import sqlalchemy as sa

from app.models.budget import BudgetTrackedCategory
from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.support import _get_auth_header

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"

async def _create_second_user(client):
    """Sign up a second user and return (auth_headers, user_id)"""
    resp = await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "SecurePassword123!",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    return _get_auth_header(resp), resp.json()["user"]["id"]

async def _create_group(client, headers):
    """Create a group and return its id"""
    resp = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    return resp.json()["id"]

async def _create_category(client, headers, **overrides):
    """Create an expense category and return its id"""
    payload = {"name": "Test Groceries", "kind": "expense", **overrides}
    resp = await client.post("/categories", json=payload, headers=headers)
    return resp.json()["id"]

async def _seed_usd_currency():
    """Insert the USD currency row for multi-currency tests"""
    async with TestSession() as session:

        # Insert USD as seeded currency data for budget currency conversion tests
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

async def _create_base_budget(client, headers, *, category_ids=None, **overrides):
    """Create a base budget via POST /base-budgets.

    Defaults: name="March Budget", currency="CAD", one freshly-created tracked
    category. The category's `added_at` is set from the user's local today — tests
    that care about period_end cutoff semantics should call this via
    `_create_base_with_instance` (which backdates added_at) or override it via
    `_set_tracked_category_timestamps`
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

async def _create_budget_instance(client, headers, base_budget_id, **overrides):
    """Create a budget instance via POST /base-budgets/{id}/budgets.

    Defaults: period_start=2026-03-01, overall_limit=100000. period_end is
    computed by the backend from the base's cadence
    """
    payload = {
        "period_start": "2026-03-01",
        "overall_limit": 100000,
        **overrides,
    }
    return await client.post(
        f"/base-budgets/{base_budget_id}/budgets", json=payload, headers=headers,
    )

async def _create_base_with_instance(
    client, headers, *, category_ids=None, base_overrides=None, instance_overrides=None,
):
    """Create a base budget and one instance. Returns (base_id, instance_id).

    Backdates every tracked category's `added_at` to 2000-01-01 so the common
    happy-path flow works with past periods (e.g. the default March 2026 period)
    regardless of when the test runs. Tests that exercise the period_end cutoff
    semantics should use `_create_base_budget` + `_create_budget_instance`
    directly and control `added_at`/`removed_at` via
    `_set_tracked_category_timestamps`
    """
    base_resp = await _create_base_budget(
        client, headers,
        category_ids=category_ids,
        **(base_overrides or {}),
    )
    base_id = base_resp.json()["id"]
    inst_resp = await _create_budget_instance(
        client, headers, base_id, **(instance_overrides or {}),
    )
    async with TestSession() as session:

        # Backdate active tracked categories so historical budget periods include them
        await session.execute(
            sa.update(BudgetTrackedCategory)
            .where(
                BudgetTrackedCategory.base_budget_id == uuid.UUID(base_id),
                BudgetTrackedCategory.removed_at.is_(None),
            )
            .values(added_at=date(2000, 1, 1)),
        )
        await session.commit()
    return base_id, inst_resp.json()["id"]

async def _create_transaction(client, headers, account_id, category_id, **overrides):
    """Create a transaction via POST /transactions"""
    payload = {
        "account_id": account_id,
        "category_id": category_id,
        "dt": "2026-03-15",
        "amount": -5000,
        "currency": "CAD",
        **overrides,
    }
    return await client.post("/transactions", json=payload, headers=headers)

async def _grant_base_budget_permission(client, admin_headers, base_budget_id, user_id, level):
    """Grant a group member a permission level on a group base budget"""
    return await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
        json={"user_id": user_id, "level": level},
        headers=admin_headers,
    )

async def _grant_account_permission(client, admin_headers, account_id, user_id, level):
    """Grant a group member a permission level on a group account"""
    return await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": user_id, "level": level},
        headers=admin_headers,
    )

async def _set_tracked_category_timestamps(base_budget_id, category_id, *, added_at=None, removed_at=None):
    """Directly patch a BudgetTrackedCategory row's added_at/removed_at.

    Needed for mid-period add/remove tests — the public API only sets these to
    `now()`, so scenarios with period-relative timing require direct DB edits.

    Only targets the currently-active row (`removed_at IS NULL`). Once a row
    has been soft-deleted, this helper cannot be used to adjust it — insert a
    new row or query the historical row directly if a test needs that
    """
    values = {}
    if added_at is not None:
        values["added_at"] = added_at
    if removed_at is not None:
        values["removed_at"] = removed_at
    async with TestSession() as session:

        # Patch the active tracked category row to model period-relative category changes
        await session.execute(
            sa.update(BudgetTrackedCategory)
            .where(
                BudgetTrackedCategory.base_budget_id == uuid.UUID(base_budget_id),
                BudgetTrackedCategory.category_id == uuid.UUID(category_id),
                BudgetTrackedCategory.removed_at.is_(None),
            )
            .values(**values),
        )
        await session.commit()
