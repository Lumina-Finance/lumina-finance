"""An OFX import leaves out a bank transaction its account already holds

Matched by the hash of the bank's ID with the bank account the statement names and nothing else, so
an overlapping statement adds only what is new and two genuine look-alike purchases still both import
"""

import asyncio
import hashlib
import hmac
import os
import re
import uuid

from sqlalchemy import event, select, text

from app.models.transaction import Transaction
from app.services.importers.generic import service as generic_service
from app.services.transactions import bulk_update as bulk_update_module
from app.services.transactions import update as update_module
from tests.conftest import TestSession, scoped_engine
from tests.routes.support import _wait_until_blocked
from tests.routes.transactions._helpers import _create_account, _setup_user_with_deps
from tests.routes.transactions._import_helpers import (
    _commit_run,
    _import_run,
    _list_transactions,
    _open_run,
    _open_staged_run,
    _stage_batch,
)

# A bank account as an OFX statement names it
_CHEQUING_KEY = "bank:021000021:000111222333"

# The server's bank transaction hash key, from the test environment
_TEST_KEY = bytes.fromhex(os.environ["BANK_TRANSACTION_HASH_KEY"])


def _bank_hash(bank_transaction_id):
    """The digest the import page sends for a chequing transaction with this bank ID, or None for none"""
    if bank_transaction_id is None:
        return None
    return hashlib.sha256(f"{_CHEQUING_KEY}\0{bank_transaction_id}".encode()).hexdigest()


def _stored_hash(bank_transaction_id):
    """What the server keeps for a chequing transaction with this bank ID: the page's digest, keyed"""
    return hmac.new(_TEST_KEY, bytes.fromhex(_bank_hash(bank_transaction_id)), hashlib.sha256).hexdigest()


def _ofx_payload(account_id, category_id, rows):
    """Build an OFX import into one existing account from (bank ID, date, amount) rows"""
    return {
        "accounts": [{"source": "Statement", "account_id": account_id}],
        "categories": [{"source": "Spending", "category_id": category_id}],
        "rows": [
            {
                "account_source": "Statement",
                "category_source": "Spending",
                "dt": dt,
                "amount": amount,
                "merchant_name": f"Payee {bank_transaction_id}",
                "tag_names": [],
                "bank_transaction_hash": _bank_hash(bank_transaction_id),
            }
            for bank_transaction_id, dt, amount in rows
        ],
    }


def _march(first_day, last_day):
    """Rows for one transaction a day, each with its own bank ID, from one March day to another"""
    return [(f"M{day}", f"2026-03-{day:02d}", "-10.00") for day in range(first_day, last_day + 1)]


# Ten instalments of one purchase, each with its own bank ID, on one day for one amount
_INSTALMENTS = [(f"I{number}", "2026-03-05", "-25.00") for number in range(10)]


async def _import_ofx(client, headers, payload):
    return await _import_run(client, headers, payload, source="ofx")


async def _balance(client, headers, account_id):
    accounts = (await client.get("/accounts", headers=headers)).json()
    return next(account for account in accounts if account["id"] == account_id)["current_balance"]


async def _ledger(client, headers, account_id):
    """The date and merchant of every transaction in the account, in date order"""
    return [
        (transaction["dt"], transaction["merchant_name"])
        for transaction in await _list_transactions(client, headers)
        if transaction["account_id"] == account_id
    ]


async def test_a_full_statement_after_part_of_it_adds_only_the_rest_and_keeps_every_instalment(client):
    """Examples 1 and 2: an overlap imported twice doubles the balance, and look-alikes must not merge"""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    first = await _import_ofx(client, headers, _ofx_payload(account_id, category_id, [*_march(1, 15), *_INSTALMENTS]))
    assert first.status_code == 201, first.text
    assert (first.json()["transactions_created"], first.json()["transactions_already_imported"]) == (25, 0)

    full = await _import_ofx(client, headers, _ofx_payload(account_id, category_id, [*_march(1, 31), *_INSTALMENTS]))

    assert full.status_code == 201, full.text
    assert (full.json()["transactions_created"], full.json()["transactions_already_imported"]) == (16, 25)
    ledger = await _ledger(client, headers, account_id)
    assert len(ledger) == 41
    assert sorted(merchant for _, merchant in ledger) == sorted(
        [f"Payee M{day}" for day in range(1, 32)] + [f"Payee I{number}" for number in range(10)],
    )
    assert await _balance(client, headers, account_id) == -(31 * 1000 + 10 * 2500)


async def test_the_same_statement_into_another_account_skips_nothing(client):
    """Example 4: matching reaches past its account, so a second account loses the statement"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_id = (await _create_account(client, headers, name="Joint Chequing")).json()["id"]
    assert (await _import_ofx(client, headers, _ofx_payload(account_id, category_id, _march(1, 5)))).status_code == 201

    resp = await _import_ofx(client, headers, _ofx_payload(other_id, category_id, _march(1, 5)))

    assert resp.status_code == 201, resp.text
    assert (resp.json()["transactions_created"], resp.json()["transactions_already_imported"]) == (5, 0)
    assert len(await _ledger(client, headers, other_id)) == 5


async def test_rows_with_no_bank_id_import_every_time(client):
    """A row with no ID is never matched, so leaving it out would drop a CSV row or an ID-less statement line"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    payload = _ofx_payload(account_id, category_id, [(None, "2026-03-01", "-10.00")] * 3)

    for expected_count in (3, 6):
        resp = await _import_ofx(client, headers, payload)
        assert resp.status_code == 201, resp.text
        assert (resp.json()["transactions_created"], resp.json()["transactions_already_imported"]) == (3, 0)
        assert len(await _ledger(client, headers, account_id)) == expected_count


async def test_a_statement_imported_again_after_its_import_was_undone_imports_whole(client):
    """Example 3: the undo deletes the transactions, so their bank IDs must not stay behind to skip them"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    payload = _ofx_payload(account_id, category_id, _march(1, 5))
    assert (await _import_ofx(client, headers, payload)).status_code == 201
    last = (await client.get("/transactions/import/last", headers=headers)).json()
    undone = await client.post(f"/transactions/import/runs/{last['id']}/undo", headers=headers)
    assert undone.status_code == 200, undone.text
    assert await _ledger(client, headers, account_id) == []

    resp = await _import_ofx(client, headers, payload)

    assert resp.status_code == 201, resp.text
    assert (resp.json()["transactions_created"], resp.json()["transactions_already_imported"]) == (5, 0)
    assert len(await _ledger(client, headers, account_id)) == 5


async def test_a_statement_whose_every_transaction_is_already_there_is_refused_and_keeps_the_earlier_undo(client):
    """Saving nothing would still become the last import and take away the undo of the one that wrote them"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    payload = _ofx_payload(account_id, category_id, _march(1, 5))
    assert (await _import_ofx(client, headers, payload)).status_code == 201
    last_before = (await client.get("/transactions/import/last", headers=headers)).json()

    resp = await _import_ofx(client, headers, payload)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Every transaction in this import is already in Main Chequing"
    assert (await client.get("/transactions/import/last", headers=headers)).json() == last_before
    assert len(await _ledger(client, headers, account_id)) == 5


async def test_an_import_repeating_a_bank_id_in_one_account_is_refused(client):
    """The page leaves a repeat out before sending, so one arriving would write a transaction twice"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    repeated = [("0001", "2026-03-01", "-10.00"), ("0001", "2026-03-02", "-20.00")]

    resp = await _import_ofx(client, headers, _ofx_payload(account_id, category_id, repeated))

    assert resp.status_code == 422
    assert resp.json()["detail"] == "This import repeats a bank ID in Main Chequing"
    assert await _ledger(client, headers, account_id) == []


async def test_a_raw_bank_id_or_account_number_is_refused_as_it_is_staged(client):
    """Only a digest is kept, so an account number or bank ID sent in its place must never be stored"""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    digest = _bank_hash("0001")
    for sent in ("0001", _CHEQUING_KEY, digest.upper(), digest[:-1], f"{digest}0"):
        payload = _ofx_payload(account_id, category_id, [("0001", "2026-03-01", "-10.00")])
        payload["rows"][0]["bank_transaction_hash"] = sent
        resp = await _import_ofx(client, headers, payload)
        assert resp.status_code == 422, resp.text
        assert [(error["loc"], error["msg"]) for error in resp.json()["detail"]] == [
            (
                ["body", "rows", 0, "bank_transaction_hash"],
                "String should match pattern '^[0-9a-f]{64}$'",
            )
        ]
    assert await _ledger(client, headers, account_id) == []


async def test_a_page_from_before_the_hash_is_refused_before_it_stages_anything(client):
    """An open tab still sends the account number and bank ID, which must not be stored or imported unmatched"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    payload = _ofx_payload(account_id, category_id, [(None, "2026-03-01", "-10.00")])
    payload["accounts"][0]["source"] = _CHEQUING_KEY
    payload["rows"][0] |= {"account_source": _CHEQUING_KEY, "bank_account_key": _CHEQUING_KEY, "bank_transaction_id": "0001"}
    del payload["rows"][0]["bank_transaction_hash"]
    run_id = await _open_run(client, headers, source="ofx")

    resp = await _stage_batch(client, headers, run_id, {**payload, "start_row_index": 0}, source="ofx")

    assert resp.status_code == 422, resp.text
    assert sorted((tuple(error["loc"]), error["msg"]) for error in resp.json()["detail"]) == [
        (("body", "rows", 0, "bank_account_key"), "Extra inputs are not permitted"),
        (("body", "rows", 0, "bank_transaction_id"), "Extra inputs are not permitted"),
    ]
    async with TestSession() as session:
        staged = await session.scalar(text("SELECT count(*) FROM import_staged_rows WHERE import_run_id = :id"), {"id": uuid.UUID(run_id)})
        answers = await session.scalar(text("SELECT account_mappings FROM import_runs WHERE id = :id"), {"id": uuid.UUID(run_id)})
    assert (staged, answers) == (0, {})


async def test_the_pages_digest_is_staged_and_stored_only_keyed(client):
    """The bare digest of an account number can be reversed by trying them all, so it must not be kept"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    run_id = await _open_staged_run(client, headers, _ofx_payload(account_id, category_id, _march(1, 1)), source="ofx")
    async with TestSession() as session:
        staged = await session.scalar(text("SELECT payload FROM import_staged_rows WHERE import_run_id = :id"), {"id": uuid.UUID(run_id)})

    resp = await _commit_run(client, headers, run_id, source="ofx")

    assert resp.status_code == 201, resp.text
    async with TestSession() as session:
        stored = await session.scalar(
            select(Transaction.bank_transaction_hash).where(Transaction.account_id == uuid.UUID(account_id)),
        )
    assert (staged["bank_transaction_hash"], stored) == (_stored_hash("M1"), _stored_hash("M1"))


async def test_an_edited_transaction_moved_to_another_account_is_still_recognised_there(client):
    """Acceptance 2: an edit that dropped the bank ID would let the next statement bring it in again"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_id = (await _create_account(client, headers, name="Joint Chequing")).json()["id"]
    assert (await _import_ofx(client, headers, _ofx_payload(account_id, category_id, _march(1, 1)))).status_code == 201
    transaction_id = (await _list_transactions(client, headers))[0]["id"]

    edit = await client.patch(
        f"/transactions/{transaction_id}",
        json={"account_id": other_id, "amount": -1234, "dt": "2026-03-20", "notes": "Moved"},
        headers=headers,
    )
    assert edit.status_code == 200, edit.text

    resp = await _import_ofx(client, headers, _ofx_payload(other_id, category_id, _march(1, 2)))

    assert resp.status_code == 201, resp.text
    assert (resp.json()["transactions_created"], resp.json()["transactions_already_imported"]) == (1, 1)


async def _count_transaction_reads(client, headers, account_id, category_id, row_count):
    """Commit a statement of row_count rows, the first ten already held, and count its reads of the transactions table"""
    rows = [(f"R{index}", "2026-03-01", "-1.00") for index in range(row_count)]
    run_id = await _open_staged_run(client, headers, _ofx_payload(account_id, category_id, rows), source="ofx")
    reads = []

    def record(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT") and re.search(r"\bFROM transactions\b", statement):
            reads.append(statement)

    event.listen(scoped_engine.sync_engine, "before_cursor_execute", record)
    try:
        resp = await _commit_run(client, headers, run_id, source="ofx")
    finally:
        event.remove(scoped_engine.sync_engine, "before_cursor_execute", record)

    assert resp.status_code == 201, resp.text
    assert (resp.json()["transactions_created"], resp.json()["transactions_already_imported"]) == (row_count - 10, 10)
    return len(reads)


async def test_the_bank_ids_are_read_in_one_statement_however_many_rows_carry_them(client):
    """A read per row would cost a round trip for each of a statement's thousands of transactions"""
    small_headers, small_account_id, small_category_id = await _setup_user_with_deps(client)
    large_headers, large_account_id, large_category_id = await _setup_user_with_deps(client, email="large@example.com")
    held = [(f"R{index}", "2026-03-01", "-1.00") for index in range(10)]
    for headers, account_id, category_id in (
        (small_headers, small_account_id, small_category_id),
        (large_headers, large_account_id, large_category_id),
    ):
        assert (await _import_ofx(client, headers, _ofx_payload(account_id, category_id, held))).status_code == 201

    small = await _count_transaction_reads(client, small_headers, small_account_id, small_category_id, 20)
    large = await _count_transaction_reads(client, large_headers, large_account_id, large_category_id, 1000)

    assert large == small


async def test_two_imports_saving_one_bank_transaction_at_once_write_it_once(client, monkeypatch):
    """Both read the account before either writes, so only the index stops the second writing it again"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    first_run = await _open_staged_run(client, headers, _ofx_payload(account_id, category_id, _march(1, 3)), source="ofx")
    second_run = await _open_staged_run(client, headers, _ofx_payload(account_id, category_id, _march(2, 4)), source="ofx")

    original_read = generic_service.find_held_bank_transactions
    original_snapshots = generic_service.recompute_account_snapshots
    pids = []
    first_written = asyncio.Event()
    release_first = asyncio.Event()

    async def record_pid(db, keys):
        pids.append(await db.scalar(text("SELECT pg_backend_pid()")))
        return await original_read(db, keys)

    # Holds the first commit once its rows are written and before it commits
    async def hold_first(db, starts):
        if not first_written.is_set():
            first_written.set()
            await release_first.wait()
        return await original_snapshots(db, starts)

    monkeypatch.setattr(generic_service, "find_held_bank_transactions", record_pid)
    monkeypatch.setattr(generic_service, "recompute_account_snapshots", hold_first)
    async with asyncio.timeout(10):
        first = asyncio.create_task(_commit_run(client, headers, first_run, source="ofx"))
        await first_written.wait()
        second = asyncio.create_task(_commit_run(client, headers, second_run, source="ofx"))
        while len(pids) < 2:
            await asyncio.sleep(0.01)
        await _wait_until_blocked(pids[0], pids[1])
        release_first.set()
        won, lost = await asyncio.gather(first, second)

    assert won.status_code == 201, won.text
    assert lost.status_code == 409
    assert lost.json()["detail"] == generic_service.BANK_TRANSACTION_RACE_DETAIL

    # The loser's run is still staged, so saving it again writes only what the winner left out
    retried = await _commit_run(client, headers, second_run, source="ofx")
    assert retried.status_code == 201, retried.text
    assert (retried.json()["transactions_created"], retried.json()["transactions_already_imported"]) == (1, 2)
    async with TestSession() as session:
        ids = (
            (
                await session.execute(
                    select(Transaction.bank_transaction_hash).where(Transaction.account_id == uuid.UUID(account_id)),
                )
            )
            .scalars()
            .all()
        )
    assert sorted(ids) == sorted(_stored_hash(f"M{day}") for day in range(1, 5))


async def _import_into_both(client):
    """Import one statement into two accounts, returning the headers, both account ids and the first account's transactions"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_id = (await _create_account(client, headers, name="Joint Chequing")).json()["id"]
    for target_id in (account_id, other_id):
        assert (await _import_ofx(client, headers, _ofx_payload(target_id, category_id, _march(1, 3)))).status_code == 201
    first_account = [t for t in await _list_transactions(client, headers) if t["account_id"] == account_id]
    return headers, account_id, other_id, first_account


async def test_moving_a_transaction_into_an_account_holding_its_bank_id_is_refused(client):
    """The move would put two copies of one bank transaction in the account and break the next import"""
    headers, account_id, other_id, first_account = await _import_into_both(client)

    resp = await client.patch(f"/transactions/{first_account[0]['id']}", json={"account_id": other_id}, headers=headers)

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Joint Chequing already has this transaction from an earlier import"
    assert len(await _ledger(client, headers, account_id)) == 3


async def test_moving_transactions_into_an_account_holding_their_bank_ids_in_bulk_is_refused_whole(client):
    """A bulk edit must refuse what a single edit refuses, and leave every row where it was"""
    headers, account_id, other_id, first_account = await _import_into_both(client)

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [transaction["id"] for transaction in first_account],
            "account_id": other_id,
        },
        headers=headers,
    )

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Joint Chequing already has 3 of these transactions from an earlier import"
    assert len(await _ledger(client, headers, account_id)) == 3
    assert len(await _ledger(client, headers, other_id)) == 3


async def test_moving_a_transaction_into_an_account_holding_other_bank_ids_is_allowed(client):
    """Only the same bank transaction clashes, so an account with imported transactions still takes others"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_id = (await _create_account(client, headers, name="Joint Chequing")).json()["id"]
    for target_id, bank_transaction_id in ((account_id, "0001"), (other_id, "0002")):
        payload = _ofx_payload(target_id, category_id, [(bank_transaction_id, "2026-03-01", "-10.00")])
        assert (await _import_ofx(client, headers, payload)).status_code == 201
    moving_id = (await _ledger_transactions(client, headers, account_id))[0]["id"]

    resp = await client.patch(f"/transactions/{moving_id}", json={"account_id": other_id}, headers=headers)

    assert resp.status_code == 200, resp.text
    assert await _ledger_transactions(client, headers, account_id) == []
    assert len(await _ledger_transactions(client, headers, other_id)) == 2


async def test_moving_a_set_some_of_which_an_account_holds_in_bulk_is_refused_whole(client):
    """A set where only some rows clash must not move the free ones and leave the rest behind"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_id = (await _create_account(client, headers, name="Joint Chequing")).json()["id"]
    assert (await _import_ofx(client, headers, _ofx_payload(account_id, category_id, _march(1, 3)))).status_code == 201
    assert (await _import_ofx(client, headers, _ofx_payload(other_id, category_id, _march(2, 2)))).status_code == 201
    moving = await _ledger_transactions(client, headers, account_id)

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [transaction["id"] for transaction in moving],
            "account_id": other_id,
        },
        headers=headers,
    )

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Joint Chequing already has 1 of these transactions from an earlier import"
    assert sorted(merchant for _, merchant in await _ledger(client, headers, account_id)) == [
        "Payee M1",
        "Payee M2",
        "Payee M3",
    ]
    assert await _ledger(client, headers, other_id) == [("2026-03-02", "Payee M2")]


async def _ledger_transactions(client, headers, account_id):
    return [transaction for transaction in await _list_transactions(client, headers) if transaction["account_id"] == account_id]


def _give_held_row_bank_id_after(original, other_id, bank_transaction_id):
    """Wrap a held-ID check so that, once it passes, another session gives a row of other_id that bank ID

    Stands in for an import landing in the other account between the check and the write
    """

    async def check_then_clash(*args, **kwargs):
        result = await original(*args, **kwargs)
        async with TestSession() as other:
            await other.execute(
                text(
                    "UPDATE transactions SET bank_transaction_hash = :clash WHERE account_id = :account_id AND bank_transaction_hash = :free",
                ),
                {"clash": _stored_hash(bank_transaction_id), "free": _stored_hash("X1"), "account_id": uuid.UUID(other_id)},
            )
            await other.commit()
        return result

    return check_then_clash


async def _import_one_each_with_a_free_row_in_the_other(client):
    """Import M1 into the first account and X1 into Joint Chequing, returning the headers and both account ids"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_id = (await _create_account(client, headers, name="Joint Chequing")).json()["id"]
    for target_id, bank_transaction_id in ((account_id, "M1"), (other_id, "X1")):
        payload = _ofx_payload(target_id, category_id, [(bank_transaction_id, "2026-03-01", "-10.00")])
        assert (await _import_ofx(client, headers, payload)).status_code == 201
    return headers, account_id, other_id


async def test_a_move_racing_an_import_of_its_bank_id_into_the_account_is_refused(client, monkeypatch):
    """The check passes before the other write lands, so only the index stops the second copy"""
    headers, account_id, other_id = await _import_one_each_with_a_free_row_in_the_other(client)
    monkeypatch.setattr(
        update_module,
        "_refuse_move_into_held_bank_transaction",
        _give_held_row_bank_id_after(update_module._refuse_move_into_held_bank_transaction, other_id, "M1"),
    )
    moving_id = (await _ledger_transactions(client, headers, account_id))[0]["id"]

    resp = await client.patch(f"/transactions/{moving_id}", json={"account_id": other_id}, headers=headers)

    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == "Joint Chequing already has this transaction from an earlier import"
    assert [transaction["id"] for transaction in await _ledger_transactions(client, headers, account_id)] == [moving_id]


async def test_a_bulk_move_racing_an_import_of_its_bank_id_into_the_account_is_refused_whole(client, monkeypatch):
    """The check passes before the other write lands, so only the index stops the second copy"""
    headers, account_id, other_id = await _import_one_each_with_a_free_row_in_the_other(client)
    monkeypatch.setattr(
        bulk_update_module,
        "_refuse_moves_into_held_bank_transactions",
        _give_held_row_bank_id_after(bulk_update_module._refuse_moves_into_held_bank_transactions, other_id, "M1"),
    )
    moving_id = (await _ledger_transactions(client, headers, account_id))[0]["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [moving_id], "account_id": other_id},
        headers=headers,
    )

    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == "Another change reached one of these transactions first"
    assert [transaction["id"] for transaction in await _ledger_transactions(client, headers, account_id)] == [moving_id]


async def test_an_edit_naming_the_transactions_own_account_is_not_a_move(client):
    """The edit form sends the account every time, so its own bank ID would refuse every later edit"""
    headers, account_id, _, first_account = await _import_into_both(client)

    single = await client.patch(
        f"/transactions/{first_account[0]['id']}",
        json={"account_id": account_id, "notes": "Edited"},
        headers=headers,
    )
    bulk = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [transaction["id"] for transaction in first_account],
            "account_id": account_id,
        },
        headers=headers,
    )

    assert single.status_code == 200, single.text
    assert bulk.status_code == 200, bulk.text
