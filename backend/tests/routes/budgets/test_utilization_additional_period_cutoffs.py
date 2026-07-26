"""Route tests for budget utilization endpoints."""
import uuid
from datetime import date

from app.models.budget import BudgetTrackedCategory
from tests.conftest import TestSession
from tests.routes.budgets._utilization_helpers import (
    _create_base_budget,
    _create_base_with_instance,
    _create_budget_instance,
    _create_category,
    _create_transaction,
    _get_budget_utilization_entry,
    _set_tracked_category_timestamps,
)
from tests.routes.support import _create_account, _create_user, _get_auth_header

# --- GET /base-budgets/{id}/utilizations — more period_end cutoff scenarios ---


async def test_get_budget_utilization_re_add_past_period_old_row_included_new_row_excluded(client):
    """For a past period whose period_end falls between removed_at and the re-add, the old row is what counts

    Stronger re-add check than the future-period test: here we use a past
    period whose `period_end` lies strictly between Row 1's `removed_at` and
    Row 2's `added_at`. Row 1 satisfies the predicate (removed_at > period_end),
    Row 2 does not (added_at > period_end). The tracked CTE returns just Row 1,
    so in-period spend still counts via the historical row
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    # Past period in January
    base_resp = await _create_base_budget(client, headers, category_ids=[groceries])
    base_id = base_resp.json()["id"]
    inst_resp = await _create_budget_instance(
        client, headers, base_id,
        period_start="2026-01-01",
    )
    budget_id = inst_resp.json()["id"]

    # Row 1: added Dec 2025, removed Feb 2026 (> period_end Jan 31)
    await _set_tracked_category_timestamps(
        base_id, groceries,
        added_at=date(2025, 12, 1),
        removed_at=date(2026, 2, 15),
    )
    # Row 2: inserted directly with added_at in March — AFTER period_end, BEFORE "now"
    async with TestSession() as session:
        session.add(BudgetTrackedCategory(
            base_budget_id=uuid.UUID(base_id),
            category_id=uuid.UUID(groceries),
            added_at=date(2026, 3, 1),
        ))
        await session.commit()

    await _create_transaction(
        client, headers, account_id, groceries,
        dt="2026-01-15", amount=-4000,
    )

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    assert data["total_spent"] == 4000
    # Single entry — DISTINCT would collapse even if both rows satisfied
    assert len(data["categories"]) == 1
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 4000


async def test_get_budget_utilization_mixed_active_and_removed_categories_in_same_period(client):
    """With one tracked category active and another removed mid-period, only the active one appears

    Positive control for the mid-period removal test: distinguishes "removed
    during period" from "never tracked". The active category must show up with
    its spend; the removed one must be absent entirely
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers, name="Test Groceries")
    transit = await _create_category(client, headers, name="Transit")

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries, transit],
    )
    # Transit removed mid-period, groceries stays active
    await _set_tracked_category_timestamps(
        base_id, transit,
        added_at=date(2026, 2, 1),
        removed_at=date(2026, 3, 15),
    )

    # Spend in both — only groceries should appear in the response
    await _create_transaction(client, headers, account_id, groceries, amount=-5000)
    await _create_transaction(
        client, headers, account_id, transit,
        dt="2026-03-05", amount=-2500,
    )

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    assert data["total_spent"] == 5000
    assert len(data["categories"]) == 1
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 5000
    # Transit is fully absent from the response
    returned_ids = {c["category_id"] for c in data["categories"]}
    assert transit not in returned_ids
