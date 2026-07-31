from tests.routes.categories._helpers import (
    _create_category,
    _setup_group_with_member,
)
from tests.routes.support import _create_user, _get_auth_header

# --- POST /categories/{category_id}/merge ---


async def test_merge_category_reassigns_references_and_deletes_source(client):
    """Merge moves category references, handles duplicate budget tracking, and deletes the source."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    source_resp = await _create_category(client, headers, name="Old Groceries")
    source_id = source_resp.json()["id"]
    replacement_resp = await _create_category(client, headers, name="New Groceries")
    replacement_id = replacement_resp.json()["id"]

    account_resp = await client.post("/accounts", json={
        "account_kind": "asset", "account_type": "checking", "name": "Chequing", "currency": "CAD",
    }, headers=headers)
    account_id = account_resp.json()["id"]

    await client.post("/transactions", json={
        "account_id": account_id,
        "category_id": source_id,
        "dt": "2026-03-15",
        "amount": -5000,
        "currency": "CAD",
    }, headers=headers)
    merchant_resp = await client.post("/merchants", json={
        "name": "Costco",
        "default_category_id": source_id,
    }, headers=headers)
    merchant_id = merchant_resp.json()["id"]
    base_budget_resp = await client.post("/base-budgets", json={
        "name": "Food",
        "currency": "CAD",
        "recurrence_freq": "monthly",
        "recurrence_dom": 1,
        "category_ids": [source_id, replacement_id],
    }, headers=headers)
    base_budget_id = base_budget_resp.json()["id"]

    resp = await client.post(
        f"/categories/{source_id}/merge",
        json={"replacement_category_id": replacement_id},
        headers=headers,
    )

    assert resp.status_code == 204

    source_get = await client.get(f"/categories/{source_id}", headers=headers)
    assert source_get.status_code == 404

    transactions_resp = await client.get("/transactions", headers=headers)
    assert transactions_resp.json()[0]["category_id"] == replacement_id

    merchants_resp = await client.get("/merchants", headers=headers)
    merchant = next(item for item in merchants_resp.json() if item["id"] == merchant_id)
    assert merchant["default_category_id"] == replacement_id

    budget_resp = await client.get(f"/base-budgets/{base_budget_id}", headers=headers)
    assert set(budget_resp.json()["category_ids"]) == {replacement_id}


async def test_merge_category_rejects_same_category_replacement(client):
    """Source and replacement categories must differ."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    source_resp = await _create_category(client, headers, name="Old Groceries")
    source_id = source_resp.json()["id"]

    resp = await client.post(
        f"/categories/{source_id}/merge",
        json={"replacement_category_id": source_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Replacement category must be different"


async def test_merge_category_rejects_different_kind_replacement(client):
    """Category merge keeps transaction category kind stable."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    source_resp = await _create_category(client, headers, name="Old Groceries", kind="expense")
    source_id = source_resp.json()["id"]
    replacement_resp = await _create_category(client, headers, name="Side Income", kind="income")
    replacement_id = replacement_resp.json()["id"]

    resp = await client.post(
        f"/categories/{source_id}/merge",
        json={"replacement_category_id": replacement_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Replacement category kind must match"


async def test_merge_group_category_rejects_personal_replacement(client):
    """Group categories cannot merge into an admin's personal category."""
    admin_headers, _, _, group_id = await _setup_group_with_member(client)
    source_resp = await _create_category(client, admin_headers, name="Shared Food", group_id=group_id)
    source_id = source_resp.json()["id"]
    replacement_resp = await _create_category(client, admin_headers, name="Personal Food")
    replacement_id = replacement_resp.json()["id"]

    resp = await client.post(
        f"/categories/{source_id}/merge",
        json={"replacement_category_id": replacement_id},
        headers=admin_headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Replacement category not found"


async def test_merge_group_category_as_non_admin_returns_403(client):
    """Non-admin members cannot merge-delete group categories."""
    admin_headers, member_headers, _, group_id = await _setup_group_with_member(client)
    source_resp = await _create_category(client, admin_headers, name="Shared Food", group_id=group_id)
    source_id = source_resp.json()["id"]
    replacement_resp = await _create_category(client, admin_headers, name="Shared Dining", group_id=group_id)
    replacement_id = replacement_resp.json()["id"]

    resp = await client.post(
        f"/categories/{source_id}/merge",
        json={"replacement_category_id": replacement_id},
        headers=member_headers,
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin role required"


async def test_merge_into_balance_adjustment_clears_the_recorded_other_account(client):
    """Balance Adjustment has no other side, so a recorded account cannot survive the move."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    source_id = (await _create_category(client, headers, name="Account Move", kind="transfer")).json()["id"]
    categories = await client.get("/categories", headers=headers)
    balance_adjustment_id = next(
        category["id"] for category in categories.json() if category["name"] == "Balance Adjustment"
    )

    holder_id = (await client.post("/accounts", json={
        "account_kind": "asset", "account_type": "checking", "name": "Chequing", "currency": "CAD",
    }, headers=headers)).json()["id"]
    recorded_id = (await client.post("/accounts", json={
        "account_kind": "asset", "account_type": "savings", "name": "Savings", "currency": "CAD",
    }, headers=headers)).json()["id"]

    created = await client.post("/transactions", json={
        "account_id": holder_id,
        "category_id": source_id,
        "dt": "2026-03-15",
        "amount": -5000,
        "currency": "CAD",
        "other_account_scope": "tracked",
        "other_account_id": recorded_id,
    }, headers=headers)
    assert created.status_code == 201
    txn_id = created.json()["id"]

    merge_resp = await client.post(
        f"/categories/{source_id}/merge",
        json={"replacement_category_id": balance_adjustment_id},
        headers=headers,
    )

    assert merge_resp.status_code == 204
    moved = await client.get(f"/transactions/{txn_id}", headers=headers)
    assert moved.json()["category_id"] == balance_adjustment_id
    assert moved.json()["other_account_id"] is None
    assert moved.json()["other_account_scope"] is None
