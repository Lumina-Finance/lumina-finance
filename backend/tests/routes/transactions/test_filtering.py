

from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import (
    _create_account,
    _create_category,
    _create_merchant,
    _create_transaction,
    _seed_usd_currency,
    _setup_user_with_deps,
)

# --- Filtering ---


async def test_list_transactions_filter_by_account(client):
    """Filtering by account_id returns only that account's transactions."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_account = await _create_account(client, headers, name="Savings")

    await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, other_account.json()["id"], category_id, amount=-2000)

    resp = await client.get(f"/transactions?account_id={account_id}", headers=headers)

    assert len(resp.json()) == 1
    assert resp.json()[0]["amount"] == -1000


async def test_list_transactions_filter_by_category(client):
    """Filtering by category_id returns only that category's transactions."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_cat = await _create_category(client, headers, name="Test Income", kind="income")

    await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, account_id, other_cat.json()["id"], amount=5000)

    resp = await client.get(f"/transactions?category_id={other_cat.json()['id']}", headers=headers)

    assert len(resp.json()) == 1
    assert resp.json()[0]["amount"] == 5000


async def test_list_transactions_filter_by_merchant(client):
    """Filtering by merchant_id returns only that merchant's transactions."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    merchant = await _create_merchant(client, headers)

    await _create_transaction(client, headers, account_id, category_id, merchant_id=merchant.json()["id"], amount=-1000)
    await _create_transaction(client, headers, account_id, category_id, amount=-2000)

    resp = await client.get(f"/transactions?merchant_id={merchant.json()['id']}", headers=headers)

    assert len(resp.json()) == 1
    assert resp.json()[0]["amount"] == -1000
    assert resp.json()[0]["merchant_name"] == "Costco"


async def test_list_transactions_filter_by_currency(client):
    """Filtering by currency returns only transactions in that currency."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _seed_usd_currency()

    usd_account = await _create_account(client, headers, name="USD Account", currency="USD")
    await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, usd_account.json()["id"], category_id, amount=-2000, currency="USD")

    resp = await client.get("/transactions?currency=USD", headers=headers)

    assert len(resp.json()) == 1
    assert resp.json()[0]["amount"] == -2000


async def test_list_transactions_filter_by_date_range(client):
    """Filtering by from_date and to_date returns transactions within the range."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    await _create_transaction(client, headers, account_id, category_id, dt="2026-01-15")
    await _create_transaction(client, headers, account_id, category_id, dt="2026-02-15")
    await _create_transaction(client, headers, account_id, category_id, dt="2026-03-15")

    resp = await client.get(
        "/transactions?from_date=2026-02-01&to_date=2026-02-28",
        headers=headers,
    )

    assert len(resp.json()) == 1


async def test_list_transactions_filter_by_date_range_is_inclusive(client):
    """Transactions exactly on from_date and to_date are included."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    await _create_transaction(client, headers, account_id, category_id, dt="2026-02-01")
    await _create_transaction(client, headers, account_id, category_id, dt="2026-02-15")
    await _create_transaction(client, headers, account_id, category_id, dt="2026-02-28")

    resp = await client.get(
        "/transactions?from_date=2026-02-01&to_date=2026-02-28",
        headers=headers,
    )

    assert len(resp.json()) == 3


async def test_list_transactions_filter_by_from_date_only(client):
    """Filtering with only from_date returns transactions on or after that date."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    await _create_transaction(client, headers, account_id, category_id, dt="2026-01-15")
    await _create_transaction(client, headers, account_id, category_id, dt="2026-03-15")

    resp = await client.get("/transactions?from_date=2026-02-01", headers=headers)

    assert len(resp.json()) == 1


async def test_list_transactions_filter_by_to_date_only(client):
    """Filtering with only to_date returns transactions on or before that date."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    await _create_transaction(client, headers, account_id, category_id, dt="2026-01-15")
    await _create_transaction(client, headers, account_id, category_id, dt="2026-03-15")

    resp = await client.get("/transactions?to_date=2026-02-01", headers=headers)

    assert len(resp.json()) == 1


async def test_list_transactions_multiple_filters_combined(client):
    """Multiple filters applied together narrow results correctly."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_cat = await _create_category(client, headers, name="Test Income", kind="income")

    await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, account_id, other_cat.json()["id"], amount=5000)
    await _create_transaction(client, headers, account_id, category_id, amount=-3000)

    resp = await client.get(
        f"/transactions?account_id={account_id}&category_id={category_id}",
        headers=headers,
    )

    assert len(resp.json()) == 2
    amounts = {t["amount"] for t in resp.json()}
    assert amounts == {-1000, -3000}


async def test_list_transactions_from_date_after_to_date_returns_422(client):
    """from_date after to_date returns 422."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(
        "/transactions?from_date=2026-04-01&to_date=2026-03-01",
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Start date must be before end date"
