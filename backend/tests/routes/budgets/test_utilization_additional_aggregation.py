"""Route tests for budget utilization endpoints."""


from tests.routes.budgets._utilization_helpers import (
    _create_base_with_instance,
    _create_category,
    _create_transaction,
    _get_budget_utilization_entry,
)
from tests.routes.support import _create_account, _create_user, _get_auth_header

# --- GET /base-budgets/{id}/utilizations — additional aggregation contracts ---


async def test_get_budget_utilization_aggregates_across_multiple_accounts_in_same_currency(client):
    """A category's spend sums across all accounts the user owns in that currency

    The endpoint intentionally does not filter by account_id — only by category
    and date. This test locks in that contract: a regression that accidentally
    scoped the spend query to a single account would lose data
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    chequing_id = (await _create_account(client, headers, name="Chequing")).json()["id"]
    savings_id = (await _create_account(client, headers, name="Savings", account_type="savings")).json()["id"]
    groceries = await _create_category(client, headers)

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    await _create_transaction(client, headers, chequing_id, groceries, amount=-3000)
    await _create_transaction(client, headers, savings_id, groceries, dt="2026-03-20", amount=-2500)

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
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

    base_id, budget_id = await _create_base_with_instance(
        client, headers, category_ids=[groceries],
    )

    # Assert the zero-amount txn was actually created — guards against a future
    # CHECK > 0 on Transaction.amount silently making this test pass for the
    # wrong reason (no txn created, no spend, zero total)
    create_resp = await _create_transaction(client, headers, account_id, groceries, amount=0)
    assert create_resp.status_code == 201

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    assert data["total_spent"] == 0
    assert len(data["categories"]) == 1
    assert data["categories"][0]["spent"] == 0
