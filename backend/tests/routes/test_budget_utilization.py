"""Route tests for GET /budgets/{id}/utilization."""
from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.conftest import _create_account, _create_user, _get_auth_header

# --- Helpers ---

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"


async def _create_second_user(client):
    """Sign up a second user and return (auth_headers, user_id)."""
    resp = await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "securepassword123",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    return _get_auth_header(resp), resp.json()["user"]["id"]


async def _create_group(client, headers):
    """Create a group and return its id."""
    resp = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    return resp.json()["id"]


async def _create_category(client, headers, **overrides):
    """Create an expense category and return its id."""
    payload = {"name": "Groceries", "kind": "expense", **overrides}
    resp = await client.post("/categories", json=payload, headers=headers)
    return resp.json()["id"]


async def _create_budget(client, headers, **overrides):
    """Create a budget via POST /budgets. Defaults to a March 2026 personal CAD budget with a 1000 CAD limit."""
    payload = {
        "name": "March Budget",
        "period_start": "2026-03-01",
        "period_end": "2026-03-31",
        "currency": "CAD",
        "overall_limit": 100000,
        **overrides,
    }
    return await client.post("/budgets", json=payload, headers=headers)


async def _create_transaction(client, headers, account_id, category_id, **overrides):
    """Create a transaction via POST /transactions."""
    payload = {
        "account_id": account_id,
        "category_id": category_id,
        "ts": "2026-03-15T12:00:00Z",
        "amount": -5000,
        "currency": "CAD",
        **overrides,
    }
    return await client.post("/transactions", json=payload, headers=headers)


async def _grant_budget_permission(client, admin_headers, budget_id, user_id, level):
    """Grant a group member a permission level on a group budget."""
    return await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": user_id, "level": level},
        headers=admin_headers,
    )


async def _grant_account_permission(client, admin_headers, account_id, user_id, level):
    """Grant a group member a permission level on a group account."""
    return await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": user_id, "level": level},
        headers=admin_headers,
    )


# --- GET /budgets/{id}/utilization — listing and aggregation ---


async def test_get_budget_utilization_returns_per_category_breakdown(client):
    """The endpoint returns the budget's metadata plus per-category spend totals."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers, name="Groceries")
    transit = await _create_category(client, headers, name="Transit")

    budget_resp = await _create_budget(
        client, headers,
        category_ids=[groceries, transit],
        overall_limit=100000,
    )
    budget_id = budget_resp.json()["id"]

    await _create_transaction(client, headers, account_id, groceries, amount=-5000)
    await _create_transaction(client, headers, account_id, transit, amount=-2500)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    assert resp.status_code == 200

    data = resp.json()
    assert data["budget_id"] == budget_id
    assert data["period_start"] == "2026-03-01"
    assert data["period_end"] == "2026-03-31"
    assert data["overall_limit"] == 100000
    assert data["total_spent"] == 7500

    by_id = {c["category_id"]: c["spent"] for c in data["categories"]}
    assert by_id[groceries] == 5000
    assert by_id[transit] == 2500
    assert len(data["categories"]) == 2


async def test_get_budget_utilization_includes_tracked_categories_with_zero_spend(client):
    """Tracked categories with no transactions in the period are returned with spent=0."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers, name="Groceries")
    transit = await _create_category(client, headers, name="Transit")

    budget_resp = await _create_budget(client, headers, category_ids=[groceries, transit])
    budget_id = budget_resp.json()["id"]

    # Only groceries has activity; transit has none
    await _create_transaction(client, headers, account_id, groceries, amount=-5000)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    by_id = {c["category_id"]: c["spent"] for c in data["categories"]}
    assert by_id[groceries] == 5000
    assert by_id[transit] == 0
    assert len(data["categories"]) == 2


async def test_get_budget_utilization_returns_empty_categories_for_budget_with_no_tracked_categories(client):
    """A budget with no tracked categories returns an empty list and zero total."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    budget_resp = await _create_budget(client, headers)
    budget_id = budget_resp.json()["id"]

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["categories"] == []
    assert data["total_spent"] == 0


async def test_get_budget_utilization_excludes_transactions_before_period_start(client):
    """Transactions dated before the budget's period_start are excluded."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    budget_resp = await _create_budget(client, headers, category_ids=[groceries])
    budget_id = budget_resp.json()["id"]

    # Inside the period (kept) and before (excluded)
    await _create_transaction(client, headers, account_id, groceries, ts="2026-03-15T12:00:00Z", amount=-5000)
    await _create_transaction(client, headers, account_id, groceries, ts="2026-02-28T23:00:00Z", amount=-9999)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 5000
    assert len(data["categories"]) == 1
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 5000


async def test_get_budget_utilization_excludes_transactions_after_period_end(client):
    """Transactions dated after the budget's period_end are excluded."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    budget_resp = await _create_budget(client, headers, category_ids=[groceries])
    budget_id = budget_resp.json()["id"]

    await _create_transaction(client, headers, account_id, groceries, ts="2026-03-15T12:00:00Z", amount=-5000)
    await _create_transaction(client, headers, account_id, groceries, ts="2026-04-01T01:00:00Z", amount=-9999)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 5000
    assert len(data["categories"]) == 1
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 5000


async def test_get_budget_utilization_includes_transaction_at_period_start_boundary(client):
    """A transaction whose UTC date equals period_start is included (inclusive bound)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    budget_resp = await _create_budget(client, headers, category_ids=[groceries])
    budget_id = budget_resp.json()["id"]

    # Midnight UTC of period_start — date bucket is exactly period_start
    await _create_transaction(client, headers, account_id, groceries, ts="2026-03-01T00:00:00Z", amount=-1000)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 1000
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 1000


async def test_get_budget_utilization_includes_transaction_at_period_end_boundary(client):
    """A transaction whose UTC date equals period_end is included (inclusive bound)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    budget_resp = await _create_budget(client, headers, category_ids=[groceries])
    budget_id = budget_resp.json()["id"]

    # 23:59 on period_end UTC — still on the period_end day
    await _create_transaction(client, headers, account_id, groceries, ts="2026-03-31T23:59:00Z", amount=-1000)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 1000
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 1000


async def test_get_budget_utilization_excludes_transactions_in_untracked_categories(client):
    """Transactions in categories the budget doesn't track are not counted."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    tracked = await _create_category(client, headers, name="Groceries")
    untracked = await _create_category(client, headers, name="Entertainment")

    budget_resp = await _create_budget(client, headers, category_ids=[tracked])
    budget_id = budget_resp.json()["id"]

    await _create_transaction(client, headers, account_id, tracked, amount=-5000)
    await _create_transaction(client, headers, account_id, untracked, amount=-9999)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 5000
    assert len(data["categories"]) == 1
    assert data["categories"][0]["category_id"] == tracked


async def test_get_budget_utilization_excludes_soft_deleted_tracked_categories(client):
    """Categories removed from the budget (removed_at IS NOT NULL) are not aggregated."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers, name="Groceries")
    transit = await _create_category(client, headers, name="Transit")

    budget_resp = await _create_budget(client, headers, category_ids=[groceries, transit])
    budget_id = budget_resp.json()["id"]

    await _create_transaction(client, headers, account_id, groceries, amount=-5000)
    await _create_transaction(client, headers, account_id, transit, amount=-2500)

    # Remove transit from the tracked set (soft-delete)
    await client.patch(
        f"/budgets/{budget_id}",
        json={"category_ids": [groceries]},
        headers=headers,
    )

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 5000
    assert len(data["categories"]) == 1
    returned_category_ids = {c["category_id"] for c in data["categories"]}
    assert groceries in returned_category_ids
    assert transit not in returned_category_ids
    # The 2500 from the transit txn must NOT bleed into total_spent
    assert data["categories"][0]["spent"] == 5000


# --- GET /budgets/{id}/utilization — aggregation behavior ---


async def test_get_budget_utilization_sums_multiple_transactions_in_same_category(client):
    """Multiple transactions in one category sum to a single spent total for that category."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    budget_resp = await _create_budget(client, headers, category_ids=[groceries])
    budget_id = budget_resp.json()["id"]

    await _create_transaction(client, headers, account_id, groceries, ts="2026-03-05T12:00:00Z", amount=-1000)
    await _create_transaction(client, headers, account_id, groceries, ts="2026-03-15T12:00:00Z", amount=-2000)
    await _create_transaction(client, headers, account_id, groceries, ts="2026-03-25T12:00:00Z", amount=-3000)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert len(data["categories"]) == 1
    assert data["categories"][0]["spent"] == 6000
    assert data["total_spent"] == 6000


async def test_get_budget_utilization_mixed_inflows_and_outflows_net_to_positive_spent(client):
    """An inflow (e.g. refund) in a tracked category reduces the net spent for that category."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    budget_resp = await _create_budget(client, headers, category_ids=[groceries])
    budget_id = budget_resp.json()["id"]

    # 5000 expense, 1500 refund — net spent is 3500
    await _create_transaction(client, headers, account_id, groceries, amount=-5000)
    await _create_transaction(client, headers, account_id, groceries, ts="2026-03-20T12:00:00Z", amount=1500)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert len(data["categories"]) == 1
    assert data["categories"][0]["spent"] == 3500
    assert data["total_spent"] == 3500


async def test_get_budget_utilization_net_inflow_returns_negative_spent(client):
    """If income exceeds outflow in a tracked category, spent is negative."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    side_income = await _create_category(client, headers, name="Side Income", kind="income")

    budget_resp = await _create_budget(client, headers, category_ids=[side_income])
    budget_id = budget_resp.json()["id"]

    await _create_transaction(client, headers, account_id, side_income, amount=10000)
    await _create_transaction(client, headers, account_id, side_income, ts="2026-03-20T12:00:00Z", amount=-2000)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    # Net is +8000 inflow → spent is -8000
    assert len(data["categories"]) == 1
    assert data["categories"][0]["spent"] == -8000
    assert data["total_spent"] == -8000


async def test_get_budget_utilization_total_spent_equals_sum_of_categories(client):
    """The top-level total_spent invariant holds across multiple categories with mixed signs."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers, name="Groceries")
    transit = await _create_category(client, headers, name="Transit")
    side = await _create_category(client, headers, name="Side Income", kind="income")

    budget_resp = await _create_budget(
        client, headers, category_ids=[groceries, transit, side],
    )
    budget_id = budget_resp.json()["id"]

    await _create_transaction(client, headers, account_id, groceries, amount=-5000)
    await _create_transaction(client, headers, account_id, transit, amount=-2500)
    await _create_transaction(client, headers, account_id, side, amount=3000)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    summed = sum(c["spent"] for c in data["categories"])
    assert data["total_spent"] == summed
    assert summed == 5000 + 2500 - 3000


# --- GET /budgets/{id}/utilization — metadata and edge cases ---


async def test_get_budget_utilization_with_single_day_period(client):
    """A single-day budget (period_start == period_end) bounds aggregation to that day only."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    budget_resp = await _create_budget(
        client, headers,
        category_ids=[groceries],
        period_start="2026-03-15",
        period_end="2026-03-15",
    )
    budget_id = budget_resp.json()["id"]

    # Inside the day (kept), day before (excluded), day after (excluded)
    await _create_transaction(client, headers, account_id, groceries, ts="2026-03-15T12:00:00Z", amount=-5000)
    await _create_transaction(client, headers, account_id, groceries, ts="2026-03-14T23:00:00Z", amount=-9999)
    await _create_transaction(client, headers, account_id, groceries, ts="2026-03-16T01:00:00Z", amount=-9999)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 5000
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 5000


async def test_get_budget_utilization_echoes_overall_limit_when_set(client):
    """The budget's overall_limit is echoed in the response when present."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    budget_resp = await _create_budget(client, headers, overall_limit=200000)
    budget_id = budget_resp.json()["id"]

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    assert resp.json()["overall_limit"] == 200000


async def test_get_budget_utilization_includes_transactions_from_closed_accounts(client):
    """Closing an account does not retroactively erase its historical spend from a budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]
    groceries = await _create_category(client, headers)

    budget_resp = await _create_budget(client, headers, category_ids=[groceries])
    budget_id = budget_resp.json()["id"]

    await _create_transaction(client, headers, account_id, groceries, amount=-5000)

    # Close the account after the transaction is recorded
    await client.patch(
        f"/accounts/{account_id}",
        json={"closed_at": "2026-04-01T00:00:00Z"},
        headers=headers,
    )

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

    budget_resp = await _create_budget(
        client, admin_headers,
        category_ids=[groceries],
        group_id=group_id,
    )
    budget_id = budget_resp.json()["id"]

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


# --- GET /budgets/{id}/utilization — auth and permissions ---


async def test_get_budget_utilization_unauthenticated_returns_401(client):
    """Anonymous requests are rejected before reaching the handler."""
    resp = await client.get(f"/budgets/{NONEXISTENT_ID}/utilization")
    assert resp.status_code == 401


async def test_get_budget_utilization_unknown_budget_returns_404(client):
    """A nonexistent budget UUID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/budgets/{NONEXISTENT_ID}/utilization", headers=headers)
    assert resp.status_code == 404


async def test_get_budget_utilization_other_users_personal_budget_returns_404(client):
    """A second user cannot access another user's personal budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    budget_resp = await _create_budget(client, headers)
    budget_id = budget_resp.json()["id"]

    other_headers, _ = await _create_second_user(client)
    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=other_headers)
    assert resp.status_code == 404


async def test_get_budget_utilization_personal_owner_can_read_own(client):
    """A personal budget owner can read its utilization."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    budget_resp = await _create_budget(client, headers)
    budget_id = budget_resp.json()["id"]

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["budget_id"] == budget_id


async def test_get_budget_utilization_group_admin_can_read_group_budget(client):
    """A group admin has implicit access to read group budget utilization."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    budget_resp = await _create_budget(client, admin_headers, group_id=group_id)
    budget_id = budget_resp.json()["id"]

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["budget_id"] == budget_id
    assert data["categories"] == []
    assert data["total_spent"] == 0


async def test_get_budget_utilization_group_member_with_read_permission_can_access(client):
    """A group member granted READ on the budget can read its utilization."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    budget_resp = await _create_budget(client, admin_headers, group_id=group_id)
    budget_id = budget_resp.json()["id"]

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )
    await _grant_budget_permission(client, admin_headers, budget_id, member_user_id, "read")

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=member_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["budget_id"] == budget_id
    assert data["categories"] == []
    assert data["total_spent"] == 0


async def test_get_budget_utilization_group_member_with_write_permission_can_read(client):
    """WRITE on a budget implies READ — utilization is accessible."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    budget_resp = await _create_budget(client, admin_headers, group_id=group_id)
    budget_id = budget_resp.json()["id"]

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )
    await _grant_budget_permission(client, admin_headers, budget_id, member_user_id, "write")

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=member_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["budget_id"] == budget_id
    assert data["categories"] == []
    assert data["total_spent"] == 0


async def test_get_budget_utilization_group_member_with_admin_permission_can_read(client):
    """ADMIN on a budget implies READ — locks in the WRITE < ADMIN ladder ordering."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    budget_resp = await _create_budget(client, admin_headers, group_id=group_id)
    budget_id = budget_resp.json()["id"]

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )
    await _grant_budget_permission(client, admin_headers, budget_id, member_user_id, "admin")

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=member_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["budget_id"] == budget_id
    assert data["categories"] == []
    assert data["total_spent"] == 0


async def test_get_budget_utilization_group_member_without_permission_returns_404(client):
    """A group member with no explicit permission on the budget gets 404."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    budget_resp = await _create_budget(client, admin_headers, group_id=group_id)
    budget_id = budget_resp.json()["id"]

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=member_headers)
    assert resp.status_code == 404


async def test_get_budget_utilization_non_group_user_returns_404(client):
    """A user who is not a member of the budget's group gets 404."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    budget_resp = await _create_budget(client, admin_headers, group_id=group_id)
    budget_id = budget_resp.json()["id"]

    other_headers, _ = await _create_second_user(client)
    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=other_headers)
    assert resp.status_code == 404


# --- GET /budgets/{id}/utilization — privacy guarantee ---


async def test_get_budget_utilization_returns_account_data_without_account_access(client):
    """READ on a budget grants utilization access without any account permission.

    A user with READ on the budget but NO access to the underlying account
    can still see aggregated category totals. This is the headline feature
    of the endpoint: privacy-respecting monitoring. A parent can verify "the
    kids stayed under their grocery budget" without getting access to
    individual transactions on the group account.
    """
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    account_resp = await _create_account(client, admin_headers, group_id=group_id, name="Joint")
    account_id = account_resp.json()["id"]
    # Group-scoped category — the conceptually correct pairing for a group budget
    groceries = await _create_category(client, admin_headers, group_id=group_id)

    budget_resp = await _create_budget(
        client, admin_headers,
        category_ids=[groceries],
        group_id=group_id,
    )
    budget_id = budget_resp.json()["id"]

    # Admin records spending on the group account
    await _create_transaction(client, admin_headers, account_id, groceries, amount=-5000)

    # Add a member, grant them READ on the BUDGET only — no account permission
    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )
    await _grant_budget_permission(client, admin_headers, budget_id, member_user_id, "read")

    # Verify the member CANNOT read the account directly
    direct_account_resp = await client.get(f"/accounts/{account_id}", headers=member_headers)
    assert direct_account_resp.status_code == 404

    # But CAN read the budget utilization, which surfaces the aggregate
    utilization_resp = await client.get(f"/budgets/{budget_id}/utilization", headers=member_headers)
    assert utilization_resp.status_code == 200
    data = utilization_resp.json()
    assert data["total_spent"] == 5000
    assert data["categories"][0]["spent"] == 5000


# --- GET /budgets/{id}/utilization — additional aggregation contracts ---


async def test_get_budget_utilization_aggregates_across_multiple_accounts_in_same_currency(client):
    """A category's spend sums across all accounts the user owns in that currency.

    The endpoint intentionally does not filter by account_id — only by category
    and date. This test locks in that contract: a regression that accidentally
    scoped the spend query to a single account would silently lose data.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    chequing_id = (await _create_account(client, headers, name="Chequing")).json()["id"]
    savings_id = (await _create_account(client, headers, name="Savings", account_type="savings")).json()["id"]
    groceries = await _create_category(client, headers)

    budget_resp = await _create_budget(client, headers, category_ids=[groceries])
    budget_id = budget_resp.json()["id"]

    await _create_transaction(client, headers, chequing_id, groceries, amount=-3000)
    await _create_transaction(client, headers, savings_id, groceries, ts="2026-03-20T12:00:00Z", amount=-2500)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 5500
    assert len(data["categories"]) == 1
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 5500


async def test_get_budget_utilization_with_zero_amount_transaction(client):
    """A transaction with amount=0 contributes zero to the category's spent total."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    budget_resp = await _create_budget(client, headers, category_ids=[groceries])
    budget_id = budget_resp.json()["id"]

    await _create_transaction(client, headers, account_id, groceries, amount=0)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 0
    assert len(data["categories"]) == 1
    assert data["categories"][0]["spent"] == 0


async def test_get_budget_utilization_documents_added_at_is_not_respected(client):
    """Transactions dated before a category was added to the budget still count.

    The `BudgetTrackedCategory.added_at` field exists for historical accuracy,
    but the current utilization query only filters by `removed_at IS NULL` —
    it does NOT filter by `added_at`. This documents that simplification so a
    future fix that respects added_at is loud (this test would fail).
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    # Transaction first — well before the category will be added to the budget
    await _create_transaction(client, headers, account_id, groceries, ts="2026-03-05T12:00:00Z", amount=-4000)

    # Then create the budget with the tracked category — added_at is "now"
    # (today, well after March 5), but the March 5 txn still counts
    budget_resp = await _create_budget(client, headers, category_ids=[groceries])
    budget_id = budget_resp.json()["id"]

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 4000
    assert data["categories"][0]["spent"] == 4000


# --- Currency and scope filtering ---


async def test_get_budget_utilization_excludes_transactions_on_different_currency_account(client):
    """A CAD budget must not aggregate transactions stored on a USD account.

    `Transaction.amount` is stored in the parent account's currency, so summing
    a USD-account transaction into a CAD budget would silently mix currencies.
    This test pins the fix that scopes the utilization query by `Account.currency`.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    cad_account_id = (await _create_account(client, headers)).json()["id"]
    usd_account_id = (
        await _create_account(client, headers, name="USD Chequing", currency="USD")
    ).json()["id"]
    groceries = await _create_category(client, headers, name="Groceries")

    budget_resp = await _create_budget(client, headers, category_ids=[groceries])
    budget_id = budget_resp.json()["id"]

    # Same tracked category, two accounts in different currencies — only the CAD
    # txn should appear in a CAD budget's utilization
    await _create_transaction(client, headers, cad_account_id, groceries, amount=-5000)
    await _create_transaction(client, headers, usd_account_id, groceries, amount=-3000)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_spent"] == 5000
    by_id = {c["category_id"]: c["spent"] for c in data["categories"]}
    assert by_id[groceries] == 5000


async def test_get_budget_utilization_non_base_currency_aggregates_only_matching_currency(client):
    """A non-base currency budget aggregates only same-currency account transactions.

    End-to-end happy path for the relaxed currency rule on POST /budgets — a
    CAD-base user can create a USD budget alongside their CAD one, and each
    aggregates spend only from accounts in the matching currency.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    cad_account_id = (await _create_account(client, headers)).json()["id"]
    usd_account_id = (
        await _create_account(client, headers, name="USD Chequing", currency="USD")
    ).json()["id"]
    groceries = await _create_category(client, headers, name="Groceries")

    usd_budget_resp = await _create_budget(
        client, headers, name="USD Groceries", currency="USD", category_ids=[groceries],
    )
    usd_budget_id = usd_budget_resp.json()["id"]

    # 4000 CAD on the CAD account, 7000 USD on the USD account — both in the same period
    await _create_transaction(client, headers, cad_account_id, groceries, amount=-4000)
    await _create_transaction(client, headers, usd_account_id, groceries, amount=-7000, currency="USD")

    resp = await client.get(f"/budgets/{usd_budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 7000
    assert data["categories"][0]["spent"] == 7000


async def test_get_budget_utilization_zero_when_no_account_matches_budget_currency(client):
    """A budget in a currency the user has no accounts in returns zero spent.

    Useful when a user is planning ahead — e.g., creating a USD vacation budget
    before they open the USD account. The endpoint should return tracked
    categories with zero spend rather than erroring.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

    # Only a CAD account exists, but the budget is in USD
    cad_account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers, name="Groceries")

    budget_resp = await _create_budget(
        client, headers, name="USD Vacation", currency="USD", category_ids=[groceries],
    )
    budget_id = budget_resp.json()["id"]

    # CAD spending exists but should be invisible to a USD budget
    await _create_transaction(client, headers, cad_account_id, groceries, amount=-5000)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 0
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 0


