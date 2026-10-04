"""An import longer than one write chunk keeps every row's tags and every account's earliest date

The writer sends rows in chunks and links tags after each chunk's flush. A writer that dropped the
row at a chunk edge, linked tags within the first chunk only, kept dates per chunk, or kept each
account's latest date instead of its earliest would rebuild balances from the wrong day or lose tags
"""

from datetime import date, timedelta

from app.services.importers.shared.transaction_writer import IMPORT_WRITE_CHUNK
from tests.routes.transactions._helpers import _create_account, _setup_user_with_deps
from tests.routes.transactions._import_helpers import _import_run, _list_transactions


async def test_an_import_past_one_write_chunk_keeps_every_tag_and_each_account_s_earliest_date(client):
    """The first row holds one account's earliest date, and past the chunk sit a later row of that account and another account's only row."""
    headers, chequing_id, category_id = await _setup_user_with_deps(client)
    savings_id = (await _create_account(client, headers, name="Main Savings", account_type="savings")).json()["id"]

    # Every chequing row after the first is dated later, the last of them latest of all, so keeping
    # the latest date or the date of a later chunk would rebuild from after the first row
    chequing_rows = [
        {
            "account_source": "Chequing",
            "category_source": "Groceries",
            "dt": "2026-03-01" if index == 0 else (date(2026, 4, 1) + timedelta(days=index % 28)).isoformat(),
            "amount": "-1.00",
            "tag_names": ["imported"],
        }
        for index in range(IMPORT_WRITE_CHUNK)
    ]
    # A chequing row in the next chunk too, so a writer letting a later chunk's dates replace an
    # earlier chunk's would rebuild chequing from this row's day
    later_chequing_row = {**chequing_rows[1], "dt": "2026-05-01"}
    savings_row = {
        "account_source": "Savings",
        "category_source": "Groceries",
        "dt": "2026-03-15",
        "amount": "-7.00",
        "tag_names": ["imported", "boundary"],
    }

    resp = await _import_run(client, headers, {
        "accounts": [
            {"source": "Chequing", "account_id": chequing_id},
            {"source": "Savings", "account_id": savings_id},
        ],
        "categories": [{"source": "Groceries", "category_id": category_id}],
        "rows": [*chequing_rows, later_chequing_row, savings_row],
    })

    assert resp.status_code == 201, resp.text
    assert resp.json()["transactions_created"] == IMPORT_WRITE_CHUNK + 2
    assert resp.json()["affected_account_ids"] == sorted([chequing_id, savings_id])

    transactions = await _list_transactions(client, headers)
    assert len(transactions) == IMPORT_WRITE_CHUNK + 2
    tags_by_account = {}
    for transaction in transactions:
        tags_by_account.setdefault(transaction["account_id"], set()).add(
            tuple(sorted(tag["name"] for tag in transaction["tags"])),
        )
    assert tags_by_account == {chequing_id: {("imported",)}, savings_id: {("boundary", "imported")}}

    chequing_snapshots = (await client.get(f"/accounts/{chequing_id}/snapshots", headers=headers)).json()
    savings_snapshots = (await client.get(f"/accounts/{savings_id}/snapshots", headers=headers)).json()
    assert {"account_id": chequing_id, "dt": "2026-03-01", "balance": -100} in chequing_snapshots
    assert {"account_id": savings_id, "dt": "2026-03-15", "balance": -700} in savings_snapshots

    chequing = (await client.get(f"/accounts/{chequing_id}", headers=headers)).json()
    savings = (await client.get(f"/accounts/{savings_id}", headers=headers)).json()
    assert (chequing["current_balance"], savings["current_balance"]) == (-100 * (IMPORT_WRITE_CHUNK + 1), -700)
