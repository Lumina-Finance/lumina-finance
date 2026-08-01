from datetime import date, timedelta

from app.routes.merchants.listing_helpers import MERCHANT_FREQUENCY_WINDOW_DAYS
from tests.routes.merchants._helpers import (
    _create_merchant,
    _get_system_category_id,
    _own_merchant_names,
)
from tests.routes.support import _create_user, _get_auth_header

# --- GET /merchants frequency ranking ---


async def _create_checking_account(client, headers):
    """Create a CAD chequing account and return its ID for transaction setup

    Args:
        client: The async test client
        headers: Auth headers for the requesting user

    Returns:
        The created account's ID
    """
    resp = await client.post("/accounts", json={
        "account_kind": "asset",
        "account_type": "checking",
        "name": "Chequing",
        "currency": "CAD",
    }, headers=headers)
    return resp.json()["id"]


async def _record_merchant_transactions(client, headers, account_id, category_id, merchant_id, count, dt):
    """Record a number of identical transactions against one merchant on a given date

    Args:
        client: The async test client
        headers: Auth headers for the requesting user
        account_id: Account the transactions belong to
        category_id: Category assigned to each transaction
        merchant_id: Merchant the transactions reference
        count: Number of transactions to record
        dt: Transaction date applied to every recorded row
    """
    for _ in range(count):
        await client.post("/transactions", json={
            "account_id": account_id,
            "category_id": category_id,
            "merchant_id": merchant_id,
            "dt": dt.isoformat(),
            "amount": -5000,
            "currency": "CAD",
        }, headers=headers)


async def test_list_merchants_ignores_the_balance_adjustments_the_app_writes(client):
    """Opening accounts is not transacting, so the merchant those adjustments carry does not climb."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    # Each account written with a starting balance produces a balance adjustment carrying Myself
    for name in ("Chequing", "Savings", "Vacation"):
        await client.post("/accounts", json={
            "account_kind": "asset",
            "account_type": "checking",
            "name": name,
            "currency": "CAD",
            "starting_balance": 100_00,
        }, headers=headers)

    account_id = await _create_checking_account(client, headers)
    category_id = await _get_system_category_id(client, headers)
    merchant_id = (await _create_merchant(client, headers, name="Corner Shop")).json()["id"]
    await _record_merchant_transactions(client, headers, account_id, category_id, merchant_id, 1, date.today())

    resp = await client.get("/merchants", headers=headers)

    assert [merchant["name"] for merchant in resp.json()][0] == "Corner Shop"


async def test_list_merchants_ranks_more_used_merchant_first(client):
    """Merchants with more recent transactions rank above less used ones regardless of name."""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _get_system_category_id(client, headers)
    account_id = await _create_checking_account(client, headers)
    recent_date = date.today() - timedelta(days=5)

    # Names run reverse-alphabetical against usage so only frequency can produce this order
    least_used_id = (await _create_merchant(client, headers, name="Alpha Store")).json()["id"]
    mid_used_id = (await _create_merchant(client, headers, name="Mike Store")).json()["id"]
    most_used_id = (await _create_merchant(client, headers, name="Zulu Store")).json()["id"]
    await _record_merchant_transactions(client, headers, account_id, category_id, least_used_id, 1, recent_date)
    await _record_merchant_transactions(client, headers, account_id, category_id, mid_used_id, 2, recent_date)
    await _record_merchant_transactions(client, headers, account_id, category_id, most_used_id, 3, recent_date)

    resp = await client.get("/merchants", headers=headers)

    assert resp.status_code == 200
    assert _own_merchant_names(resp) == ["Zulu Store", "Mike Store", "Alpha Store"]


async def test_list_merchants_breaks_frequency_ties_by_name(client):
    """Merchants with equal recent usage fall back to alphabetical order."""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _get_system_category_id(client, headers)
    account_id = await _create_checking_account(client, headers)
    recent_date = date.today() - timedelta(days=5)

    charlie_id = (await _create_merchant(client, headers, name="Charlie Market")).json()["id"]
    bravo_id = (await _create_merchant(client, headers, name="Bravo Market")).json()["id"]
    await _record_merchant_transactions(client, headers, account_id, category_id, charlie_id, 1, recent_date)
    await _record_merchant_transactions(client, headers, account_id, category_id, bravo_id, 1, recent_date)

    # An untouched merchant ties every other at zero usage and sorts by name behind them
    await _create_merchant(client, headers, name="Alpha Market")

    resp = await client.get("/merchants", headers=headers)

    assert resp.status_code == 200
    assert _own_merchant_names(resp) == ["Bravo Market", "Charlie Market", "Alpha Market"]


async def test_list_merchants_ignores_usage_outside_window(client):
    """Transactions older than the recency window do not count toward ranking."""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _get_system_category_id(client, headers)
    account_id = await _create_checking_account(client, headers)
    recent_date = date.today() - timedelta(days=5)
    stale_date = date.today() - timedelta(days=MERCHANT_FREQUENCY_WINDOW_DAYS + 30)

    stale_id = (await _create_merchant(client, headers, name="Stale Store")).json()["id"]
    fresh_id = (await _create_merchant(client, headers, name="Fresh Store")).json()["id"]
    await _record_merchant_transactions(client, headers, account_id, category_id, stale_id, 5, stale_date)
    await _record_merchant_transactions(client, headers, account_id, category_id, fresh_id, 1, recent_date)

    resp = await client.get("/merchants", headers=headers)

    assert resp.status_code == 200
    assert _own_merchant_names(resp) == ["Fresh Store", "Stale Store"]


async def test_list_merchants_ranks_by_all_history_when_shorter_than_window(client):
    """A user whose entire history fits inside the window ranks by every transaction."""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _get_system_category_id(client, headers)
    account_id = await _create_checking_account(client, headers)
    earliest_date = date.today() - timedelta(days=10)
    latest_date = date.today() - timedelta(days=1)

    busy_id = (await _create_merchant(client, headers, name="Busy Store")).json()["id"]
    quiet_id = (await _create_merchant(client, headers, name="Quiet Store")).json()["id"]
    await _record_merchant_transactions(client, headers, account_id, category_id, busy_id, 2, earliest_date)
    await _record_merchant_transactions(client, headers, account_id, category_id, quiet_id, 1, latest_date)

    resp = await client.get("/merchants", headers=headers)

    assert resp.status_code == 200
    assert _own_merchant_names(resp) == ["Busy Store", "Quiet Store"]
