"""Route tests for budget utilization endpoints."""

from datetime import UTC, datetime

import app.services.budgets.utilization.query_helpers as utilization_queries
from tests.routes.budgets._utilization_helpers import (
    _create_base_with_instance,
    _create_category,
    _create_group,
    _create_second_user,
    _create_transaction,
    _get_budget_utilization_entry,
    _grant_base_budget_permission,
)
from tests.routes.support import _create_account, _create_user, _get_auth_header

# --- GET /base-budgets/{id}/utilizations — privacy guarantee ---


async def test_get_budget_utilization_returns_account_data_without_account_access(client):
    """READ on a base budget grants utilization access without any account permission

    A user with READ on the base budget but NO access to the underlying account
    can still see aggregated category totals. This is the headline feature of the
    endpoint: privacy-respecting monitoring. A parent can verify "the kids stayed
    under their grocery budget" without getting access to individual transactions
    on the group account
    """
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    account_resp = await _create_account(client, admin_headers, group_id=group_id, name="Joint")
    account_id = account_resp.json()["id"]
    # Group-scoped category — the conceptually correct pairing for a group base budget
    groceries = await _create_category(client, admin_headers, group_id=group_id)

    base_id, budget_id = await _create_base_with_instance(
        client, admin_headers,
        category_ids=[groceries],
        base_overrides={"group_id": group_id},
    )

    # Admin records spending on the group account
    await _create_transaction(client, admin_headers, account_id, groceries, amount=-5000)

    # Add a member as non-admin, grant them READ on the BASE BUDGET only — no account permission
    member_headers, member_user_id = await _create_second_user(client)
    members_resp = await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )
    assert members_resp.status_code == 201
    # Lock in that the member is NOT a group admin — a regression that defaulted
    # new members to admin would let this test pass via implicit admin access
    # rather than the base-budget READ grant under test
    assert members_resp.json()["is_admin"] is False
    await _grant_base_budget_permission(client, admin_headers, base_id, member_user_id, "read")

    # Verify the member CANNOT read the account directly
    direct_account_resp = await client.get(f"/accounts/{account_id}", headers=member_headers)
    assert direct_account_resp.status_code == 404

    # But CAN read the budget utilization, which surfaces the aggregate
    data = await _get_budget_utilization_entry(client, member_headers, base_id, budget_id)
    assert data["total_spent"] == 5000
    assert data["categories"][0]["spent"] == 5000


async def test_group_budget_spend_uses_owner_date_for_other_viewers(client, monkeypatch):
    """A Toronto reader sees the Tokyo owner's current-day spend, never tomorrow's."""
    signup_resp = await _create_user(client)
    owner_headers = _get_auth_header(signup_resp)
    assert (await client.patch("/me", json={"tz": "Asia/Tokyo"}, headers=owner_headers)).status_code == 200

    group_id = await _create_group(client, owner_headers)
    account_id = (await _create_account(client, owner_headers, group_id=group_id)).json()["id"]
    groceries = await _create_category(client, owner_headers, group_id=group_id)
    base_id, budget_id = await _create_base_with_instance(
        client, owner_headers, category_ids=[groceries], base_overrides={"group_id": group_id},
    )
    await _create_transaction(client, owner_headers, account_id, groceries, dt="2026-03-07", amount=-1000)
    await _create_transaction(client, owner_headers, account_id, groceries, dt="2026-03-08", amount=-2000)
    await _create_transaction(client, owner_headers, account_id, groceries, dt="2026-03-09", amount=-4000)

    member_headers, member_id = await _create_second_user(client)
    assert (await client.post(
        f"/groups/{group_id}/members", json={"user_id": member_id}, headers=owner_headers,
    )).status_code == 201
    await _grant_base_budget_permission(client, owner_headers, base_id, member_id, "read")

    class FixedDateTime:
        @staticmethod
        def now(tz=None):
            instant = datetime(2026, 3, 7, 16, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    monkeypatch.setattr(utilization_queries, "datetime", FixedDateTime)
    data = await _get_budget_utilization_entry(client, member_headers, base_id, budget_id)
    assert data["total_spent"] == 3000
