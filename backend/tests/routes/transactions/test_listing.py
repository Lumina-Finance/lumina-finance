

from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import (
    _create_account,
    _create_transaction,
    _setup_user_with_deps,
)

# --- GET /transactions ---


async def test_list_transactions_returns_empty_list(client):
    """User with no transactions gets an empty list."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/transactions", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_transactions_returns_user_transactions(client):
    """User sees their own transactions and not another user's."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, account_id, category_id, amount=-2000)

    other_headers, other_acct, other_cat = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")
    await _create_transaction(client, other_headers, other_acct, other_cat)

    resp = await client.get("/transactions", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    amounts = {t["amount"] for t in data}
    assert amounts == {-1000, -2000}


async def test_list_transactions_includes_archived_accounts_unscoped(client):
    """Default transaction list includes archived-account history."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    archived_account_id = (await _create_account(client, headers, name="Archived")).json()["id"]

    await _create_transaction(client, headers, account_id, category_id, amount=-1000)
    await _create_transaction(client, headers, archived_account_id, category_id, amount=-9000)
    await _create_transaction(client, headers, archived_account_id, category_id, amount=9000)
    archive_resp = await client.patch(f"/accounts/{archived_account_id}", json={"is_archived": True}, headers=headers)
    assert archive_resp.status_code == 200

    resp = await client.get("/transactions", headers=headers)

    assert resp.status_code == 200
    assert {txn["amount"] for txn in resp.json()} == {-1000, -9000, 9000}


async def test_list_transactions_explicit_archived_account_is_allowed(client):
    """Directly filtering by an archived account still exposes its transactions."""
    headers, _, category_id = await _setup_user_with_deps(client)
    archived_account_id = (await _create_account(client, headers, name="Archived")).json()["id"]

    await _create_transaction(client, headers, archived_account_id, category_id, amount=-9000)
    await _create_transaction(client, headers, archived_account_id, category_id, amount=9000)
    archive_resp = await client.patch(f"/accounts/{archived_account_id}", json={"is_archived": True}, headers=headers)
    assert archive_resp.status_code == 200

    resp = await client.get(f"/transactions?account_id={archived_account_id}", headers=headers)

    assert resp.status_code == 200
    assert {txn["amount"] for txn in resp.json()} == {-9000, 9000}


async def test_list_transactions_without_auth_returns_401(client):
    """GET /transactions without an Authorization header returns 401."""
    resp = await client.get("/transactions")
    assert resp.status_code == 401
