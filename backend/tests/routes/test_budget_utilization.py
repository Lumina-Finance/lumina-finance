"""Route tests for GET /budgets/{id}/utilization."""
import uuid
from datetime import date

import sqlalchemy as sa

from app.models.budget import BudgetTrackedCategory
from app.models.currency import Currency
from app.models.transaction import Transaction
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
    payload = {"name": "Test Groceries", "kind": "expense", **overrides}
    resp = await client.post("/categories", json=payload, headers=headers)
    return resp.json()["id"]


async def _seed_usd_currency():
    """Insert the USD currency row for multi-currency tests."""
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()


async def _create_base_budget(client, headers, *, category_ids=None, **overrides):
    """Create a base budget via POST /base-budgets.

    Defaults: name="March Budget", currency="CAD", one freshly-created tracked
    category. The category's `added_at` is set from the user's local today — tests
    that care about period_end cutoff semantics should call this via
    `_create_base_with_instance` (which backdates added_at) or override it via
    `_set_tracked_category_timestamps`.
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
    computed by the backend from the base's cadence.
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
    `_set_tracked_category_timestamps`.
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
    """Create a transaction via POST /transactions."""
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
    """Grant a group member a permission level on a group base budget."""
    return await client.post(
        f"/base-budgets/{base_budget_id}/permissions",
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


async def _set_tracked_category_timestamps(base_budget_id, category_id, *, added_at=None, removed_at=None):
    """Directly patch a BudgetTrackedCategory row's added_at/removed_at.

    Needed for mid-period add/remove tests — the public API only sets these to
    `now()`, so scenarios with period-relative timing require direct DB edits.

    Only targets the currently-active row (`removed_at IS NULL`). Once a row
    has been soft-deleted, this helper cannot be used to adjust it — insert a
    new row or query the historical row directly if a test needs that.
    """
    values = {}
    if added_at is not None:
        values["added_at"] = added_at
    if removed_at is not None:
        values["removed_at"] = removed_at
    async with TestSession() as session:
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


# --- GET /budgets/{id}/utilization — listing and aggregation ---


async def test_get_budget_utilization_returns_per_category_breakdown(client):
    """The endpoint returns the budget's metadata plus per-category spend totals."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers, name="Test Groceries")
    transit = await _create_category(client, headers, name="Transit")

    _, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries, transit],
    )

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
    groceries = await _create_category(client, headers, name="Test Groceries")
    transit = await _create_category(client, headers, name="Transit")

    _, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries, transit],
    )

    # Only groceries has activity; transit has none
    await _create_transaction(client, headers, account_id, groceries, amount=-5000)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    by_id = {c["category_id"]: c["spent"] for c in data["categories"]}
    assert by_id[groceries] == 5000
    assert by_id[transit] == 0
    assert len(data["categories"]) == 2


async def test_get_budget_utilization_returns_empty_categories_when_all_soft_deleted(client):
    """A budget whose only tracked category has been soft-deleted returns an empty list.

    Exercises the `if tracked_category_ids:` guard in the utilization query — if the
    tracked CTE returns zero rows the spend query is skipped entirely and categories
    comes back empty.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    groceries = await _create_category(client, headers)
    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )
    # Set removed_at well before period_start so the category is excluded from the period
    await _set_tracked_category_timestamps(
        base_id, groceries, removed_at=date(2026, 2, 1),
    )

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

    _, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    # Inside the period (kept) and before (excluded)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-15", amount=-5000)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-02-28", amount=-9999)

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

    _, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-15", amount=-5000)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-04-01", amount=-9999)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 5000
    assert len(data["categories"]) == 1
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 5000


async def test_get_budget_utilization_includes_transaction_at_period_start_boundary(client):
    """A transaction whose date equals period_start is included (inclusive bound)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    _, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-01", amount=-1000)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 1000
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 1000


async def test_get_budget_utilization_includes_transaction_at_period_end_boundary(client):
    """A transaction whose date equals period_end is included (inclusive bound)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    _, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-31", amount=-1000)

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
    tracked = await _create_category(client, headers, name="Test Groceries")
    untracked = await _create_category(client, headers, name="Test Entertainment")

    _, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[tracked],
    )

    await _create_transaction(client, headers, account_id, tracked, amount=-5000)
    await _create_transaction(client, headers, account_id, untracked, amount=-9999)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 5000
    assert len(data["categories"]) == 1
    assert data["categories"][0]["category_id"] == tracked


# --- GET /budgets/{id}/utilization — aggregation behavior ---


async def test_get_budget_utilization_sums_multiple_transactions_in_same_category(client):
    """Multiple transactions in one category sum to a single spent total for that category."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    _, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-05", amount=-1000)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-15", amount=-2000)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-25", amount=-3000)

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

    _, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    # 5000 expense, 1500 refund — net spent is 3500
    await _create_transaction(client, headers, account_id, groceries, amount=-5000)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-20", amount=1500)

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

    _, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[side_income],
    )

    await _create_transaction(client, headers, account_id, side_income, amount=10000)
    await _create_transaction(client, headers, account_id, side_income, dt="2026-03-20", amount=-2000)

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
    groceries = await _create_category(client, headers, name="Test Groceries")
    transit = await _create_category(client, headers, name="Transit")
    side = await _create_category(client, headers, name="Side Income", kind="income")

    _, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries, transit, side],
    )

    await _create_transaction(client, headers, account_id, groceries, amount=-5000)
    await _create_transaction(client, headers, account_id, transit, amount=-2500)
    await _create_transaction(client, headers, account_id, side, amount=3000)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    summed = sum(c["spent"] for c in data["categories"])
    assert data["total_spent"] == summed
    assert summed == 5000 + 2500 - 3000


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
    _, budget_id = await _create_base_with_instance(client, headers)

    other_headers, _ = await _create_second_user(client)
    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=other_headers)
    assert resp.status_code == 404


async def test_get_budget_utilization_personal_owner_can_read_own(client):
    """A personal budget owner can read its utilization."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    _, budget_id = await _create_base_with_instance(client, headers)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["budget_id"] == budget_id


async def test_get_budget_utilization_group_admin_can_read_group_budget(client):
    """A group admin has implicit access to read group budget utilization."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    groceries = await _create_category(client, admin_headers, group_id=group_id)
    _, budget_id = await _create_base_with_instance(
        client, admin_headers,
        category_ids=[groceries],
        base_overrides={"group_id": group_id},
    )

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["budget_id"] == budget_id
    assert len(data["categories"]) == 1
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 0
    assert data["total_spent"] == 0


async def test_get_budget_utilization_group_member_with_read_permission_can_access(client):
    """A group member granted READ on the base budget can read its utilization."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    groceries = await _create_category(client, admin_headers, group_id=group_id)
    base_id, budget_id = await _create_base_with_instance(
        client, admin_headers,
        category_ids=[groceries],
        base_overrides={"group_id": group_id},
    )

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )
    await _grant_base_budget_permission(client, admin_headers, base_id, member_user_id, "read")

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=member_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["budget_id"] == budget_id
    assert len(data["categories"]) == 1
    assert data["total_spent"] == 0


async def test_get_budget_utilization_group_member_with_write_permission_can_read(client):
    """WRITE on a base budget implies READ — utilization is accessible."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    groceries = await _create_category(client, admin_headers, group_id=group_id)
    base_id, budget_id = await _create_base_with_instance(
        client, admin_headers,
        category_ids=[groceries],
        base_overrides={"group_id": group_id},
    )

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )
    await _grant_base_budget_permission(client, admin_headers, base_id, member_user_id, "write")

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=member_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["budget_id"] == budget_id
    assert len(data["categories"]) == 1
    assert data["total_spent"] == 0


async def test_get_budget_utilization_group_member_with_admin_permission_can_read(client):
    """ADMIN on a base budget implies READ — locks in the WRITE < ADMIN ladder ordering."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    groceries = await _create_category(client, admin_headers, group_id=group_id)
    base_id, budget_id = await _create_base_with_instance(
        client, admin_headers,
        category_ids=[groceries],
        base_overrides={"group_id": group_id},
    )

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )
    await _grant_base_budget_permission(client, admin_headers, base_id, member_user_id, "admin")

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=member_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["budget_id"] == budget_id
    assert len(data["categories"]) == 1
    assert data["total_spent"] == 0


async def test_get_budget_utilization_group_member_without_permission_returns_404(client):
    """A group member with no explicit permission on the base budget gets 404."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    groceries = await _create_category(client, admin_headers, group_id=group_id)
    _, budget_id = await _create_base_with_instance(
        client, admin_headers,
        category_ids=[groceries],
        base_overrides={"group_id": group_id},
    )

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
    groceries = await _create_category(client, admin_headers, group_id=group_id)
    _, budget_id = await _create_base_with_instance(
        client, admin_headers,
        category_ids=[groceries],
        base_overrides={"group_id": group_id},
    )

    other_headers, _ = await _create_second_user(client)
    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=other_headers)
    assert resp.status_code == 404


# --- GET /budgets/{id}/utilization — privacy guarantee ---


async def test_get_budget_utilization_returns_account_data_without_account_access(client):
    """READ on a base budget grants utilization access without any account permission.

    A user with READ on the base budget but NO access to the underlying account
    can still see aggregated category totals. This is the headline feature of the
    endpoint: privacy-respecting monitoring. A parent can verify "the kids stayed
    under their grocery budget" without getting access to individual transactions
    on the group account.
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
    # rather than the base-budget READ grant under test.
    assert members_resp.json()["is_admin"] is False
    await _grant_base_budget_permission(client, admin_headers, base_id, member_user_id, "read")

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
    scoped the spend query to a single account would lose data.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    chequing_id = (await _create_account(client, headers, name="Chequing")).json()["id"]
    savings_id = (await _create_account(client, headers, name="Savings", account_type="savings")).json()["id"]
    groceries = await _create_category(client, headers)

    _, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    await _create_transaction(client, headers, chequing_id, groceries, amount=-3000)
    await _create_transaction(client, headers, savings_id, groceries, dt="2026-03-20", amount=-2500)

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

    _, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    # Assert the zero-amount txn was actually created — guards against a future
    # CHECK > 0 on Transaction.amount silently making this test pass for the
    # wrong reason (no txn created, no spend, zero total).
    create_resp = await _create_transaction(client, headers, account_id, groceries, amount=0)
    assert create_resp.status_code == 201

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 0
    assert len(data["categories"]) == 1
    assert data["categories"][0]["spent"] == 0


# --- GET /budgets/{id}/utilization — currency and scope filtering ---


async def test_get_budget_utilization_excludes_transactions_on_different_currency_account(client):
    """A CAD budget must not aggregate transactions stored on a USD account.

    `Transaction.amount` is stored in the parent account's currency, so summing
    a USD-account transaction into a CAD budget would mix currencies. This test
    pins the fix that scopes the utilization query by `Account.currency`.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _seed_usd_currency()

    cad_account_id = (await _create_account(client, headers)).json()["id"]
    usd_account_id = (
        await _create_account(client, headers, name="USD Chequing", currency="USD")
    ).json()["id"]
    groceries = await _create_category(client, headers, name="Test Groceries")

    _, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

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


async def test_get_budget_utilization_personal_budget_excludes_group_account_transactions(client):
    """A personal budget must not pick up transactions made on a group account.

    The transaction route allows a user's personal category to be used on a group
    account (an `OR` branch in `_check_category_access_or_422`), so without a
    scope filter a personal budget tracking that category would include group
    spending. The utilization query constrains accounts to those owned by the
    base budget's owner, blocking the leak.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    personal_account_id = (await _create_account(client, headers)).json()["id"]
    group_id = await _create_group(client, headers)
    group_account_id = (
        await _create_account(client, headers, name="Joint Chequing", group_id=group_id)
    ).json()["id"]

    # Personal category, used on both the personal account and the group account
    groceries = await _create_category(client, headers, name="Test Groceries")

    _, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    await _create_transaction(client, headers, personal_account_id, groceries, amount=-5000)
    await _create_transaction(client, headers, group_account_id, groceries, amount=-3000)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 5000
    by_id = {c["category_id"]: c["spent"] for c in data["categories"]}
    assert by_id[groceries] == 5000


async def test_get_budget_utilization_group_budget_excludes_personal_account_transactions(client):
    """The utilization query keeps personal-account spend out of a group budget even if upstream validators are bypassed.

    Two checks normally make this impossible to construct via the public API:
    `_validate_category_ids` rejects personal categories on group base budgets, and
    `_check_category_access_or_422` rejects group categories on personal-account
    txns. If either ever loosens — say, a future bulk-import endpoint skips the
    validators — the `Account.group_id == base_budget.group_id` filter on the
    utilization query is the backstop. This test bypasses both validators by
    inserting the row directly via TestSession and asserts the query still
    filters it out.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    user_id = uuid.UUID(signup_resp.json()["user"]["id"])

    group_id = await _create_group(client, headers)
    group_account_id = uuid.UUID(
        (await _create_account(client, headers, name="Joint", group_id=group_id)).json()["id"],
    )
    personal_account_id = uuid.UUID(
        (await _create_account(client, headers, name="Personal Chequing")).json()["id"],
    )
    group_groceries = uuid.UUID(
        await _create_category(client, headers, name="Test Groceries", group_id=group_id),
    )

    _, budget_id = await _create_base_with_instance(
        client, headers,
        category_ids=[str(group_groceries)],
        base_overrides={"group_id": group_id},
    )

    # Legitimate group account txn — should be counted
    await _create_transaction(
        client, headers, str(group_account_id), str(group_groceries), amount=-3000,
    )

    # Direct DB insert: personal-account txn referencing the group category.
    # Bypasses _check_category_access_or_422 which would normally block it.
    async with TestSession() as session:
        session.add(Transaction(
            created_by_user_id=user_id,
            account_id=personal_account_id,
            category_id=group_groceries,
            dt=date(2026, 3, 15),
            amount=-9999,
            currency="CAD",
        ))
        await session.commit()

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    # 3000 from the group account, NOT 12999 — the personal-account row is filtered out
    assert data["total_spent"] == 3000
    assert data["categories"][0]["spent"] == 3000


async def test_get_budget_utilization_non_base_currency_aggregates_only_matching_currency(client):
    """A non-base currency budget aggregates only same-currency account transactions.

    End-to-end happy path: a CAD-base user can create a USD base budget alongside
    their CAD one, and each aggregates spend only from accounts in the matching
    currency.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _seed_usd_currency()

    cad_account_id = (await _create_account(client, headers)).json()["id"]
    usd_account_id = (
        await _create_account(client, headers, name="USD Chequing", currency="USD")
    ).json()["id"]
    groceries = await _create_category(client, headers, name="Test Groceries")

    _, usd_budget_id = await _create_base_with_instance(
        client, headers,
        category_ids=[groceries],
        base_overrides={"name": "USD Groceries", "currency": "USD"},
    )

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
    await _seed_usd_currency()

    # Only a CAD account exists, but the budget is in USD
    cad_account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers, name="Test Groceries")

    _, budget_id = await _create_base_with_instance(
        client, headers,
        category_ids=[groceries],
        base_overrides={"name": "USD Vacation", "currency": "USD"},
    )

    # CAD spending exists but should be invisible to a USD budget
    await _create_transaction(client, headers, cad_account_id, groceries, amount=-5000)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    data = resp.json()
    assert data["total_spent"] == 0
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 0


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


# --- GET /budgets/{id}/utilization — day-boundary cutoffs ---


async def test_get_budget_utilization_added_at_equal_to_period_end_is_tracked(client):
    """A category whose added_at day equals period_end is still tracked.

    Pins the `added_at <= period_end` bound: same-day-as-period-end passes.
    A regression that flipped `<=` to `<` would exclude the category and make
    this test fail.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )
    # Pin added_at to period_end itself (2026-03-31)
    await _set_tracked_category_timestamps(
        base_id, groceries, added_at=date(2026, 3, 31),
    )

    await _create_transaction(
        client, headers, account_id, groceries,
        dt="2026-03-20", amount=-4000,
    )

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_spent"] == 4000
    assert len(data["categories"]) == 1
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 4000


async def test_get_budget_utilization_added_at_day_after_period_end_is_not_tracked(client):
    """A category whose added_at day is one day after period_end is excluded.

    Pins the other side of the `added_at <= period_end` bound: April 1 for
    a March 1-31 instance is excluded. A regression that flipped the direction
    of the comparison would include the row and make this test fail.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )
    # Pin added_at to the day after period_end
    await _set_tracked_category_timestamps(
        base_id, groceries, added_at=date(2026, 4, 1),
    )

    await _create_transaction(
        client, headers, account_id, groceries,
        dt="2026-03-20", amount=-4000,
    )

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_spent"] == 0
    assert data["categories"] == []


async def test_get_budget_utilization_removed_at_equal_to_period_end_is_not_tracked(client):
    """A category whose removed_at day equals period_end is excluded.

    Pins the strict `removed_at > period_end` bound: same-day-as-period-end
    fails the predicate. A regression that flipped `>` to `>=` would include
    the row and make this test fail.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )
    # added_at well before period, removed_at on period_end itself
    await _set_tracked_category_timestamps(
        base_id, groceries,
        added_at=date(2026, 2, 1),
        removed_at=date(2026, 3, 31),
    )

    await _create_transaction(
        client, headers, account_id, groceries,
        dt="2026-03-15", amount=-4000,
    )

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_spent"] == 0
    assert data["categories"] == []


async def test_get_budget_utilization_removed_at_day_after_period_end_is_tracked(client):
    """A category whose removed_at day is one day after period_end stays tracked.

    Pins the other side of `removed_at > period_end`: April 1 for a March
    1-31 instance still counts. A regression that flipped the comparison would
    exclude the row and make this test fail.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )
    await _set_tracked_category_timestamps(
        base_id, groceries,
        added_at=date(2026, 2, 1),
        removed_at=date(2026, 4, 1),
    )

    await _create_transaction(
        client, headers, account_id, groceries,
        dt="2026-03-15", amount=-4000,
    )

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_spent"] == 4000
    assert len(data["categories"]) == 1
    assert data["categories"][0]["spent"] == 4000


# --- GET /budgets/{id}/utilization — more period_end cutoff scenarios ---


async def test_get_budget_utilization_re_add_past_period_old_row_included_new_row_excluded(client):
    """For a past period whose period_end falls between removed_at and the re-add, the old row is what counts.

    Stronger re-add check than the future-period test: here we use a past
    period whose `period_end` lies strictly between Row 1's `removed_at` and
    Row 2's `added_at`. Row 1 satisfies the predicate (removed_at > period_end),
    Row 2 does not (added_at > period_end). The tracked CTE returns just Row 1,
    so in-period spend still counts via the historical row.
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

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_spent"] == 4000
    # Single entry — DISTINCT would collapse even if both rows satisfied
    assert len(data["categories"]) == 1
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 4000


async def test_get_budget_utilization_mixed_active_and_removed_categories_in_same_period(client):
    """With one tracked category active and another removed mid-period, only the active one appears.

    Positive control for the mid-period removal test: distinguishes "removed
    during period" from "never tracked". The active category must show up with
    its spend; the removed one must be absent entirely.
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

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_spent"] == 5000
    assert len(data["categories"]) == 1
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 5000
    # Transit is fully absent from the response
    returned_ids = {c["category_id"] for c in data["categories"]}
    assert transit not in returned_ids


# --- GET /budgets/{id}/utilization — more scope and currency coverage ---


async def test_get_budget_utilization_personal_budget_excludes_single_member_group_account(client):
    """A personal budget excludes spending on a group account the user solely owns.

    Even when the user is the only admin of their own single-member group, the
    group account's transactions must stay out of a personal base budget. Pins
    the personal scope filter `Account.owner_id = base_budget.owner_id` — the
    group account has `owner_id IS NULL`, so it cannot match.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    personal_account_id = (await _create_account(client, headers)).json()["id"]
    group_id = await _create_group(client, headers)
    group_account_id = (
        await _create_account(client, headers, name="Joint", group_id=group_id)
    ).json()["id"]

    groceries = await _create_category(client, headers, name="Test Groceries")

    _, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    await _create_transaction(client, headers, personal_account_id, groceries, amount=-5000)
    await _create_transaction(client, headers, group_account_id, groceries, amount=-3000)

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    # Only the 5000 from the personal account — the 3000 on the group account is excluded
    assert data["total_spent"] == 5000
    assert data["categories"][0]["spent"] == 5000


async def test_get_budget_utilization_personal_budget_aggregates_multiple_personal_accounts_excludes_group(client):
    """A personal budget sums across all personal accounts in the currency but excludes a group account.

    Strengthens the single-account scope test: with two personal CAD accounts
    and one group CAD account all tracking the same category, the response
    must sum the two personal-account spends and exclude the group-account
    spend entirely. A regression that keyed the filter off a single account
    (rather than `owner_id == base_budget.owner_id`) would fail this.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    chequing_id = (await _create_account(client, headers, name="Chequing")).json()["id"]
    savings_id = (
        await _create_account(client, headers, name="Savings", account_type="savings")
    ).json()["id"]
    group_id = await _create_group(client, headers)
    group_account_id = (
        await _create_account(client, headers, name="Joint", group_id=group_id)
    ).json()["id"]

    groceries = await _create_category(client, headers, name="Test Groceries")

    _, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    await _create_transaction(client, headers, chequing_id, groceries, amount=-3000)
    await _create_transaction(
        client, headers, savings_id, groceries,
        dt="2026-03-20", amount=-2500,
    )
    # Group-account spend must not leak in
    await _create_transaction(
        client, headers, group_account_id, groceries,
        dt="2026-03-22", amount=-9999,
    )

    resp = await client.get(f"/budgets/{budget_id}/utilization", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_spent"] == 5500
    assert len(data["categories"]) == 1
    assert data["categories"][0]["spent"] == 5500


async def test_get_budget_utilization_three_currency_user_filters_to_budget_currency(client):
    """With accounts in three currencies, the budget aggregates only its own currency.

    Locks in that the currency filter is exact-match, not "match if any" or
    "prefer the user's base currency". A USD budget must see only USD-account
    spend even when CAD and EUR accounts also hold matching-category
    transactions.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    await _seed_usd_currency()
    async with TestSession() as session:
        session.add(Currency(id="EUR", name="Euro", symbol="€", minor_unit_exponent=2))
        await session.commit()

    cad_account_id = (await _create_account(client, headers)).json()["id"]
    usd_account_id = (
        await _create_account(client, headers, name="USD Chequing", currency="USD")
    ).json()["id"]
    eur_account_id = (
        await _create_account(client, headers, name="EUR Chequing", currency="EUR")
    ).json()["id"]
    groceries = await _create_category(client, headers, name="Test Groceries")

    _, usd_budget_id = await _create_base_with_instance(
        client, headers,
        category_ids=[groceries],
        base_overrides={"name": "USD Budget", "currency": "USD"},
    )

    await _create_transaction(client, headers, cad_account_id, groceries, amount=-4000)
    await _create_transaction(
        client, headers, usd_account_id, groceries,
        amount=-7000, currency="USD",
    )
    await _create_transaction(
        client, headers, eur_account_id, groceries,
        dt="2026-03-20", amount=-3500, currency="EUR",
    )

    resp = await client.get(f"/budgets/{usd_budget_id}/utilization", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    # Only the USD spend — CAD and EUR are filtered out
    assert data["total_spent"] == 7000
    assert data["categories"][0]["spent"] == 7000


# --- GET /budgets/{id}/utilization — path parameter validation ---


async def test_get_budget_utilization_invalid_uuid_returns_422(client):
    """A path parameter that isn't a valid UUID is rejected by FastAPI's parser.

    Pins that malformed IDs never reach the handler — a future schema change
    (e.g., accepting a short ID form) would have to deliberately override this.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/budgets/not-a-uuid/utilization", headers=headers)
    assert resp.status_code == 422
