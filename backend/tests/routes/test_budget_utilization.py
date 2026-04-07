"""Route tests for GET /budgets/{id}/utilization."""
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


async def _create_household(client, headers):
    """Create a household and return its id."""
    resp = await client.post("/households", json={"name": "Smith Family"}, headers=headers)
    return resp.json()["id"]


async def _create_category(client, headers, **overrides):
    """Create an expense category and return its id."""
    payload = {"name": "Groceries", "kind": "expense", **overrides}
    resp = await client.post("/categories", json=payload, headers=headers)
    return resp.json()["id"]


async def _create_budget(client, headers, **overrides):
    """Create a budget via POST /budgets. Defaults to a March 2026 personal CAD budget."""
    payload = {
        "name": "March Budget",
        "period_start": "2026-03-01",
        "period_end": "2026-03-31",
        "currency": "CAD",
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
    """Grant a household member a permission level on a household budget."""
    return await client.post(
        f"/budgets/{budget_id}/permissions",
        json={"user_id": user_id, "level": level},
        headers=admin_headers,
    )


async def _grant_account_permission(client, admin_headers, account_id, user_id, level):
    """Grant a household member a permission level on a household account."""
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


async def test_get_budget_utilization_with_two_day_period(client):
    """A two-day budget window bounds aggregation inclusively on both sides."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    # Note: budget validation currently rejects period_start == period_end
    # (uses `>=` rather than `>`), so two days is the smallest testable window.
    budget_resp = await _create_budget(
        client, headers,
        category_ids=[groceries],
        period_start="2026-03-15",
        period_end="2026-03-16",
    )
    budget_id = budget_resp.json()["id"]

    # Inside the window (both kept), day before (excluded), day after (excluded)
    await _create_transaction(client, headers, account_id, groceries, ts="2026-03-15T12:00:00Z", amount=-3000)
    await _create_transaction(client, headers, account_id, groceries, ts="2026-03-16T12:00:00Z", amount=-2000)
    await _create_transaction(client, headers, account_id, groceries, ts="2026-03-14T23:00:00Z", amount=-9999)
    await _create_transaction(client, headers, account_id, groceries, ts="2026-03-17T01:00:00Z", amount=-9999)

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


async def test_get_budget_utilization_echoes_null_overall_limit(client):
    """A budget without an overall_limit returns null in the response."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    budget_resp = await _create_budget(client, headers)
    budget_id = budget_resp.json()["id"]

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    assert resp.json()["overall_limit"] is None


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


async def test_get_budget_utilization_includes_transactions_created_by_other_household_members(client):
    """Transactions created by any household member count toward a household budget."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    household_id = await _create_household(client, admin_headers)
    account_resp = await _create_account(client, admin_headers, household_id=household_id, name="Joint")
    account_id = account_resp.json()["id"]
    # Household-scoped category so both admin and member can reference it
    groceries = await _create_category(client, admin_headers, household_id=household_id)

    budget_resp = await _create_budget(
        client, admin_headers,
        category_ids=[groceries],
        household_id=household_id,
    )
    budget_id = budget_resp.json()["id"]

    # Add a second member with WRITE on the account so they can post a txn
    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/households/{household_id}/members",
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


async def test_get_budget_utilization_household_admin_can_read_household_budget(client):
    """A household admin has implicit access to read household budget utilization."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    household_id = await _create_household(client, admin_headers)
    budget_resp = await _create_budget(client, admin_headers, household_id=household_id)
    budget_id = budget_resp.json()["id"]

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["budget_id"] == budget_id
    assert data["categories"] == []
    assert data["total_spent"] == 0


async def test_get_budget_utilization_household_member_with_read_permission_can_access(client):
    """A household member granted READ on the budget can read its utilization."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    household_id = await _create_household(client, admin_headers)
    budget_resp = await _create_budget(client, admin_headers, household_id=household_id)
    budget_id = budget_resp.json()["id"]

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/households/{household_id}/members",
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


async def test_get_budget_utilization_household_member_with_write_permission_can_read(client):
    """WRITE on a budget implies READ — utilization is accessible."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    household_id = await _create_household(client, admin_headers)
    budget_resp = await _create_budget(client, admin_headers, household_id=household_id)
    budget_id = budget_resp.json()["id"]

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/households/{household_id}/members",
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


async def test_get_budget_utilization_household_member_with_admin_permission_can_read(client):
    """ADMIN on a budget implies READ — locks in the WRITE < ADMIN ladder ordering."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    household_id = await _create_household(client, admin_headers)
    budget_resp = await _create_budget(client, admin_headers, household_id=household_id)
    budget_id = budget_resp.json()["id"]

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/households/{household_id}/members",
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


async def test_get_budget_utilization_household_member_without_permission_returns_404(client):
    """A household member with no explicit permission on the budget gets 404."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    household_id = await _create_household(client, admin_headers)
    budget_resp = await _create_budget(client, admin_headers, household_id=household_id)
    budget_id = budget_resp.json()["id"]

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/households/{household_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=member_headers)
    assert resp.status_code == 404


async def test_get_budget_utilization_non_household_user_returns_404(client):
    """A user who is not a member of the budget's household gets 404."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    household_id = await _create_household(client, admin_headers)
    budget_resp = await _create_budget(client, admin_headers, household_id=household_id)
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
    individual transactions on the household account.
    """
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    household_id = await _create_household(client, admin_headers)
    account_resp = await _create_account(client, admin_headers, household_id=household_id, name="Joint")
    account_id = account_resp.json()["id"]
    # Household-scoped category — the conceptually correct pairing for a household budget
    groceries = await _create_category(client, admin_headers, household_id=household_id)

    budget_resp = await _create_budget(
        client, admin_headers,
        category_ids=[groceries],
        household_id=household_id,
    )
    budget_id = budget_resp.json()["id"]

    # Admin records spending on the household account
    await _create_transaction(client, admin_headers, account_id, groceries, amount=-5000)

    # Add a member, grant them READ on the BUDGET only — no account permission
    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/households/{household_id}/members",
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
