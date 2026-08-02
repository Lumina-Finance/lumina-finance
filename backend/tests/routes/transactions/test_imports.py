

from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import (
    NONEXISTENT_ID,
    _create_account,
    _create_merchant,
    _create_tag,
    _get_system_category_id,
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


async def test_import_transactions_reuses_existing_records(client):
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
            "amount": "1234.56",
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


async def test_import_transactions_records_the_other_account_on_a_transfer(client):
    """A transfer row that states a counterparty records it, and a row that states none says the money left."""
    headers, account_id, _ = await _setup_user_with_deps(client)
    savings_resp = await _create_account(client, headers, name="Main Savings", account_type="savings")
    savings_id = savings_resp.json()["id"]
    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")

    resp = await client.post("/transactions/import", json={
        "accounts": [
            {"source": "Chequing", "account_id": account_id},
            {"source": "Savings", "account_id": savings_id},
        ],
        "categories": [{"source": "Transfer", "category_id": transfer_category_id}],
        "rows": [
            {
                "account_source": "Chequing",
                "category_source": "Transfer",
                "dt": "2026-04-11",
                "amount": "-500.00",
                "counterparty_account_source": "Savings",
            },
            {
                "account_source": "Savings",
                "category_source": "Transfer",
                "dt": "2026-04-13",
                "amount": "500.00",
            },
        ],
    }, headers=headers)

    assert resp.status_code == 201
    transactions_resp = await client.get("/transactions", headers=headers)
    transactions_by_amount = {transaction["amount"]: transaction for transaction in transactions_resp.json()}
    assert transactions_by_amount[-50000]["other_account_id"] == savings_id
    assert transactions_by_amount[-50000]["other_account_scope"] == "tracked"

    # Nothing in the file points this leg at an account, so it records that the money left the
    # tracked accounts rather than arriving unanswered and blocking every later edit
    assert transactions_by_amount[50000]["other_account_id"] is None
    assert transactions_by_amount[50000]["other_account_scope"] == "outside"


async def test_import_transactions_records_an_account_it_creates_as_the_other_side(client):
    """An other-account source can be a new account, which holds no rows of its own."""
    headers, account_id, _ = await _setup_user_with_deps(client)
    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")

    resp = await client.post("/transactions/import", json={
        "accounts": [
            {"source": "Chequing", "account_id": account_id},
            {
                "source": "Savings",
                "create": {"name": "Savings", "account_type": "savings", "currency": "CAD"},
            },
        ],
        "categories": [{"source": "Transfer", "category_id": transfer_category_id}],
        "rows": [{
            "account_source": "Chequing",
            "category_source": "Transfer",
            "dt": "2026-04-11",
            "amount": "-500.00",
            "counterparty_account_source": "Savings",
        }],
    }, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["accounts_created"] == 1

    transaction = (await client.get("/transactions", headers=headers)).json()[0]
    assert transaction["other_account_id"] == data["account_source_ids"]["Savings"]
    assert transaction["other_account_scope"] == "tracked"


async def test_import_transactions_records_a_transfer_leaving_the_tracked_accounts(client):
    """A source mapped as outside records that the money left, without pointing at an account."""
    headers, account_id, _ = await _setup_user_with_deps(client)
    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")

    resp = await client.post("/transactions/import", json={
        "accounts": [
            {"source": "Chequing", "account_id": account_id},
            {"source": "Brokerage elsewhere", "outside": True},
        ],
        "categories": [{"source": "Transfer", "category_id": transfer_category_id}],
        "rows": [{
            "account_source": "Chequing",
            "category_source": "Transfer",
            "dt": "2026-04-11",
            "amount": "-500.00",
            "counterparty_account_source": "Brokerage elsewhere",
        }],
    }, headers=headers)

    assert resp.status_code == 201
    assert resp.json()["accounts_created"] == 0
    transaction = (await client.get("/transactions", headers=headers)).json()[0]
    assert transaction["other_account_id"] is None
    assert transaction["other_account_scope"] == "outside"


async def test_import_transactions_rejects_an_other_account_on_a_non_transfer_row(client):
    """Only a transfer records a counterparty, so an expense row that states one is refused."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    savings_resp = await _create_account(client, headers, name="Main Savings", account_type="savings")

    resp = await client.post("/transactions/import", json={
        "accounts": [
            {"source": "Chequing", "account_id": account_id},
            {"source": "Savings", "account_id": savings_resp.json()["id"]},
        ],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": [{
            "account_source": "Chequing",
            "category_source": "Groceries",
            "dt": "2026-04-11",
            "amount": "-10.00",
            "counterparty_account_source": "Savings",
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Only a transfer records a counterparty account: Savings"


async def test_import_transactions_rejects_a_transfer_recording_its_own_account(client):
    """Two sources mapped onto one account cannot record that account as its own other side."""
    headers, account_id, _ = await _setup_user_with_deps(client)
    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")

    resp = await client.post("/transactions/import", json={
        "accounts": [
            {"source": "Chequing", "account_id": account_id},
            {"source": "Chequing (old)", "account_id": account_id},
        ],
        "categories": [{"source": "Transfer", "category_id": transfer_category_id}],
        "rows": [{
            "account_source": "Chequing",
            "category_source": "Transfer",
            "dt": "2026-04-11",
            "amount": "-500.00",
            "counterparty_account_source": "Chequing (old)",
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "A transfer cannot record its own account as its counterparty: Chequing (old)"


async def test_import_transactions_rejects_an_unmapped_counterparty_source(client):
    """An undeclared value in the counterparty column is refused, saying which column it came from."""
    headers, account_id, _ = await _setup_user_with_deps(client)
    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")

    resp = await client.post("/transactions/import", json={
        "accounts": [{"source": "Chequing", "account_id": account_id}],
        "categories": [{"source": "Transfer", "category_id": transfer_category_id}],
        "rows": [{
            "account_source": "Chequing",
            "category_source": "Transfer",
            "dt": "2026-04-11",
            "amount": "-500.00",
            "counterparty_account_source": "Savings",
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Counterparty account source is not mapped: Savings"


async def test_import_transactions_rejects_an_outside_source_that_also_names_an_account(client):
    """A source answers with exactly one of an account, a new account, or the outside answer."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await client.post("/transactions/import", json={
        "accounts": [{"source": "Chequing", "account_id": account_id, "outside": True}],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": [{
            "account_source": "Chequing",
            "category_source": "Groceries",
            "dt": "2026-04-11",
            "amount": "-10.00",
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account source must map to exactly one account action: Chequing"


async def test_import_transactions_rejects_rows_written_to_an_outside_source(client):
    """An outside source answers where money went and holds no rows of its own."""
    headers, _, category_id = await _setup_user_with_deps(client)

    resp = await client.post("/transactions/import", json={
        "accounts": [{"source": "Brokerage elsewhere", "outside": True}],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": [{
            "account_source": "Brokerage elsewhere",
            "category_source": "Groceries",
            "dt": "2026-04-11",
            "amount": "-10.00",
        }],
    }, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == (
        "Rows cannot be written to an account source that is outside the tracked accounts: Brokerage elsewhere"
    )


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
