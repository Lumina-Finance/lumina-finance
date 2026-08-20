import asyncio
import uuid

from sqlalchemy import text

from app.schemas.transaction import (
    MAX_IMPORT_BATCH_ROWS,
    MAX_IMPORT_MAPPINGS,
    MAX_IMPORT_NOTES_LENGTH,
    MAX_IMPORT_TAG_NAME_LENGTH,
    MAX_IMPORT_TAGS_PER_ROW,
)
from app.services.importers.generic import run_locking
from app.services.importers.generic.run_locking import load_locked_run
from app.services.merchants.defaults import (
    SELF_MERCHANT_NAME,
    UNKNOWN_MERCHANT_NAME,
)
from tests.conftest import TestSession
from tests.routes.support import _create_user, _get_auth_header, _get_system_merchant_id
from tests.routes.transactions._helpers import (
    NONEXISTENT_ID,
    _create_account,
    _create_category,
    _create_merchant,
    _create_tag,
    _get_system_category_id,
    _import_transactions,
    _seed_institution,
    _setup_user_with_deps,
)

# --- Staging a run and committing it ---


async def test_import_transactions_creates_records_and_recomputes_snapshots(client):
    """Import creates requested records, transactions, tags, and account snapshots."""
    institution = await _seed_institution()
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await _import_transactions(client, headers, {
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
    })

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

    resp = await _import_transactions(client, headers, {
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
    })

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


async def test_import_transactions_records_the_counterparty_account_on_a_transfer(client):
    """A transfer row that states a counterparty records it, and a row that states none says the money left."""
    headers, account_id, _ = await _setup_user_with_deps(client)
    savings_resp = await _create_account(client, headers, name="Main Savings", account_type="savings")
    savings_id = savings_resp.json()["id"]
    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")

    resp = await _import_transactions(client, headers, {
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
    })

    assert resp.status_code == 201
    transactions_resp = await client.get("/transactions", headers=headers)
    transactions_by_amount = {transaction["amount"]: transaction for transaction in transactions_resp.json()}
    assert transactions_by_amount[-50000]["counterparty_account_id"] == savings_id
    assert transactions_by_amount[-50000]["counterparty_account_scope"] == "tracked"

    # Nothing in the file points this leg at an account, so it records that the money left the
    # tracked accounts rather than arriving unanswered and blocking every later edit
    assert transactions_by_amount[50000]["counterparty_account_id"] is None
    assert transactions_by_amount[50000]["counterparty_account_scope"] == "outside"


async def test_import_transactions_records_an_account_it_creates_as_the_counterparty(client):
    """A counterparty account source can be a new account, which holds no rows of its own."""
    headers, account_id, _ = await _setup_user_with_deps(client)
    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")

    resp = await _import_transactions(client, headers, {
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
    })

    assert resp.status_code == 201
    data = resp.json()
    assert data["accounts_created"] == 1

    transaction = (await client.get("/transactions", headers=headers)).json()[0]
    assert transaction["counterparty_account_id"] == data["account_source_ids"]["Savings"]
    assert transaction["counterparty_account_scope"] == "tracked"


async def test_import_transactions_records_a_transfer_leaving_the_tracked_accounts(client):
    """A source mapped as outside records that the money left, without pointing at an account."""
    headers, account_id, _ = await _setup_user_with_deps(client)
    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")

    resp = await _import_transactions(client, headers, {
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
    })

    assert resp.status_code == 201
    assert resp.json()["accounts_created"] == 0
    transaction = (await client.get("/transactions", headers=headers)).json()[0]
    assert transaction["counterparty_account_id"] is None
    assert transaction["counterparty_account_scope"] == "outside"


async def test_import_transactions_rejects_a_counterparty_account_on_a_non_transfer_row(client):
    """Only a transfer records a counterparty, so an expense row that states one is refused."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    savings_resp = await _create_account(client, headers, name="Main Savings", account_type="savings")

    resp = await _import_transactions(client, headers, {
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
    })

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Only a transfer records a counterparty account: Savings"


async def test_import_transactions_rejects_a_transfer_recording_its_own_account(client):
    """Two sources mapped onto one account cannot record that account as its own counterparty."""
    headers, account_id, _ = await _setup_user_with_deps(client)
    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")

    resp = await _import_transactions(client, headers, {
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
    })

    assert resp.status_code == 422
    assert resp.json()["detail"] == "A transfer cannot record its own account as its counterparty: Chequing (old)"


async def test_import_transactions_rejects_an_unmapped_counterparty_source(client):
    """An undeclared value in the counterparty column is refused, saying which column it came from."""
    headers, account_id, _ = await _setup_user_with_deps(client)
    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")

    resp = await _import_transactions(client, headers, {
        "accounts": [{"source": "Chequing", "account_id": account_id}],
        "categories": [{"source": "Transfer", "category_id": transfer_category_id}],
        "rows": [{
            "account_source": "Chequing",
            "category_source": "Transfer",
            "dt": "2026-04-11",
            "amount": "-500.00",
            "counterparty_account_source": "Savings",
        }],
    })

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Counterparty account source is not mapped: Savings"


async def test_import_transactions_rejects_an_outside_source_that_also_names_an_account(client):
    """A source answers with exactly one of an account, a new account, or the outside answer."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _import_transactions(client, headers, {
        "accounts": [{"source": "Chequing", "account_id": account_id, "outside": True}],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": [{
            "account_source": "Chequing",
            "category_source": "Groceries",
            "dt": "2026-04-11",
            "amount": "-10.00",
        }],
    })

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account source must map to exactly one account action: Chequing"


async def test_import_transactions_rejects_rows_written_to_an_outside_source(client):
    """An outside source answers where money went and holds no rows of its own."""
    headers, _, category_id = await _setup_user_with_deps(client)

    resp = await _import_transactions(client, headers, {
        "accounts": [{"source": "Brokerage elsewhere", "outside": True}],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": [{
            "account_source": "Brokerage elsewhere",
            "category_source": "Groceries",
            "dt": "2026-04-11",
            "amount": "-10.00",
        }],
    })

    assert resp.status_code == 422
    assert resp.json()["detail"] == (
        "Rows cannot be written to an account source that is outside the tracked accounts: Brokerage elsewhere"
    )


async def test_import_transactions_rejects_unmapped_account_source(client):
    """Rows must reference a declared account source."""
    headers, _, category_id = await _setup_user_with_deps(client)

    resp = await _import_transactions(client, headers, {
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
    })

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account source is not mapped: Missing Account"


async def test_import_transactions_rejects_invalid_created_account_institution(client):
    """Import-created accounts must reference an existing institution."""
    headers, _, category_id = await _setup_user_with_deps(client)

    resp = await _import_transactions(client, headers, {
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
    })

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Institution not found"


async def test_import_transactions_rejects_invalid_raw_amount(client):
    """Imported amounts must be raw numeric strings with optional thousands separators."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _import_transactions(client, headers, {
        "accounts": [{"source": "Main Chequing", "account_id": account_id}],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": [{
            "account_source": "Main Chequing",
            "category_source": "Groceries",
            "dt": "2026-04-11",
            "amount": "$12.34",
        }],
    })

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid amount: $12.34"


async def test_import_transactions_rejects_archived_account_mapping(client):
    """Import cannot add new rows to an archived account."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    archive_resp = await client.patch(f"/accounts/{account_id}", json={"is_archived": True}, headers=headers)
    assert archive_resp.status_code == 200

    resp = await _import_transactions(client, headers, {
        "accounts": [{"source": "Main Chequing", "account_id": account_id}],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": [{
            "account_source": "Main Chequing",
            "category_source": "Groceries",
            "dt": "2026-04-11",
            "amount": "-10.00",
        }],
    })

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account is archived"


async def test_import_transactions_records_an_archived_account_as_the_counterparty(client):
    """A transfer can point at an archived account, because no row is written to it."""
    headers, account_id, _ = await _setup_user_with_deps(client)
    savings_resp = await _create_account(client, headers, name="Old Savings", account_type="savings")
    savings_id = savings_resp.json()["id"]
    archive_resp = await client.patch(f"/accounts/{savings_id}", json={"is_archived": True}, headers=headers)
    assert archive_resp.status_code == 200
    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")

    resp = await _import_transactions(client, headers, {
        "accounts": [
            {"source": "Chequing", "account_id": account_id},
            {"source": "Old Savings", "account_id": savings_id},
        ],
        "categories": [{"source": "Transfer", "category_id": transfer_category_id}],
        "rows": [{
            "account_source": "Chequing",
            "category_source": "Transfer",
            "dt": "2026-04-11",
            "amount": "-500.00",
            "counterparty_account_source": "Old Savings",
        }],
    })

    assert resp.status_code == 201
    transactions_resp = await client.get("/transactions", headers=headers)
    transaction = transactions_resp.json()[0]
    assert transaction["counterparty_account_id"] == savings_id
    assert transaction["counterparty_account_scope"] == "tracked"


async def test_import_transactions_rejects_an_archived_counterparty_that_also_takes_rows(client):
    """A source only resolves as a counterparty while no row in the same request is written to it."""
    headers, account_id, _ = await _setup_user_with_deps(client)
    savings_resp = await _create_account(client, headers, name="Old Savings", account_type="savings")
    savings_id = savings_resp.json()["id"]
    archive_resp = await client.patch(f"/accounts/{savings_id}", json={"is_archived": True}, headers=headers)
    assert archive_resp.status_code == 200
    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")

    resp = await _import_transactions(client, headers, {
        "accounts": [
            {"source": "Chequing", "account_id": account_id},
            {"source": "Old Savings", "account_id": savings_id},
        ],
        "categories": [{"source": "Transfer", "category_id": transfer_category_id}],
        "rows": [
            {
                "account_source": "Chequing",
                "category_source": "Transfer",
                "dt": "2026-04-11",
                "amount": "-500.00",
                "counterparty_account_source": "Old Savings",
            },
            {
                "account_source": "Old Savings",
                "category_source": "Transfer",
                "dt": "2026-04-13",
                "amount": "500.00",
            },
        ],
    })

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account is archived"


async def test_import_transactions_rejects_a_counterparty_in_another_users_account(client):
    """Resolving a counterparty still needs read access, so another user's account is unreachable."""
    headers, account_id, _ = await _setup_user_with_deps(client)
    _, other_account_id, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")
    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")

    resp = await _import_transactions(client, headers, {
        "accounts": [
            {"source": "Chequing", "account_id": account_id},
            {"source": "Theirs", "account_id": other_account_id},
        ],
        "categories": [{"source": "Transfer", "category_id": transfer_category_id}],
        "rows": [{
            "account_source": "Chequing",
            "category_source": "Transfer",
            "dt": "2026-04-11",
            "amount": "-500.00",
            "counterparty_account_source": "Theirs",
        }],
    })

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Account not found"


# --- What a run does across its calls ---


async def _open_run(client, headers, expected_transaction_count):
    """Open a run and return its id"""
    resp = await client.post(
        "/transactions/import/runs",
        json={"expected_transaction_count": expected_transaction_count},
        headers=headers,
    )
    assert resp.status_code == 201
    return resp.json()["id"]


def _batch(account_id, category_id, amounts, start_row_index=0):
    """Build one staging batch for the given amounts, all in one account and category"""
    return {
        "accounts": [{"source": "Main Chequing", "account_id": account_id}],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": [
            {
                "account_source": "Main Chequing",
                "category_source": "Groceries",
                "dt": "2026-04-10",
                "amount": amount,
                "tag_names": [],
            }
            for amount in amounts
        ],
        "start_row_index": start_row_index,
    }


async def test_staging_a_batch_twice_stages_its_rows_once(client):
    """A batch whose response was lost is re-sent at the same positions and absorbed."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 2)
    batch = _batch(account_id, category_id, ["-1.00", "-2.00"])

    first = await client.post(f"/transactions/import/runs/{run_id}/rows", json=batch, headers=headers)
    second = await client.post(f"/transactions/import/runs/{run_id}/rows", json=batch, headers=headers)
    commit = await client.post(f"/transactions/import/runs/{run_id}/commit", headers=headers)

    assert (first.status_code, second.status_code) == (204, 204)
    assert commit.status_code == 201
    assert commit.json()["transactions_created"] == 2
    assert len((await client.get("/transactions", headers=headers)).json()) == 2


async def test_staging_refuses_a_source_declared_differently_by_a_later_batch(client):
    """A source answered one way cannot be answered another way by a later batch."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 2)
    first_batch = _batch(account_id, category_id, ["-1.00"])
    second_batch = _batch(account_id, category_id, ["-2.00"], start_row_index=1)
    second_batch["accounts"] = [{
        "source": "Main Chequing",
        "create": {"name": "Main Chequing", "account_type": "credit_card", "currency": "CAD"},
    }]

    await client.post(f"/transactions/import/runs/{run_id}/rows", json=first_batch, headers=headers)
    resp = await client.post(f"/transactions/import/runs/{run_id}/rows", json=second_batch, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account source is declared twice with different answers: Main Chequing"


async def test_staging_refuses_a_batch_reaching_past_the_declared_row_count(client):
    """A batch running past the rows the run declared is refused rather than staged."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 1)

    resp = await client.post(
        f"/transactions/import/runs/{run_id}/rows",
        json=_batch(account_id, category_id, ["-1.00", "-2.00"]),
        headers=headers,
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "This batch reaches row 2 of an import declaring 1"


async def test_committing_a_run_missing_rows_is_refused(client):
    """A run whose file never fully arrived cannot be committed."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 3)
    await client.post(f"/transactions/import/runs/{run_id}/rows", json=_batch(account_id, category_id, ["-1.00"]), headers=headers)

    resp = await client.post(f"/transactions/import/runs/{run_id}/commit", headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "This import has 1 of its 3 rows staged"
    assert (await client.get("/transactions", headers=headers)).json() == []


async def test_staging_a_batch_over_the_row_cap_is_refused(client):
    """A batch larger than one insert can carry is refused rather than failing inside the driver."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    oversized = MAX_IMPORT_BATCH_ROWS + 1
    run_id = await _open_run(client, headers, oversized)

    resp = await client.post(
        f"/transactions/import/runs/{run_id}/rows",
        json=_batch(account_id, category_id, ["-1.00"] * oversized),
        headers=headers,
    )

    assert resp.status_code == 422


async def test_a_row_stating_no_payee_is_stamped_with_the_unknown_merchant(client):
    """A file with no payee for a row still writes a transaction carrying a merchant."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    unknown_merchant_id = await _get_system_merchant_id(client, headers, UNKNOWN_MERCHANT_NAME)

    resp = await _import_rows(client, headers, account_id, category_id, [{}])

    assert resp.status_code == 201
    transaction = (await client.get("/transactions", headers=headers)).json()[0]
    assert transaction["merchant_id"] == unknown_merchant_id
    assert transaction["merchant_name"] == UNKNOWN_MERCHANT_NAME


async def test_a_transfer_stating_no_payee_is_stamped_with_the_self_merchant(client):
    """A transfer has no payee of its own, so it gets what the app puts on its own transfers."""
    headers, account_id, _ = await _setup_user_with_deps(client)
    transfer_category_id = await _get_system_category_id(client, headers, "Transfer")
    self_merchant_id = await _get_system_merchant_id(client, headers, SELF_MERCHANT_NAME)

    resp = await _import_transactions(client, headers, {
        "accounts": [{"source": "Main Chequing", "account_id": account_id}],
        "categories": [{"source": "Transfer", "category_id": transfer_category_id}],
        "rows": [{
            "account_source": "Main Chequing",
            "category_source": "Transfer",
            "dt": "2026-04-10",
            "amount": "-50.00",
            "tag_names": [],
        }],
    })

    assert resp.status_code == 201
    transaction = (await client.get("/transactions", headers=headers)).json()[0]
    assert transaction["merchant_id"] == self_merchant_id


async def test_a_stamped_merchant_counts_as_neither_created_nor_reused(client):
    """The summary reports what the file's own values matched, and a stamped merchant matched none."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _import_rows(client, headers, account_id, category_id, [{}, {}])

    assert resp.status_code == 201
    assert resp.json()["merchants_created"] == 0
    assert resp.json()["merchants_reused"] == 0
    assert resp.json()["created_merchant_ids"] == []


async def test_a_row_imported_without_a_payee_can_then_be_edited(client):
    """The edit route demands a merchant, so an imported row has to arrive holding one."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _import_rows(client, headers, account_id, category_id, [{}])
    transaction_id = (await client.get("/transactions", headers=headers)).json()[0]["id"]

    resp = await client.patch(f"/transactions/{transaction_id}", json={"notes": "Checked"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["notes"] == "Checked"


async def test_a_payee_matching_a_shared_merchant_reuses_it(client):
    """A file whose payee is a merchant shipping with the app reuses it rather than copying it."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    system_merchant_id = await _get_system_merchant_id(client, headers)

    resp = await _import_rows(client, headers, account_id, category_id, [{"merchant_name": "Myself"}])

    assert resp.status_code == 201
    assert resp.json()["merchants_created"] == 0
    assert resp.json()["merchants_reused"] == 1
    transaction = (await client.get("/transactions", headers=headers)).json()[0]
    assert transaction["merchant_id"] == system_merchant_id


async def test_a_payee_spelled_differently_from_an_existing_merchant_reuses_it(client):
    """Capitalisation does not make a second merchant, matching what the merchants route refuses."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    created = await _create_merchant(client, headers, name="Corner Cafe")

    resp = await _import_rows(client, headers, account_id, category_id, [{"merchant_name": "CORNER CAFE"}])

    assert resp.status_code == 201
    assert resp.json()["merchants_created"] == 0
    transaction = (await client.get("/transactions", headers=headers)).json()[0]
    assert transaction["merchant_id"] == created.json()["id"]
    assert transaction["merchant_name"] == "Corner Cafe"


async def test_a_payee_matching_a_personal_and_a_shared_merchant_resolves_to_the_shared_one(client):
    """A name a shared merchant holds is taken in every scope, so the shared one wins the match."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    self_merchant_id = await _get_system_merchant_id(client, headers, SELF_MERCHANT_NAME)
    sibling = await _create_merchant(client, headers, name="Corner Cafe")
    await _insert_personal_merchant_beside_a_shared_one(sibling.json()["id"], SELF_MERCHANT_NAME.lower())

    resp = await _import_rows(client, headers, account_id, category_id, [
        {"merchant_name": SELF_MERCHANT_NAME.upper()},
        {"merchant_name": SELF_MERCHANT_NAME.lower()},
    ])

    assert resp.status_code == 201
    assert resp.json()["merchants_created"] == 0
    transactions = (await client.get("/transactions", headers=headers)).json()
    # Both rows land on the merchant that ships with the app rather than the personal one
    assert {transaction["merchant_id"] for transaction in transactions} == {self_merchant_id}


async def test_a_category_source_creating_a_name_the_user_already_has_reuses_it(client):
    """Capitalisation does not make a second category, matching what the categories route refuses."""
    headers, account_id, _ = await _setup_user_with_deps(client)
    existing = await _create_category(client, headers, name="Hardware Store", kind="expense")

    resp = await _import_transactions(client, headers, {
        "accounts": [{"source": "Main Chequing", "account_id": account_id}],
        "categories": [{"source": "HARDWARE STORE", "create": {"name": "HARDWARE STORE", "kind": "expense"}}],
        "rows": [{
            "account_source": "Main Chequing",
            "category_source": "HARDWARE STORE",
            "dt": "2026-04-10",
            "amount": "-1.00",
            "tag_names": [],
        }],
    })

    assert resp.status_code == 201
    assert (resp.json()["categories_created"], resp.json()["categories_reused"]) == (0, 1)
    transaction = (await client.get("/transactions", headers=headers)).json()[0]
    assert transaction["category_id"] == existing.json()["id"]


async def test_a_category_source_creating_a_name_recording_the_other_direction_is_refused(client):
    """One name records one direction, so the refusal says which and what to do about it."""
    headers, account_id, _ = await _setup_user_with_deps(client)
    await _create_category(client, headers, name="Bonus", kind="income")

    resp = await _import_transactions(client, headers, {
        "accounts": [{"source": "Main Chequing", "account_id": account_id}],
        "categories": [{"source": "Bonus", "create": {"name": "Bonus", "kind": "expense"}}],
        "rows": [{
            "account_source": "Main Chequing",
            "category_source": "Bonus",
            "dt": "2026-04-10",
            "amount": "-1.00",
            "tag_names": [],
        }],
    })

    assert resp.status_code == 422
    assert resp.json()["detail"] == (
        "A category named Bonus already records income, so this import cannot create Bonus as "
        "expense. Match this value to that category, or set its type to income."
    )
    assert (await client.get("/transactions", headers=headers)).json() == []


async def test_a_payee_answered_with_an_existing_merchant_is_filed_under_it(client):
    """A descriptor reading nothing like the merchant still lands on the one the user picked."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    chosen = (await _create_merchant(client, headers, name="Corner Cafe")).json()

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"merchant_name": "SQ *COFFEE 4471 TORONTO"}],
        merchants=[{"source": "SQ *COFFEE 4471 TORONTO", "merchant_id": chosen["id"]}],
    )

    assert resp.status_code == 201
    assert resp.json()["merchants_created"] == 0
    transaction = (await client.get("/transactions", headers=headers)).json()[0]
    assert transaction["merchant_id"] == chosen["id"]


async def test_a_payee_answered_with_a_corrected_name_is_created_under_that_name(client):
    """The bank's descriptor is not what gets stored when the user writes a name for it."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"merchant_name": "SQ *COFFEE 4471 TORONTO"}],
        merchants=[{"source": "SQ *COFFEE 4471 TORONTO", "create": {"name": "Coffee Bar"}}],
    )

    assert resp.status_code == 201
    assert resp.json()["merchants_created"] == 1
    merchants = (await client.get("/merchants", headers=headers)).json()
    assert [merchant["name"] for merchant in merchants if not merchant["is_system"]] == ["Coffee Bar"]
    transaction = (await client.get("/transactions", headers=headers)).json()[0]
    assert transaction["merchant_name"] == "Coffee Bar"


async def test_two_payees_corrected_to_one_name_make_one_merchant(client):
    """Two descriptors for one shop are the case the step exists for, so they end up as one record."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"merchant_name": "SQ *COFFEE 4471 05/14"}, {"merchant_name": "SQ *COFFEE 4471 06/02"}],
        merchants=[
            {"source": "SQ *COFFEE 4471 05/14", "create": {"name": "Coffee Bar"}},
            {"source": "SQ *COFFEE 4471 06/02", "create": {"name": "Coffee Bar"}},
        ],
    )

    assert resp.status_code == 201
    assert resp.json()["merchants_created"] == 1
    transactions = (await client.get("/transactions", headers=headers)).json()
    assert len({transaction["merchant_id"] for transaction in transactions}) == 1


async def test_a_payee_answered_skip_is_filed_under_the_shared_merchant(client):
    """Skipping a value writes no merchant for it, and its rows read as rows stating no payee."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    unknown_merchant_id = await _get_system_merchant_id(client, headers, UNKNOWN_MERCHANT_NAME)

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"merchant_name": "SQ *COFFEE 4471 TORONTO"}],
        merchants=[{"source": "SQ *COFFEE 4471 TORONTO", "skip": True}],
    )

    assert resp.status_code == 201
    # Neither created nor reused, since a stamped merchant matched nothing the file stated
    assert (resp.json()["merchants_created"], resp.json()["merchants_reused"]) == (0, 0)
    transaction = (await client.get("/transactions", headers=headers)).json()[0]
    assert transaction["merchant_id"] == unknown_merchant_id


async def test_a_payee_answered_with_a_merchant_the_user_cannot_see_is_refused(client):
    """Answering a value cannot reach a merchant that matching one could not have reached."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_headers, _, _ = await _setup_user_with_deps(client, email="other-import@example.com", name_prefix="Other")
    other_merchant = (await _create_merchant(client, other_headers, name="Their Cafe")).json()

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"merchant_name": "SQ *COFFEE 4471 TORONTO"}],
        merchants=[{"source": "SQ *COFFEE 4471 TORONTO", "merchant_id": other_merchant["id"]}],
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Merchant not found"
    assert (await client.get("/transactions", headers=headers)).json() == []


async def test_answering_one_payee_under_two_spellings_in_one_batch_is_refused(client):
    """Both spellings resolve to one merchant, so two answers leave nothing to say which one wins."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"merchant_name": "Bakery"}],
        merchants=[
            {"source": "Bakery", "create": {"name": "Bakery"}},
            {"source": "BAKERY", "skip": True},
        ],
    )

    assert resp.status_code == 422
    assert "declared twice with different answers" in resp.json()["detail"]


async def test_a_payee_answer_stating_two_actions_is_refused(client):
    """One value gets one answer, so a mapping stating a merchant and a name at once is refused."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    chosen = (await _create_merchant(client, headers, name="Corner Cafe")).json()

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"merchant_name": "Bakery"}],
        merchants=[{"source": "Bakery", "merchant_id": chosen["id"], "create": {"name": "Bakery"}}],
    )

    assert resp.status_code == 422
    assert "exactly one merchant action" in resp.json()["detail"]


async def test_a_payee_answered_with_a_name_that_ships_with_the_app_reuses_that_merchant(client):
    """A shared merchant's name is taken in every scope, so answering with it cannot write a second."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    self_merchant_id = await _get_system_merchant_id(client, headers, SELF_MERCHANT_NAME)

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"merchant_name": "TFR TO SAVINGS 0012"}],
        merchants=[{"source": "TFR TO SAVINGS 0012", "create": {"name": SELF_MERCHANT_NAME.lower()}}],
    )

    assert resp.status_code == 201
    assert resp.json()["merchants_created"] == 0
    assert [merchant["name"] for merchant in (await client.get("/merchants", headers=headers)).json()
            if not merchant["is_system"]] == []
    transaction = (await client.get("/transactions", headers=headers)).json()[0]
    assert transaction["merchant_id"] == self_merchant_id


async def test_a_payee_answered_with_a_name_the_user_already_has_reuses_that_merchant(client):
    """Correcting a descriptor onto a merchant they already have is the same as picking it."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    existing = (await _create_merchant(client, headers, name="Corner Cafe")).json()

    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"merchant_name": "SQ *COFFEE 4471"}],
        merchants=[{"source": "SQ *COFFEE 4471", "create": {"name": "CORNER CAFE"}}],
    )

    assert resp.status_code == 201
    assert resp.json()["merchants_created"] == 0
    transaction = (await client.get("/transactions", headers=headers)).json()[0]
    assert transaction["merchant_id"] == existing["id"]


async def test_answering_a_payee_named_like_a_shared_merchant_leaves_the_stamped_rows_alone(client):
    """A row stating no payee is stamped from the merchants that ship with the app, not the lookup."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    unknown_merchant_id = await _get_system_merchant_id(client, headers, UNKNOWN_MERCHANT_NAME)
    chosen = (await _create_merchant(client, headers, name="Corner Cafe")).json()

    # The file's own payee reads as the shared merchant's name, and is answered with another
    # merchant, which takes that name over in the lookup the rows are matched through
    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"merchant_name": UNKNOWN_MERCHANT_NAME, "amount": "-1.00"}, {"amount": "-2.00"}],
        merchants=[{"source": UNKNOWN_MERCHANT_NAME, "merchant_id": chosen["id"]}],
    )

    assert resp.status_code == 201
    transactions = (await client.get("/transactions", headers=headers)).json()
    merchants_by_amount = {transaction["amount"]: transaction["merchant_id"] for transaction in transactions}

    # The answered value goes where it was pointed, and the row stating no payee is still stamped
    # with the shared merchant rather than with what took that name over in the lookup
    assert merchants_by_amount == {-100: chosen["id"], -200: unknown_merchant_id}


async def test_a_payee_pointed_at_a_merchant_does_not_take_another_payees_new_name(client):
    """What a value resolves to and what merchants exist are separate questions, keyed separately."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    chosen = (await _create_merchant(client, headers, name="Corner Cafe")).json()

    # The first value is pointed at a merchant, and the second is created under a name reading like
    # the first value. Answered against one lookup, the second would land on the first one's merchant
    resp = await _import_rows(
        client,
        headers,
        account_id,
        category_id,
        [{"merchant_name": "Amazon", "amount": "-1.00"}, {"merchant_name": "SQ *AMZN 88", "amount": "-2.00"}],
        merchants=[
            {"source": "Amazon", "merchant_id": chosen["id"]},
            {"source": "SQ *AMZN 88", "create": {"name": "Amazon"}},
        ],
    )

    assert resp.status_code == 201
    assert resp.json()["merchants_created"] == 1
    transactions = (await client.get("/transactions", headers=headers)).json()
    merchants_by_amount = {transaction["amount"]: transaction["merchant_name"] for transaction in transactions}
    assert merchants_by_amount == {-100: "Corner Cafe", -200: "Amazon"}


async def test_two_batches_answering_one_payee_differently_are_refused_at_staging(client):
    """Both spellings are one payee, so the clash is caught while staging rather than at the commit."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 2)

    first = _batch(account_id, category_id, ["-1.00"])
    first["merchants"] = [{"source": "Amazon", "skip": True}]
    second = _batch(account_id, category_id, ["-2.00"], start_row_index=1)
    second["merchants"] = [{"source": "AMAZON", "create": {"name": "Amazon"}}]

    first_resp = await client.post(f"/transactions/import/runs/{run_id}/rows", json=first, headers=headers)
    second_resp = await client.post(f"/transactions/import/runs/{run_id}/rows", json=second, headers=headers)

    assert first_resp.status_code == 204
    assert second_resp.status_code == 422
    assert "declared twice with different answers" in second_resp.json()["detail"]


async def test_an_import_is_refused_when_a_shared_merchant_is_not_seeded(client):
    """A database migrated but never seeded fails loudly instead of writing rows with no merchant."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    async with TestSession() as session:
        await session.execute(
            text("DELETE FROM merchants WHERE is_system = true AND name = :name"),
            {"name": UNKNOWN_MERCHANT_NAME},
        )
        await session.commit()

    resp = await _import_rows(client, headers, account_id, category_id, [{}])

    assert resp.status_code == 500
    assert resp.json()["detail"] == f"{UNKNOWN_MERCHANT_NAME} merchant is not configured"
    assert (await client.get("/transactions", headers=headers)).json() == []


async def test_two_spellings_of_one_payee_in_a_file_make_one_merchant(client):
    """A file carrying both spellings creates one merchant, under the spelling it uses first."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _import_rows(client, headers, account_id, category_id, [
        {"merchant_name": "Bakery"},
        {"merchant_name": "BAKERY"},
    ])

    assert resp.status_code == 201
    assert resp.json()["merchants_created"] == 1
    merchants = (await client.get("/merchants", headers=headers)).json()
    assert [merchant["name"] for merchant in merchants if not merchant["is_system"]] == ["Bakery"]
    transactions = (await client.get("/transactions", headers=headers)).json()
    assert len({transaction["merchant_id"] for transaction in transactions}) == 1


async def test_staging_a_batch_over_the_mapping_cap_is_refused(client):
    """A batch declaring more mappings than an import may carry is refused before any is checked."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 1)
    batch = _batch(account_id, category_id, ["-1.00"])
    batch["categories"] += _category_mappings(range(MAX_IMPORT_MAPPINGS))

    resp = await client.post(f"/transactions/import/runs/{run_id}/rows", json=batch, headers=headers)

    assert resp.status_code == 422


async def test_staging_refuses_more_mappings_than_an_import_may_declare_across_batches(client):
    """Two batches each under the cap cannot together leave the run holding more than it."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 2)
    half = MAX_IMPORT_MAPPINGS // 2 + 1

    first_batch = _batch(account_id, category_id, ["-1.00"])
    first_batch["categories"] += _category_mappings(range(half))
    second_batch = _batch(account_id, category_id, ["-2.00"], start_row_index=1)
    second_batch["categories"] += _category_mappings(range(half, half * 2))

    first = await client.post(f"/transactions/import/runs/{run_id}/rows", json=first_batch, headers=headers)
    second = await client.post(f"/transactions/import/runs/{run_id}/rows", json=second_batch, headers=headers)

    assert first.status_code == 204
    assert second.status_code == 422
    # The run already held the Groceries mapping every batch declares, so the total runs one past
    # the two halves
    assert second.json()["detail"] == (
        f"This import declares {half * 2 + 1} distinct values for Category source, "
        f"and the limit is {MAX_IMPORT_MAPPINGS}"
    )


async def test_staging_a_row_whose_notes_are_too_long_is_refused(client):
    """A note past the cap is refused as its batch is staged rather than at the commit."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 1)
    batch = _batch(account_id, category_id, ["-1.00"])
    batch["rows"][0]["notes"] = "n" * (MAX_IMPORT_NOTES_LENGTH + 1)

    resp = await client.post(f"/transactions/import/runs/{run_id}/rows", json=batch, headers=headers)

    assert resp.status_code == 422


async def test_staging_a_row_carrying_too_many_tags_is_refused(client):
    """A row naming more tags than the cap allows is refused rather than creating them all."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 1)
    batch = _batch(account_id, category_id, ["-1.00"])
    batch["rows"][0]["tag_names"] = [f"Tag {index}" for index in range(MAX_IMPORT_TAGS_PER_ROW + 1)]

    resp = await client.post(f"/transactions/import/runs/{run_id}/rows", json=batch, headers=headers)

    assert resp.status_code == 422


async def test_staging_a_row_whose_tag_name_is_too_long_is_refused(client):
    """A tag name past the column it is stored in is refused at staging, not at the commit."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 1)
    batch = _batch(account_id, category_id, ["-1.00"])
    batch["rows"][0]["tag_names"] = ["t" * (MAX_IMPORT_TAG_NAME_LENGTH + 1)]

    resp = await client.post(f"/transactions/import/runs/{run_id}/rows", json=batch, headers=headers)

    assert resp.status_code == 422


async def test_staging_accepts_a_row_at_every_row_cap(client):
    """The row values sitting exactly on each cap are accepted, so the bound refuses only past it."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 1)
    batch = _batch(account_id, category_id, ["-1.00"])
    batch["rows"][0]["notes"] = "n" * MAX_IMPORT_NOTES_LENGTH
    batch["rows"][0]["tag_names"] = [
        f"{index}".ljust(MAX_IMPORT_TAG_NAME_LENGTH, "t") for index in range(MAX_IMPORT_TAGS_PER_ROW)
    ]

    resp = await client.post(f"/transactions/import/runs/{run_id}/rows", json=batch, headers=headers)

    assert resp.status_code == 204


async def test_staging_accepts_a_run_holding_exactly_the_mapping_cap(client):
    """A run sitting on the mapping cap is staged, so the bound refuses only past it."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 1)
    batch = _batch(account_id, category_id, ["-1.00"])
    # One short of the cap, since the batch already declares the Groceries mapping its row uses
    batch["categories"] += _category_mappings(range(MAX_IMPORT_MAPPINGS - 1))

    resp = await client.post(f"/transactions/import/runs/{run_id}/rows", json=batch, headers=headers)

    assert resp.status_code == 204


def _category_mappings(indexes):
    """Build category mappings creating one new category per index"""
    return [
        {"source": f"Category {index}", "create": {"name": f"Category {index}", "kind": "expense"}}
        for index in indexes
    ]


async def _insert_personal_merchant_beside_a_shared_one(sibling_merchant_id, name):
    """Write a personal merchant holding a name a merchant shipping with the app already holds

    The merchants route refuses that name in every scope, so a database holding both can only be
    built by writing straight to the table. The unique indexes still allow the pair, since each
    scope has an index of its own, which is what a database looks like where someone had their own
    merchant before the app shipped one reading the same

    Stamped a day earlier than the shared merchant, so a match landing on the shared one proves the
    rule that a shared merchant wins rather than the one that a rule of oldest-first would give

    Args:
        sibling_merchant_id: A merchant of the owner this one belongs to
        name: Name for the new merchant
    """
    async with TestSession() as session:
        owner_id = (await session.execute(
            text("SELECT owner_id FROM merchants WHERE id = :id"),
            {"id": sibling_merchant_id},
        )).scalar_one()
        await session.execute(
            text(
                "INSERT INTO merchants (id, owner_id, name, created_at)"
                " VALUES (gen_random_uuid(), :owner_id, :name, now() - interval '1 day')",
            ),
            {"owner_id": owner_id, "name": name},
        )
        await session.commit()


async def _import_rows(client, headers, account_id, category_id, row_overrides, merchants=None):
    """Import one file of rows sharing an account and category, each row taking its own overrides"""
    return await _import_transactions(client, headers, {
        "accounts": [{"source": "Main Chequing", "account_id": account_id}],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "merchants": merchants or [],
        "rows": [
            {
                "account_source": "Main Chequing",
                "category_source": "Groceries",
                "dt": "2026-04-10",
                "amount": "-1.00",
                "tag_names": [],
            } | overrides
            for overrides in row_overrides
        ],
    })


async def test_committing_twice_answers_from_the_first_commit(client):
    """A commit whose response was lost is repeated without importing the file again."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 1)
    await client.post(f"/transactions/import/runs/{run_id}/rows", json=_batch(account_id, category_id, ["-1.00"]), headers=headers)

    first = await client.post(f"/transactions/import/runs/{run_id}/commit", headers=headers)
    second = await client.post(f"/transactions/import/runs/{run_id}/commit", headers=headers)

    assert (first.status_code, second.status_code) == (201, 201)
    assert second.json() == first.json()
    assert len((await client.get("/transactions", headers=headers)).json()) == 1


async def test_a_row_the_mappings_cannot_satisfy_leaves_nothing_written(client):
    """One unusable row in a staged file stops the whole file reaching the ledger."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 2)
    batch = _batch(account_id, category_id, ["-1.00", "$2.00"])
    await client.post(f"/transactions/import/runs/{run_id}/rows", json=batch, headers=headers)

    resp = await client.post(f"/transactions/import/runs/{run_id}/commit", headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Invalid amount: $2.00"
    assert (await client.get("/transactions", headers=headers)).json() == []


async def test_deleting_a_run_drops_what_it_staged(client):
    """A cancelled import leaves nothing behind to commit."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 1)
    await client.post(f"/transactions/import/runs/{run_id}/rows", json=_batch(account_id, category_id, ["-1.00"]), headers=headers)

    deleted = await client.delete(f"/transactions/import/runs/{run_id}", headers=headers)
    commit = await client.post(f"/transactions/import/runs/{run_id}/commit", headers=headers)

    assert deleted.status_code == 204
    assert commit.status_code == 404
    assert (await client.get("/transactions", headers=headers)).json() == []


async def test_deleting_a_committed_run_is_refused(client):
    """Rows already in the ledger are not this endpoint's to remove."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 1)
    await client.post(f"/transactions/import/runs/{run_id}/rows", json=_batch(account_id, category_id, ["-1.00"]), headers=headers)
    await client.post(f"/transactions/import/runs/{run_id}/commit", headers=headers)

    resp = await client.delete(f"/transactions/import/runs/{run_id}", headers=headers)

    assert resp.status_code == 409
    assert resp.json()["detail"] == "This import has already been committed"
    assert len((await client.get("/transactions", headers=headers)).json()) == 1


async def test_another_users_run_is_out_of_reach(client):
    """A run is only reachable by the user who opened it."""
    owner_headers, account_id, category_id = await _setup_user_with_deps(client)
    other_headers, _, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")
    run_id = await _open_run(client, owner_headers, 1)

    staged = await client.post(
        f"/transactions/import/runs/{run_id}/rows",
        json=_batch(account_id, category_id, ["-1.00"]),
        headers=other_headers,
    )
    committed = await client.post(f"/transactions/import/runs/{run_id}/commit", headers=other_headers)
    deleted = await client.delete(f"/transactions/import/runs/{run_id}", headers=other_headers)

    assert (staged.status_code, committed.status_code, deleted.status_code) == (404, 404, 404)


async def test_reuse_counts_leave_out_records_the_import_created(client):
    """A merchant one row creates and the next row meets again is created once and reused none."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _import_transactions(client, headers, {
        "accounts": [{"source": "Main Chequing", "account_id": account_id}],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": [
            {
                "account_source": "Main Chequing",
                "category_source": "Groceries",
                "dt": "2026-04-10",
                "amount": "-1.00",
                "merchant_name": "Corner Cafe",
                "tag_names": ["Lunch"],
            },
            {
                "account_source": "Main Chequing",
                "category_source": "Groceries",
                "dt": "2026-04-11",
                "amount": "-2.00",
                "merchant_name": "Corner Cafe",
                "tag_names": ["Lunch"],
            },
        ],
    })

    assert resp.status_code == 201
    data = resp.json()
    assert (data["merchants_created"], data["merchants_reused"]) == (1, 0)
    assert (data["tags_created"], data["tags_reused"]) == (1, 0)

    # The account and category existed before the import, so both count as reused once rather than
    # once per row that referenced them
    assert (data["accounts_created"], data["accounts_reused"]) == (0, 1)
    assert (data["categories_created"], data["categories_reused"]) == (0, 1)


async def test_a_run_another_request_holds_is_refused(client, monkeypatch):
    """A request that cannot get the run within the wait is refused rather than queued behind it."""
    monkeypatch.setattr(run_locking, "RUN_LOCK_WAIT", "100ms")
    headers, _, _ = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 1)

    # Held open for the length of the request below, which is what the request has to wait on. The
    # request is bounded so that a wait that never gives up fails this test rather than hanging it
    async with TestSession() as holder:
        await holder.execute(text("SELECT id FROM import_runs WHERE id = :id FOR UPDATE"), {"id": run_id})
        async with asyncio.timeout(5):
            resp = await client.delete(f"/transactions/import/runs/{run_id}", headers=headers)
        await holder.rollback()

    assert resp.status_code == 409
    assert resp.json()["detail"] == "This import is already being worked on"


async def test_holding_a_run_does_not_bound_the_locks_taken_after_it(client):
    """The wait for the run is the only lock it bounds, so a later one is not cut short."""
    headers, _, _ = await _setup_user_with_deps(client)
    run_id = await _open_run(client, headers, 1)

    async with TestSession() as session:
        await load_locked_run(session, uuid.UUID(run_id))
        lock_timeout = (await session.execute(text("SELECT current_setting('lock_timeout')"))).scalar_one()

    # Left in place, this bound would cancel any later lock the same transaction waited on, which
    # for a commit is every account snapshot and cache row the import touches
    assert lock_timeout == "0"


async def test_an_import_across_two_accounts_recomputes_each_from_its_own_earliest_row(client):
    """Each account rebuilds from the earliest row it received, not from the first row of the file."""
    headers, chequing_id, category_id = await _setup_user_with_deps(client)
    savings_resp = await _create_account(client, headers, name="Main Savings", account_type="savings")
    savings_id = savings_resp.json()["id"]

    # The rows for each account are given latest first, so an import that kept the first date it saw
    # would rebuild from the later one and never write a snapshot for the earlier row at all
    rows = [
        {"account_source": "Chequing", "category_source": "Groceries", "dt": "2026-04-20", "amount": "-10.00"},
        {"account_source": "Chequing", "category_source": "Groceries", "dt": "2026-04-10", "amount": "-5.00"},
        {"account_source": "Savings", "category_source": "Groceries", "dt": "2026-04-22", "amount": "-20.00"},
        {"account_source": "Savings", "category_source": "Groceries", "dt": "2026-04-12", "amount": "-30.00"},
    ]

    # Whichever account sorts later is named first, so the order the accounts are reached in is the
    # reverse of the sorted order and dropping the sort fails this rather than passing on the ids
    # that happened to come up
    if chequing_id < savings_id:
        rows = rows[2:] + rows[:2]

    resp = await _import_transactions(client, headers, {
        "accounts": [
            {"source": "Chequing", "account_id": chequing_id},
            {"source": "Savings", "account_id": savings_id},
        ],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": rows,
    })

    assert resp.status_code == 201
    assert resp.json()["affected_account_ids"] == sorted([chequing_id, savings_id])

    chequing_snapshots = (await client.get(f"/accounts/{chequing_id}/snapshots", headers=headers)).json()
    savings_snapshots = (await client.get(f"/accounts/{savings_id}/snapshots", headers=headers)).json()

    assert {"account_id": chequing_id, "dt": "2026-04-10", "balance": -500} in chequing_snapshots
    assert {"account_id": chequing_id, "dt": "2026-04-20", "balance": -1500} in chequing_snapshots
    assert {"account_id": savings_id, "dt": "2026-04-12", "balance": -3000} in savings_snapshots
    assert {"account_id": savings_id, "dt": "2026-04-22", "balance": -5000} in savings_snapshots
