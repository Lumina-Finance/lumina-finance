"""Route tests for budget utilization endpoints."""


from tests.routes.budgets._utilization_helpers import (
    _create_base_with_instance,
    _create_category,
    _create_group,
    _create_second_user,
    _create_transaction,
    _grant_account_permission,
)
from tests.routes.support import _create_account, _create_user, _get_auth_header

# --- GET /budgets/{id}/utilization — metadata and edge cases ---


async def test_get_budget_utilization_with_one_week_period(client):
    """A one-week budget bounds aggregation to exactly 7 days."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    # Weekly budget: Mon Mar 2 → Sun Mar 8
    _, budget_id = await _create_base_with_instance(
        client, headers,
        category_ids=[groceries],
        base_overrides={"recurrence_freq": "weekly", "recurrence_weekday": 0, "recurrence_dom": None},
        instance_overrides={"period_start": "2026-03-02"},
    )

    # Inside the week (kept), day before (excluded), day after (excluded)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-05", amount=-5000)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-01", amount=-9999)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-09", amount=-9999)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 5000
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 5000


async def test_get_budget_utilization_echoes_overall_limit_when_set(client):
    """The budget's overall_limit is echoed in the response."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    _, budget_id = await _create_base_with_instance(
        client, headers, instance_overrides={"overall_limit": 200000},
    )

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    assert resp.json()["overall_limit"] == 200000


async def test_get_budget_utilization_includes_transactions_from_closed_accounts(client):
    """Closing an account does not retroactively erase its historical spend from a budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]
    groceries = await _create_category(client, headers)

    _, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    await _create_transaction(client, headers, account_id, groceries, amount=-5000)

    # Close the account after the transaction is recorded
    close_resp = await client.patch(
        f"/accounts/{account_id}",
        json={"closed_at": "2026-04-01"},
        headers=headers,
    )
    assert close_resp.status_code == 200
    # Verify the close actually took effect — if the field were renamed or the
    # PATCH became a no-op, this test would otherwise pass for the wrong reason.
    account_resp = await client.get(f"/accounts/{account_id}", headers=headers)
    assert account_resp.json()["closed_at"] is not None

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 5000
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 5000


async def test_get_budget_utilization_includes_transactions_created_by_other_group_members(client):
    """Transactions created by any group member count toward a group budget."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    account_resp = await _create_account(client, admin_headers, group_id=group_id, name="Joint")
    account_id = account_resp.json()["id"]
    # Group-scoped category so both admin and member can reference it
    groceries = await _create_category(client, admin_headers, group_id=group_id)

    _, budget_id = await _create_base_with_instance(
        client, admin_headers,
        category_ids=[groceries],
        base_overrides={"group_id": group_id},
    )

    # Add a second member with WRITE on the account so they can post a txn
    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )
    await _grant_account_permission(client, admin_headers, account_id, member_user_id, "write")

    # Admin posts one txn, member posts another — both should be counted
    await _create_transaction(client, admin_headers, account_id, groceries, amount=-3000)
    await _create_transaction(client, member_headers, account_id, groceries, amount=-2000)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=admin_headers)
    data = resp.json()
    assert data["total_spent"] == 5000
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 5000
