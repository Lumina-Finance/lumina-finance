"""Route tests for budget utilization endpoints."""
from datetime import date

from tests.routes.budgets._utilization_helpers import (
    _create_base_with_instance,
    _create_category,
    _create_transaction,
    _get_budget_utilization_entry,
    _set_tracked_category_timestamps,
)
from tests.routes.support import _create_account, _create_user, _get_auth_header

# --- GET /base-budgets/{id}/utilizations — day-boundary cutoffs ---


async def test_get_budget_utilization_added_at_equal_to_period_end_is_tracked(client):
    """A category whose added_at day equals period_end is still tracked

    Pins the `added_at <= period_end` bound: same-day-as-period-end passes
    A regression that flipped `<=` to `<` would exclude the category and make
    this test fail
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

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    assert data["total_spent"] == 4000
    assert len(data["categories"]) == 1
    assert data["categories"][0]["category_id"] == groceries
    assert data["categories"][0]["spent"] == 4000


async def test_get_budget_utilization_added_at_day_after_period_end_is_not_tracked(client):
    """A category whose added_at day is one day after period_end is excluded

    Pins the other side of the `added_at <= period_end` bound: April 1 for
    a March 1-31 instance is excluded. A regression that flipped the direction
    of the comparison would include the row and make this test fail
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

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    assert data["total_spent"] == 0
    assert data["categories"] == []


async def test_get_budget_utilization_removed_at_equal_to_period_end_is_not_tracked(client):
    """A category whose removed_at day equals period_end is excluded

    Pins the strict `removed_at > period_end` bound: same-day-as-period-end
    fails the predicate. A regression that flipped `>` to `>=` would include
    the row and make this test fail
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

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    assert data["total_spent"] == 0
    assert data["categories"] == []


async def test_get_budget_utilization_removed_at_day_after_period_end_is_tracked(client):
    """A category whose removed_at day is one day after period_end stays tracked

    Pins the other side of `removed_at > period_end`: April 1 for a March
    1-31 instance still counts. A regression that flipped the comparison would
    exclude the row and make this test fail
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

    data = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
    assert data["total_spent"] == 4000
    assert len(data["categories"]) == 1
    assert data["categories"][0]["spent"] == 4000
