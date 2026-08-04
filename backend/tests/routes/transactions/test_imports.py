
import asyncio
import uuid

from sqlalchemy import text

from app.services.importers.generic import run_locking
from app.services.importers.generic.run_locking import load_locked_run
from tests.conftest import TestSession
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import (
    NONEXISTENT_ID,
    _create_account,
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

    assert resp.status_code == 409
    assert resp.json()["detail"] == "This import has 1 of its 3 rows staged"
    assert (await client.get("/transactions", headers=headers)).json() == []


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
