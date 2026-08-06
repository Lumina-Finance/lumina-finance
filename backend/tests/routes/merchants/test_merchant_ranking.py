from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.routes.merchants.listing_helpers import MERCHANT_USAGE_CUTOFF_DAYS
from tests.routes.merchants._helpers import (
    _create_merchant,
    _get_system_category_id,
    _own_merchant_names,
)
from tests.routes.support import _create_user, _get_auth_header

# --- GET /merchants usage ranking ---

# The zone every test signup stores. The endpoint measures how old a transaction is against the
# user's own date, so a test recording one dated today has to mean the user's today: the host
# running the suite need not be in this zone, and can be a day ahead of it
USER_TIMEZONE = ZoneInfo("America/Toronto")


def _user_today():
    """Return the current date in the timezone the test signup stores"""
    return datetime.now(USER_TIMEZONE).date()


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
        resp = await client.post("/transactions", json={
            "account_id": account_id,
            "category_id": category_id,
            "merchant_id": merchant_id,
            "dt": dt.isoformat(),
            "amount": -5000,
            "currency": "CAD",
        }, headers=headers)
        # Every merchant scores zero when nothing is recorded, which several of these tests would
        # read as the order they expect, so a refused create has to fail here rather than there
        assert resp.status_code == 201, resp.text


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
    await _record_merchant_transactions(client, headers, account_id, category_id, merchant_id, 1, _user_today())

    resp = await client.get("/merchants", headers=headers)

    assert next(merchant["name"] for merchant in resp.json()) == "Corner Shop"


async def test_list_merchants_ranks_more_used_merchant_first(client):
    """Merchants used more often rank above less used ones regardless of name."""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _get_system_category_id(client, headers)
    account_id = await _create_checking_account(client, headers)
    recent_date = _user_today() - timedelta(days=5)

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


async def test_list_merchants_ranks_two_older_uses_above_one_newer_use(client):
    """A modest lead in transactions outweighs a few days of recency, so the busier merchant leads."""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _get_system_category_id(client, headers)
    account_id = await _create_checking_account(client, headers)
    today = _user_today()

    # Named against the expected order so alphabetical sorting alone cannot produce it
    busy_id = (await _create_merchant(client, headers, name="Zulu Store")).json()["id"]
    quiet_id = (await _create_merchant(client, headers, name="Alpha Store")).json()["id"]
    await _record_merchant_transactions(client, headers, account_id, category_id, busy_id, 2, today - timedelta(days=10))
    await _record_merchant_transactions(client, headers, account_id, category_id, quiet_id, 1, today - timedelta(days=1))

    resp = await client.get("/merchants", headers=headers)

    assert resp.status_code == 200
    assert _own_merchant_names(resp) == ["Zulu Store", "Alpha Store"]


async def test_list_merchants_breaks_usage_ties_by_name(client):
    """Merchants with equal usage fall back to alphabetical order."""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _get_system_category_id(client, headers)
    account_id = await _create_checking_account(client, headers)
    recent_date = _user_today() - timedelta(days=5)

    charlie_id = (await _create_merchant(client, headers, name="Charlie Market")).json()["id"]
    bravo_id = (await _create_merchant(client, headers, name="Bravo Market")).json()["id"]
    await _record_merchant_transactions(client, headers, account_id, category_id, charlie_id, 1, recent_date)
    await _record_merchant_transactions(client, headers, account_id, category_id, bravo_id, 1, recent_date)

    # An untouched merchant scores zero and sorts by name behind every merchant with any usage
    await _create_merchant(client, headers, name="Alpha Market")

    resp = await client.get("/merchants", headers=headers)

    assert resp.status_code == 200
    assert _own_merchant_names(resp) == ["Bravo Market", "Charlie Market", "Alpha Market"]


async def test_list_merchants_ranks_heavy_older_usage_above_one_recent_use(client):
    """Usage decays with age rather than stopping at a window edge, so weight of history still wins."""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _get_system_category_id(client, headers)
    account_id = await _create_checking_account(client, headers)
    today = _user_today()

    # Five transactions aged 120 days score 5 * 0.5 ** (120 / 90) = 1.98, against 1.00 for one today
    stale_id = (await _create_merchant(client, headers, name="Stale Store")).json()["id"]
    fresh_id = (await _create_merchant(client, headers, name="Fresh Store")).json()["id"]
    await _record_merchant_transactions(client, headers, account_id, category_id, stale_id, 5, today - timedelta(days=120))
    await _record_merchant_transactions(client, headers, account_id, category_id, fresh_id, 1, today)

    resp = await client.get("/merchants", headers=headers)

    assert resp.status_code == 200
    assert _own_merchant_names(resp) == ["Stale Store", "Fresh Store"]


async def test_list_merchants_ranks_recent_use_above_equally_frequent_older_use(client):
    """Two merchants used the same number of times are separated by how recent those uses are."""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _get_system_category_id(client, headers)
    account_id = await _create_checking_account(client, headers)
    today = _user_today()

    # Both ages sit inside the 90-day window the old ranking counted, where these tied at three
    # transactions each and sorted alphabetically. Names run against recency so only the decay
    # can produce the order below
    recent_id = (await _create_merchant(client, headers, name="Zulu Cafe")).json()["id"]
    older_id = (await _create_merchant(client, headers, name="Alpha Cafe")).json()["id"]
    await _record_merchant_transactions(client, headers, account_id, category_id, recent_id, 3, today - timedelta(days=10))
    await _record_merchant_transactions(client, headers, account_id, category_id, older_id, 3, today - timedelta(days=80))

    resp = await client.get("/merchants", headers=headers)

    assert resp.status_code == 200
    assert _own_merchant_names(resp) == ["Zulu Cafe", "Alpha Cafe"]


async def test_list_merchants_counts_usage_at_the_cutoff(client):
    """A transaction dated exactly at the cutoff still counts, so its merchant beats an unused one."""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _get_system_category_id(client, headers)
    account_id = await _create_checking_account(client, headers)
    # Sits on the boundary deliberately, which is also why it is the one test here that midnight
    # passing between this line and the request would flip
    cutoff_date = _user_today() - timedelta(days=MERCHANT_USAGE_CUTOFF_DAYS)

    used_id = (await _create_merchant(client, headers, name="Zulu Depot")).json()["id"]
    await _create_merchant(client, headers, name="Alpha Depot")
    await _record_merchant_transactions(client, headers, account_id, category_id, used_id, 1, cutoff_date)

    resp = await client.get("/merchants", headers=headers)

    assert resp.status_code == 200
    assert _own_merchant_names(resp) == ["Zulu Depot", "Alpha Depot"]


async def test_list_merchants_ignores_usage_past_the_cutoff(client):
    """Transactions older than the cutoff score nothing, so their merchant sorts among the unused."""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _get_system_category_id(client, headers)
    account_id = await _create_checking_account(client, headers)
    today = _user_today()

    # One day past the cutoff, pinning the excluded side of the boundary the way its sibling
    # test pins the counted side
    past_cutoff_date = today - timedelta(days=MERCHANT_USAGE_CUTOFF_DAYS + 1)

    # Named to sort behind the merchant that was never used, so counting these transactions at all
    # would lift it past that one. Naming it ahead would put it where a wrong answer lands anyway
    past_cutoff_id = (await _create_merchant(client, headers, name="Zulu Bazaar")).json()["id"]
    fresh_id = (await _create_merchant(client, headers, name="Fresh Store")).json()["id"]
    await _record_merchant_transactions(client, headers, account_id, category_id, past_cutoff_id, 5, past_cutoff_date)
    await _record_merchant_transactions(client, headers, account_id, category_id, fresh_id, 1, today)

    # Never used at all, and tied at zero with the merchant whose usage the cutoff discarded
    await _create_merchant(client, headers, name="Beta Store")

    resp = await client.get("/merchants", headers=headers)

    assert resp.status_code == 200
    assert _own_merchant_names(resp) == ["Fresh Store", "Beta Store", "Zulu Bazaar"]


async def test_list_merchants_ignores_future_dated_transactions(client):
    """A transaction dated ahead of the user's today counts for nothing until that date arrives."""
    headers = _get_auth_header(await _create_user(client))
    category_id = await _get_system_category_id(client, headers)
    account_id = await _create_checking_account(client, headers)
    today = _user_today()

    scheduled_id = (await _create_merchant(client, headers, name="Alpha Utility")).json()["id"]
    used_id = (await _create_merchant(client, headers, name="Zulu Utility")).json()["id"]
    await _record_merchant_transactions(client, headers, account_id, category_id, scheduled_id, 3, today + timedelta(days=30))
    await _record_merchant_transactions(client, headers, account_id, category_id, used_id, 1, today)

    resp = await client.get("/merchants", headers=headers)

    assert resp.status_code == 200
    assert _own_merchant_names(resp) == ["Zulu Utility", "Alpha Utility"]
