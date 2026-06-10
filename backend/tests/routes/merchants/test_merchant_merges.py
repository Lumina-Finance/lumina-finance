from tests.routes.merchants._helpers import (
    _create_category,
    _create_merchant,
    _get_system_category_id,
    _setup_group_with_member,
)
from tests.routes.support import _create_user, _get_auth_header

# --- POST /merchants/{merchant_id}/merge ---


async def test_merge_merchant_reassigns_transactions_and_deletes_source(client):
    """Merge moves transaction merchant references and deletes the source."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    category_id = await _get_system_category_id(client, headers)
    source_resp = await _create_merchant(client, headers, name="Old Costco")
    source_id = source_resp.json()["id"]
    replacement_resp = await _create_merchant(client, headers, name="New Costco")
    replacement_id = replacement_resp.json()["id"]

    account_resp = await client.post("/accounts", json={
        "account_kind": "asset", "account_type": "checking", "name": "Chequing", "currency": "CAD",
    }, headers=headers)
    account_id = account_resp.json()["id"]
    await client.post("/transactions", json={
        "account_id": account_id,
        "category_id": category_id,
        "merchant_id": source_id,
        "dt": "2026-03-15",
        "amount": -5000,
        "currency": "CAD",
    }, headers=headers)

    resp = await client.post(
        f"/merchants/{source_id}/merge",
        json={"replacement_merchant_id": replacement_id},
        headers=headers,
    )

    assert resp.status_code == 204

    source_get = await client.get(f"/merchants/{source_id}", headers=headers)
    assert source_get.status_code == 404

    transactions_resp = await client.get("/transactions", headers=headers)
    assert transactions_resp.json()[0]["merchant_id"] == replacement_id


async def test_merge_merchant_rejects_same_merchant_replacement(client):
    """Source and replacement merchants must differ."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    source_resp = await _create_merchant(client, headers, name="Old Costco")
    source_id = source_resp.json()["id"]

    resp = await client.post(
        f"/merchants/{source_id}/merge",
        json={"replacement_merchant_id": source_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Replacement merchant must be different"


async def test_merge_group_merchant_reassigns_transactions_as_admin(client):
    """Group admin can merge a group merchant into another group merchant."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)
    category_resp = await _create_category(client, admin_headers, name="Group Groceries", group_id=group_id)
    category_id = category_resp.json()["id"]
    source_resp = await _create_merchant(client, admin_headers, name="Old Shared Store", group_id=group_id)
    source_id = source_resp.json()["id"]
    replacement_resp = await _create_merchant(client, admin_headers, name="New Shared Store", group_id=group_id)
    replacement_id = replacement_resp.json()["id"]

    account_resp = await client.post("/accounts", json={
        "account_kind": "asset",
        "account_type": "checking",
        "name": "Joint Chequing",
        "currency": "CAD",
        "group_id": group_id,
    }, headers=admin_headers)
    account_id = account_resp.json()["id"]
    await client.post("/transactions", json={
        "account_id": account_id,
        "category_id": category_id,
        "merchant_id": source_id,
        "dt": "2026-03-15",
        "amount": -5000,
        "currency": "CAD",
    }, headers=admin_headers)

    resp = await client.post(
        f"/merchants/{source_id}/merge",
        json={"replacement_merchant_id": replacement_id},
        headers=admin_headers,
    )

    assert resp.status_code == 204

    source_get = await client.get(f"/merchants/{source_id}", headers=admin_headers)
    assert source_get.status_code == 404

    transactions_resp = await client.get("/transactions", headers=admin_headers)
    assert transactions_resp.json()[0]["merchant_id"] == replacement_id


async def test_merge_group_merchant_rejects_personal_replacement(client):
    """Group merchants cannot merge into an admin's personal merchant."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)
    source_resp = await _create_merchant(client, admin_headers, name="Shared Store", group_id=group_id)
    source_id = source_resp.json()["id"]
    replacement_resp = await _create_merchant(client, admin_headers, name="Personal Store")
    replacement_id = replacement_resp.json()["id"]

    resp = await client.post(
        f"/merchants/{source_id}/merge",
        json={"replacement_merchant_id": replacement_id},
        headers=admin_headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Replacement merchant not found"


async def test_merge_group_merchant_as_non_admin_returns_403(client):
    """Non-admin members cannot merge-delete group merchants."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)
    source_resp = await _create_merchant(client, admin_headers, name="Shared Store", group_id=group_id)
    source_id = source_resp.json()["id"]
    replacement_resp = await _create_merchant(client, admin_headers, name="Shared Shop", group_id=group_id)
    replacement_id = replacement_resp.json()["id"]

    resp = await client.post(
        f"/merchants/{source_id}/merge",
        json={"replacement_merchant_id": replacement_id},
        headers=member_headers,
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"
