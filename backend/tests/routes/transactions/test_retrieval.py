

from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import (
    NONEXISTENT_ID,
    _create_merchant,
    _create_tag,
    _create_transaction,
    _setup_user_with_deps,
)

# --- GET /transactions/{id} ---


async def test_get_transaction_returns_transaction(client):
    """Valid transaction ID returns the transaction with all fields."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    merchant_resp = await _create_merchant(client, headers, name="Detail Store")
    create_resp = await _create_transaction(
        client,
        headers,
        account_id,
        category_id,
        merchant_id=merchant_resp.json()["id"],
    )
    txn_id = create_resp.json()["id"]

    resp = await client.get(f"/transactions/{txn_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["id"] == txn_id
    assert resp.json()["amount"] == -5000
    assert resp.json()["merchant_name"] == "Detail Store"
    assert resp.json()["tag_ids"] == []
    assert resp.json()["tags"] == []


async def test_get_transaction_includes_tag_ids(client):
    """Get transaction returns associated tag IDs and summaries."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    tag_resp = await _create_tag(client, headers, name="tagged")
    tag_id = tag_resp.json()["id"]

    create_resp = await _create_transaction(client, headers, account_id, category_id, tag_ids=[tag_id])
    txn_id = create_resp.json()["id"]

    resp = await client.get(f"/transactions/{txn_id}", headers=headers)

    assert resp.status_code == 200
    assert resp.json()["tag_ids"] == [tag_id]
    assert resp.json()["tags"] == [{"id": tag_id, "group_id": None, "name": "tagged"}]


async def test_get_transaction_not_found_returns_404(client):
    """Non-existent transaction ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/transactions/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Transaction not found"


async def test_get_transaction_other_user_returns_404(client):
    """Accessing another user's transaction returns 404."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    other_headers, _, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")

    resp = await client.get(f"/transactions/{txn_id}", headers=other_headers)
    assert resp.status_code == 404


async def test_get_transaction_without_auth_returns_401(client):
    """GET /transactions/{id} without an Authorization header returns 401."""
    resp = await client.get(f"/transactions/{NONEXISTENT_ID}")
    assert resp.status_code == 401
