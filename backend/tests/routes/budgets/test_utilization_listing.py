"""Route tests for budget utilization endpoints."""
import importlib
from datetime import UTC, date, datetime

from tests.routes.budgets._utilization_helpers import (
    _create_base_budget,
    _create_base_with_instance,
    _create_budget_instance,
    _create_category,
    _create_second_user,
    _create_transaction,
    _get_base_budget_utilizations,
    _get_budget_utilization_entry,
    _set_tracked_category_timestamps,
)
from tests.routes.support import _create_account, _create_user, _get_auth_header

# --- GET /base-budgets/{id}/utilizations — listing and aggregation ---


async def test_list_latest_budget_utilizations_returns_latest_period_only(client):
    """The latest-utilizations endpoint returns one utilization row per base budget."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    base_id, old_budget_id = await _create_base_with_instance(
        client,
        headers,
        category_ids=[groceries],
        instance_overrides={"period_start": "2026-02-01", "overall_limit": 80000},
    )
    latest_resp = await _create_budget_instance(
        client,
        headers,
        base_id,
        period_start="2026-03-01",
        overall_limit=100000,
    )
    latest_budget_id = latest_resp.json()["id"]

    await _create_transaction(client, headers, account_id, groceries, dt="2026-02-15", amount=-9000)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-15", amount=-5000)

    resp = await client.get("/budgets/latest-utilizations", headers=headers)
    assert resp.status_code == 200

    data = resp.json()
    assert [item["budget_id"] for item in data] == [latest_budget_id]
    assert old_budget_id not in {item["budget_id"] for item in data}
    assert data[0]["base_budget_id"] == base_id
    assert data[0]["name"] == "March Budget"
    assert data[0]["currency"] == "CAD"
    assert data[0]["total_spent"] == 5000
    assert data[0]["overall_limit"] == 100000
    assert data[0]["fx_status"] == {"state": "none", "missing_pairs": []}


async def test_list_latest_budget_utilizations_includes_archived_base(client):
    """Archiving a base budget keeps its latest instance in the utilization roll-up."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )
    await _create_transaction(client, headers, account_id, groceries, amount=-5000)

    await client.patch(
        f"/base-budgets/{base_id}", json={"is_archived": True}, headers=headers,
    )

    resp = await client.get("/budgets/latest-utilizations", headers=headers)
    assert resp.status_code == 200

    data = resp.json()
    assert [item["budget_id"] for item in data] == [budget_id]
    assert data[0]["base_budget_id"] == base_id
    assert data[0]["total_spent"] == 5000


async def test_list_latest_budget_utilizations_excludes_inaccessible_budgets(client):
    """Only budgets readable by the caller are included."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    other_headers, _ = await _create_second_user(client)

    account_id = (await _create_account(client, headers)).json()["id"]
    other_account_id = (await _create_account(client, other_headers)).json()["id"]
    groceries = await _create_category(client, headers)
    other_groceries = await _create_category(client, other_headers, name="Other Groceries")

    _, budget_id = await _create_base_with_instance(client, headers, category_ids=[groceries])
    _, other_budget_id = await _create_base_with_instance(
        client,
        other_headers,
        category_ids=[other_groceries],
        base_overrides={"name": "Other Budget"},
    )

    await _create_transaction(client, headers, account_id, groceries, amount=-5000)
    await _create_transaction(client, other_headers, other_account_id, other_groceries, amount=-7000)

    resp = await client.get("/budgets/latest-utilizations", headers=headers)
    assert resp.status_code == 200

    budget_ids = {item["budget_id"] for item in resp.json()}
    assert budget_ids == {budget_id}
    assert other_budget_id not in budget_ids


async def test_get_base_budget_utilizations_returns_every_period_ordered_by_period_start(client):
    """The batched endpoint returns one utilization entry per period ordered by period_start."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    base_id, january_budget_id = await _create_base_with_instance(
        client, headers,
        category_ids=[groceries],
        instance_overrides={"period_start": "2026-01-01"},
    )
    february_budget_id = (
        await _create_budget_instance(client, headers, base_id, period_start="2026-02-01")
    ).json()["id"]
    march_budget_id = (
        await _create_budget_instance(client, headers, base_id, period_start="2026-03-01")
    ).json()["id"]

    await _create_transaction(client, headers, account_id, groceries, dt="2026-01-15", amount=-1000)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-02-15", amount=-2000)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-15", amount=-3000)

    resp = await _get_base_budget_utilizations(client, headers, base_id)
    assert resp.status_code == 200
    entries = resp.json()

    # One entry per period, returned in ascending period_start order
    assert [entry["budget_id"] for entry in entries] == [
        january_budget_id, february_budget_id, march_budget_id,
    ]
    assert [entry["period_start"] for entry in entries] == [
        "2026-01-01", "2026-02-01", "2026-03-01",
    ]
    assert [entry["total_spent"] for entry in entries] == [1000, 2000, 3000]


async def test_created_recurring_budget_counts_existing_historical_transactions(client, monkeypatch):
    """Atomic budget creation backfills periods that can use existing transaction history."""
    base_budget_routes = importlib.import_module("app.routes.base_budgets.router")

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 5, 4, 16, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    monkeypatch.setattr(base_budget_routes, "datetime", FixedDateTime)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = (await _create_account(client, headers)).json()["id"]
    takeout = await _create_category(client, headers, name="Historical Takeout")

    await _create_transaction(client, headers, account_id, takeout, dt="2026-01-15", amount=-4200)
    create_resp = await _create_base_budget(
        client,
        headers,
        name="Takeout Budget",
        category_ids=[takeout],
        recurs=True,
        period_start="2026-01-01",
        overall_limit=100000,
    )
    assert create_resp.status_code == 201
    base_id = create_resp.json()["id"]

    periods_resp = await client.get("/budgets", headers=headers)
    january_budget = next(
        budget for budget in periods_resp.json()
        if budget["base_budget_id"] == base_id and budget["period_start"] == "2026-01-01"
    )

    data = await _get_budget_utilization_entry(client, headers, base_id, january_budget["id"])
    assert data["period_start"] == "2026-01-01"
    assert data["period_end"] == "2026-01-31"
    assert data["total_spent"] == 4200
    assert {category["category_id"]: category["spent"] for category in data["categories"]} == {takeout: 4200}


async def test_get_budget_utilization_returns_per_category_breakdown(client):
    """The endpoint returns the budget's metadata plus per-category spend totals."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers, name="Test Groceries")
    transit = await _create_category(client, headers, name="Transit")

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries, transit],
    )

    await _create_transaction(client, headers, account_id, groceries, amount=-5000)
    await _create_transaction(client, headers, account_id, transit, amount=-2500)

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
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

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries, transit],
    )

    # Only groceries has activity; transit has none
    await _create_transaction(client, headers, account_id, groceries, amount=-5000)

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    by_id = {c["category_id"]: c["spent"] for c in data["categories"]}
    assert by_id[groceries] == 5000
    assert by_id[transit] == 0
    assert len(data["categories"]) == 2


async def test_get_budget_utilization_returns_empty_categories_when_all_soft_deleted(client):
    """A budget whose only tracked category has been soft-deleted returns an empty list

    Exercises the `if tracked_category_ids:` guard in the utilization query — if the
    tracked CTE returns zero rows the spend query is skipped entirely and categories
    comes back empty
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

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    assert data["categories"] == []
    assert data["total_spent"] == 0


async def test_get_budget_utilization_excludes_transactions_before_period_start(client):
    """Transactions dated before the budget's period_start are excluded."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    # Inside the period (kept) and before (excluded)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-15", amount=-5000)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-02-28", amount=-9999)

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
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

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-15", amount=-5000)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-04-01", amount=-9999)

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
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

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-01", amount=-1000)

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    assert data["total_spent"] == 1000
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 1000


async def test_get_budget_utilization_includes_transaction_at_period_end_boundary(client):
    """A transaction whose date equals period_end is included (inclusive bound)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-31", amount=-1000)

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
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

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[tracked],
    )

    await _create_transaction(client, headers, account_id, tracked, amount=-5000)
    await _create_transaction(client, headers, account_id, untracked, amount=-9999)

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    assert data["total_spent"] == 5000
    assert len(data["categories"]) == 1
    assert data["categories"][0]["category_id"] == tracked
