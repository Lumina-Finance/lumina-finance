"""The OFX preview asks the server which bank transactions an account already holds

Matched per account by the keyed hash of the bank account and the bank's ID, so the preview agrees
with what the commit leaves out, and it answers positions only so no bank value travels back
"""

from tests.routes.transactions._helpers import _create_account, _setup_user_with_deps
from tests.routes.transactions._import_helpers import _import_run

ENDPOINT = "/transactions/import/held-bank-transactions"

# A bank account as an OFX statement names it
_CHEQUING_KEY = "bank:021000021:000111222333"


def _item(account_id, bank_transaction, bank_account=_CHEQUING_KEY):
    """One transaction as the import page asks about it"""
    return {"account_id": account_id, "bank_account": bank_account, "bank_transaction": bank_transaction}


async def _import_statement(client, headers, account_id, category_id, bank_transaction_ids):
    """Save one OFX transaction per bank ID into the account, a day apart"""
    payload = {
        "accounts": [{"source": "Statement", "account_id": account_id}],
        "categories": [{"source": "Spending", "category_id": category_id}],
        "rows": [
            {
                "account_source": "Statement",
                "category_source": "Spending",
                "dt": f"2026-03-{day:02d}",
                "amount": "-10.00",
                "merchant_name": f"Payee {bank_transaction_id}",
                "tag_names": [],
                "bank_account": _CHEQUING_KEY,
                "bank_transaction": bank_transaction_id,
            }
            for day, bank_transaction_id in enumerate(bank_transaction_ids, start=1)
        ],
    }
    resp = await _import_run(client, headers, payload, source="ofx")
    assert resp.status_code == 201, resp.text


async def _ask(client, headers, items):
    """Ask which of the transactions their accounts already hold"""
    return await client.post(ENDPOINT, json={"items": items}, headers=headers)


async def test_held_bank_transactions_name_only_the_positions_the_account_holds(client):
    """Example 1: the held rows are flagged and the new one is not"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _import_statement(client, headers, account_id, category_id, ["A1", "A2"])

    resp = await _ask(client, headers, [_item(account_id, "A2"), _item(account_id, "B1"), _item(account_id, "A1")])

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"held": [0, 2]}


async def test_a_bank_transaction_under_another_bank_account_is_not_held(client):
    """The hash covers the bank account too, so the same ID from another account is a different transaction"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _import_statement(client, headers, account_id, category_id, ["A1"])

    resp = await _ask(client, headers, [_item(account_id, "A1", bank_account="bank:021000021:999888777666")])

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"held": []}


async def test_a_bank_transaction_held_by_one_account_is_not_held_by_another(client):
    """Example 3: the same file staged for a different account flags nothing"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _import_statement(client, headers, account_id, category_id, ["A1"])
    other_account_id = (await _create_account(client, headers, name="Savings")).json()["id"]

    resp = await _ask(client, headers, [_item(other_account_id, "A1"), _item(account_id, "A1")])

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"held": [1]}


async def test_nothing_is_held_once_the_earlier_import_was_undone(client):
    """Example 4: the undo deletes the transactions, so their bank IDs are free again"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _import_statement(client, headers, account_id, category_id, ["A1", "A2"])
    last = (await client.get("/transactions/import/last", headers=headers)).json()
    undone = await client.post(f"/transactions/import/runs/{last['id']}/undo", headers=headers)
    assert undone.status_code == 200, undone.text

    resp = await _ask(client, headers, [_item(account_id, "A1"), _item(account_id, "A2")])

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"held": []}


async def test_another_users_account_answers_not_found(client):
    """Whether a user's account holds a transaction is theirs alone to learn"""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    await _import_statement(client, headers, account_id, category_id, ["A1"])
    other_headers, _, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")

    resp = await _ask(client, other_headers, [_item(account_id, "A1")])

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Account not found"


async def test_an_archived_account_is_refused_as_the_commit_refuses_it(client):
    """The endpoint reuses the commit's account check, so an account it would not write to is refused"""
    headers, account_id, _ = await _setup_user_with_deps(client)
    archived = await client.patch(f"/accounts/{account_id}", json={"is_archived": True}, headers=headers)
    assert archived.status_code == 200, archived.text

    resp = await _ask(client, headers, [_item(account_id, "A1")])

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Account is archived"
