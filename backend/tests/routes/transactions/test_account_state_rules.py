

from tests.routes.transactions._helpers import (
    _create_account,
    _create_transaction,
    _seed_usd_currency,
    _setup_user_with_deps,
)

# --- Transactions on archived and closed accounts ---


async def test_create_transaction_on_archived_account_returns_422(client):
    """Creating a transaction on an archived account is rejected."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    archive_resp = await client.patch(f"/accounts/{account_id}", json={"is_archived": True}, headers=headers)
    assert archive_resp.status_code == 200

    resp = await _create_transaction(client, headers, account_id, category_id)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account is archived"


async def test_move_transaction_to_archived_account_returns_422(client):
    """Moving a transaction to an archived account is rejected."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    archived_account_id = (await _create_account(client, headers, name="Archived Savings")).json()["id"]
    archive_resp = await client.patch(f"/accounts/{archived_account_id}", json={"is_archived": True}, headers=headers)
    assert archive_resp.status_code == 200

    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"account_id": archived_account_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account is archived"


async def test_patch_transaction_on_archived_account_returns_422(client):
    """Editing existing history on an archived account is rejected."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id, notes="before archive")
    txn_id = create_resp.json()["id"]
    archive_resp = await client.patch(f"/accounts/{account_id}", json={"is_archived": True}, headers=headers)
    assert archive_resp.status_code == 200

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"notes": "after archive"},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account is archived"


async def test_delete_transaction_on_archived_account_returns_422(client):
    """Deleting existing history on an archived account is rejected."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]
    archive_resp = await client.patch(f"/accounts/{account_id}", json={"is_archived": True}, headers=headers)
    assert archive_resp.status_code == 200

    resp = await client.delete(f"/transactions/{txn_id}", headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account is archived"


async def test_create_transaction_on_closed_account_returns_422(client):
    """Creating a transaction on a closed account is rejected."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    # Close the account
    await client.patch(
        f"/accounts/{account_id}",
        json={"closed_at": "2026-03-01"},
        headers=headers,
    )

    resp = await _create_transaction(client, headers, account_id, category_id)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account is closed"


async def test_move_transaction_to_closed_account_returns_422(client):
    """Moving a transaction to a closed account is rejected."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    # Create a second account and close it
    second_acct_resp = await _create_account(client, headers, name="Closed Savings")
    closed_account_id = second_acct_resp.json()["id"]
    await client.patch(
        f"/accounts/{closed_account_id}",
        json={"closed_at": "2026-03-01"},
        headers=headers,
    )

    # Create a transaction on the open account
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    # Attempt to move it
    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"account_id": closed_account_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account is closed"


async def test_create_transaction_negative_fx_rate_different_currency_returns_422(client):
    """Creating a cross-currency transaction with a negative fx_rate is rejected."""
    await _seed_usd_currency()
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _create_transaction(
        client, headers, account_id, category_id, fx_rate=-1.5, currency="USD",
    )

    assert resp.status_code == 422


async def test_create_transaction_zero_fx_rate_different_currency_returns_422(client):
    """Creating a cross-currency transaction with fx_rate=0 is rejected."""
    await _seed_usd_currency()
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _create_transaction(
        client, headers, account_id, category_id, fx_rate=0, currency="USD",
    )

    assert resp.status_code == 422


async def test_create_transaction_negative_fx_rate_same_currency_returns_422(client):
    """Creating a same-currency transaction with a negative fx_rate is rejected."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _create_transaction(
        client, headers, account_id, category_id, fx_rate=-1.5,
    )

    assert resp.status_code == 422


async def test_create_transaction_zero_fx_rate_same_currency_returns_422(client):
    """Creating a same-currency transaction with fx_rate=0 is rejected."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _create_transaction(
        client, headers, account_id, category_id, fx_rate=0,
    )

    assert resp.status_code == 422


async def test_update_transaction_negative_fx_rate_same_currency_returns_422(client):
    """Updating a same-currency transaction to a negative fx_rate is rejected."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"fx_rate": -1.0},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_update_transaction_zero_fx_rate_same_currency_returns_422(client):
    """Updating a same-currency transaction to fx_rate=0 is rejected."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"fx_rate": 0},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_update_transaction_negative_fx_rate_different_currency_returns_422(client):
    """Updating a cross-currency transaction to a negative fx_rate is rejected."""
    await _seed_usd_currency()
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(
        client, headers, account_id, category_id, currency="USD", fx_rate=1.35,
    )
    txn_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"fx_rate": -1.0},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_update_transaction_zero_fx_rate_different_currency_returns_422(client):
    """Updating a cross-currency transaction to fx_rate=0 is rejected."""
    await _seed_usd_currency()
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(
        client, headers, account_id, category_id, currency="USD", fx_rate=1.35,
    )
    txn_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"fx_rate": 0},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_update_transaction_on_closed_account_allows_non_move_edits(client):
    """Closing an account after a transaction exists does not block edits that stay on it."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    # Create a transaction first, then close the account
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]
    await client.patch(
        f"/accounts/{account_id}",
        json={"closed_at": "2026-03-01"},
        headers=headers,
    )

    # Editing notes on the existing transaction should still succeed
    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"notes": "updated after close"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["notes"] == "updated after close"
