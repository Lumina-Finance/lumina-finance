"""Route tests for budget utilization endpoints."""


from tests.routes.budgets._utilization_helpers import (
    _create_base_with_instance,
    _create_category,
    _create_transaction,
    _get_budget_utilization_entry,
)
from tests.routes.support import _create_account, _create_user, _get_auth_header

# --- GET /base-budgets/{id}/utilizations — aggregation behavior ---


async def test_get_budget_utilization_sums_multiple_transactions_in_same_category(client):
    """Multiple transactions in one category sum to a single spent total for that category."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-05", amount=-1000)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-15", amount=-2000)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-25", amount=-3000)

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    assert len(data["categories"]) == 1
    assert data["categories"][0]["spent"] == 6000
    assert data["total_spent"] == 6000


async def test_get_budget_utilization_mixed_inflows_and_outflows_net_to_positive_spent(client):
    """An inflow (e.g. refund) in a tracked category reduces the net spent for that category."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    groceries = await _create_category(client, headers)

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    # 5000 expense, 1500 refund — net spent is 3500
    await _create_transaction(client, headers, account_id, groceries, amount=-5000)
    await _create_transaction(client, headers, account_id, groceries, dt="2026-03-20", amount=1500)

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    assert len(data["categories"]) == 1
    assert data["categories"][0]["spent"] == 3500
    assert data["total_spent"] == 3500


async def test_get_budget_utilization_net_inflow_returns_negative_spent(client):
    """If income exceeds outflow in a tracked category, spent is negative."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_id = (await _create_account(client, headers)).json()["id"]
    side_income = await _create_category(client, headers, name="Side Income", kind="income")

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[side_income],
    )

    await _create_transaction(client, headers, account_id, side_income, amount=10000)
    await _create_transaction(client, headers, account_id, side_income, dt="2026-03-20", amount=-2000)

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
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

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries, transit, side],
    )

    await _create_transaction(client, headers, account_id, groceries, amount=-5000)
    await _create_transaction(client, headers, account_id, transit, amount=-2500)
    await _create_transaction(client, headers, account_id, side, amount=3000)

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    summed = sum(c["spent"] for c in data["categories"])
    assert data["total_spent"] == summed
    assert summed == 5000 + 2500 - 3000
