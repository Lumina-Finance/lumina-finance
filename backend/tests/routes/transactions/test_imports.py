

from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import (
    NONEXISTENT_ID,
    _create_merchant,
    _create_tag,
    _seed_institution,
    _setup_user_with_deps,
)

# --- POST /transactions/import ---


async def test_import_transactions_creates_records_and_recomputes_snapshots(client):
    """Import creates requested records, transactions, tags, and account snapshots."""
    institution = await _seed_institution()
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.post("/transactions/import", json={
        "accounts": [{
            "source": "TD Visa",
            "create": {
                "name": "TD Visa",
                "account_type": "credit_card",
                "currency": "CAD",
                "institution_id": str(institution.id),
            },
        }],
        "categories": [{
            "source": "Restaurants",
            "create": {"name": "Restaurants", "kind": "expense"},
        }],
        "rows": [{
            "account_source": "TD Visa",
            "category_source": "Restaurants",
            "dt": "2026-04-10",
            "amount": "-12.34",
            "merchant_name": "Corner Cafe",
            "notes": "Lunch",
            "tag_names": ["Food", "Food", ""],
        }],
    }, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["transactions_created"] == 1
    assert data["accounts_created"] == 1
    assert data["categories_created"] == 1
    assert data["merchants_created"] == 1
    assert data["tags_created"] == 1
    assert data["affected_account_ids"] == data["created_account_ids"]

    account_id = data["created_account_ids"][0]
    category_id = data["created_category_ids"][0]
    assert data["account_source_ids"] == {"TD Visa": account_id}
    assert data["category_source_ids"] == {"Restaurants": category_id}
    transactions_resp = await client.get("/transactions", headers=headers)
    transaction = transactions_resp.json()[0]
    assert transaction["account_id"] == account_id
    assert transaction["category_id"] == category_id
    assert transaction["amount"] == -1234
    assert transaction["currency"] == "CAD"
    assert transaction["merchant_name"] == "Corner Cafe"
    assert transaction["notes"] == "Lunch"
    assert [tag["name"] for tag in transaction["tags"]] == ["Food"]

    accounts_resp = await client.get("/accounts", headers=headers)
    account = next(item for item in accounts_resp.json() if item["id"] == account_id)
    assert account["account_kind"] == "revolving"
    assert account["account_type"] == "credit_card"
    assert account["institution"]["id"] == str(institution.id)
    assert account["current_balance"] == -1234

    snapshots_resp = await client.get(f"/accounts/{account_id}/snapshots", headers=headers)
    assert {"account_id": account_id, "dt": "2026-04-10", "balance": -1234} in snapshots_resp.json()


async def test_import_transactions_reuses_existing_records_and_parses_comma_amount(client):
    """Import reuses explicit mappings and existing merchant/tag names."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _create_merchant(client, headers, name="Costco")
    await _create_tag(client, headers, name="bulk")

    resp = await client.post("/transactions/import", json={
        "accounts": [{"source": "Main Chequing", "account_id": account_id}],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": [{
            "account_source": "Main Chequing",
            "category_source": "Groceries",
            "dt": "2026-04-11",
            "amount": "1,234.56",
            "merchant_name": "Costco",
            "tag_names": ["bulk"],
        }],
    }, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["transactions_created"] == 1
    assert data["accounts_reused"] == 1
    assert data["categories_reused"] == 1
    assert data["merchants_reused"] == 1
    assert data["tags_reused"] == 1
    assert data["created_account_ids"] == []
    assert data["created_category_ids"] == []
    assert data["created_merchant_ids"] == []
    assert data["created_tag_ids"] == []
    assert data["account_source_ids"] == {"Main Chequing": account_id}
    assert data["category_source_ids"] == {"Groceries": category_id}

    transactions_resp = await client.get("/transactions", headers=headers)
    transaction = transactions_resp.json()[0]
    assert transaction["account_id"] == account_id
    assert transaction["category_id"] == category_id
    assert transaction["amount"] == 123456
    assert transaction["merchant_name"] == "Costco"
    assert [tag["name"] for tag in transaction["tags"]] == ["bulk"]


async def test_import_transactions_rejects_unmapped_account_source(client):
    """Rows must reference a declared account source."""
    headers, _, category_id = await _setup_user_with_deps(client)

    resp = await client.post("/transactions/import", json={
        "accounts": [{
            "source": "Mapped Account",
            "create": {"name": "Imported Account", "account_type": "checking", "currency": "CAD"},
        }],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": [{
            "account_source": "Missing Account",
            "category_source": "Groceries",
            "dt": "2026-04-11",
            "amount": "-10.00",
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account source is not mapped: Missing Account"


async def test_import_transactions_rejects_invalid_created_account_institution(client):
    """Import-created accounts must reference an existing institution."""
    headers, _, category_id = await _setup_user_with_deps(client)

    resp = await client.post("/transactions/import", json={
        "accounts": [{
            "source": "Mapped Account",
            "create": {
                "name": "Imported Account",
                "account_type": "checking",
                "currency": "CAD",
                "institution_id": NONEXISTENT_ID,
            },
        }],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": [{
            "account_source": "Mapped Account",
            "category_source": "Groceries",
            "dt": "2026-04-11",
            "amount": "-10.00",
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Institution not found"


async def test_import_transactions_rejects_invalid_raw_amount(client):
    """Imported amounts must be raw numeric strings with optional thousands separators."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await client.post("/transactions/import", json={
        "accounts": [{"source": "Main Chequing", "account_id": account_id}],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": [{
            "account_source": "Main Chequing",
            "category_source": "Groceries",
            "dt": "2026-04-11",
            "amount": "$12.34",
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid amount: $12.34"


async def test_import_transactions_rejects_archived_account_mapping(client):
    """Import cannot add new rows to an archived account."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    archive_resp = await client.patch(f"/accounts/{account_id}", json={"is_archived": True}, headers=headers)
    assert archive_resp.status_code == 200

    resp = await client.post("/transactions/import", json={
        "accounts": [{"source": "Main Chequing", "account_id": account_id}],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": [{
            "account_source": "Main Chequing",
            "category_source": "Groceries",
            "dt": "2026-04-11",
            "amount": "-10.00",
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account is archived"
