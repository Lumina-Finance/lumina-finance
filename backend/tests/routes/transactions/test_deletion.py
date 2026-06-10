

from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import (
    NONEXISTENT_ID,
    _create_tag,
    _create_transaction,
    _setup_user_with_deps,
)

# --- DELETE /transactions/{id} ---


async def test_delete_transaction_returns_204(client):
    """DELETE removes the transaction and returns 204."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp = await client.delete(f"/transactions/{txn_id}", headers=headers)

    assert resp.status_code == 204

    get_resp = await client.get(f"/transactions/{txn_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_transaction_cleans_up_tags(client):
    """DELETE removes junction rows — tag itself is not deleted."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    tag_resp = await _create_tag(client, headers, name="keep-me")
    tag_id = tag_resp.json()["id"]

    create_resp = await _create_transaction(client, headers, account_id, category_id, tag_ids=[tag_id])
    txn_id = create_resp.json()["id"]

    await client.delete(f"/transactions/{txn_id}", headers=headers)

    tag_check = await client.get(f"/tags/{tag_id}", headers=headers)
    assert tag_check.status_code == 200


async def test_delete_transaction_not_found_returns_404(client):
    """DELETE non-existent transaction returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.delete(f"/transactions/{NONEXISTENT_ID}", headers=headers)
    assert resp.status_code == 404


async def test_delete_transaction_other_user_returns_404(client):
    """Deleting another user's transaction returns 404."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    other_headers, _, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")

    resp = await client.delete(f"/transactions/{txn_id}", headers=other_headers)
    assert resp.status_code == 404


async def test_delete_transaction_double_delete_returns_404(client):
    """Deleting the same transaction twice returns 204 then 404."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    create_resp = await _create_transaction(client, headers, account_id, category_id)
    txn_id = create_resp.json()["id"]

    resp1 = await client.delete(f"/transactions/{txn_id}", headers=headers)
    resp2 = await client.delete(f"/transactions/{txn_id}", headers=headers)

    assert resp1.status_code == 204
    assert resp2.status_code == 404


async def test_delete_transaction_without_auth_returns_401(client):
    """DELETE /transactions/{id} without an Authorization header returns 401."""
    resp = await client.delete(f"/transactions/{NONEXISTENT_ID}")
    assert resp.status_code == 401
