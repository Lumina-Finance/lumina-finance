import uuid

from sqlalchemy import select

from app.models.account import AccountBalanceSnapshot
from app.models.base import TransferCounterpartyScope
from app.models.tag import TransactionTag
from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.transactions._helpers import (
    _create_account,
    _create_category,
    _create_merchant,
    _create_tag,
    _create_transaction,
    _get_system_category_id,
    _setup_user_with_deps,
)

# --- PATCH /transactions/bulk ---


async def _clear_merchant(transaction_id):
    """Take the merchant off a transaction, as rows recorded before the rule have it."""
    async with TestSession() as session:
        txn = await session.get(Transaction, uuid.UUID(transaction_id))
        txn.merchant_id = None
        await session.commit()


async def _clear_counterparty(transaction_id):
    """Take the recorded counterparty off a transfer, as rows predating the field have it."""
    async with TestSession() as session:
        txn = await session.get(Transaction, uuid.UUID(transaction_id))
        txn.counterparty_account_id = None
        txn.counterparty_account_scope = None
        await session.commit()


async def _read_transaction(transaction_id):
    """Return a transaction row straight from the database."""
    async with TestSession() as session:
        return await session.get(Transaction, uuid.UUID(transaction_id))


async def _read_snapshots(account_id):
    """Return an account's stored running balances, oldest first."""
    async with TestSession() as session:
        rows = await session.execute(
            select(AccountBalanceSnapshot.dt, AccountBalanceSnapshot.balance)
            .where(AccountBalanceSnapshot.account_id == uuid.UUID(account_id))
            .order_by(AccountBalanceSnapshot.dt),
        )
        return list(rows.all())


async def _setup_transfer_user(client):
    """Sign up a user with an account, an expense category, a second account and the Transfer category."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_account_id = (await _create_account(client, headers, name="Savings")).json()["id"]
    transfer_id = await _get_system_category_id(client, headers, "Transfer")
    return headers, account_id, category_id, other_account_id, transfer_id


async def test_bulk_update_sets_a_category_on_every_selected_transaction(client):
    """One request applies the chosen category to each transaction it names."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    first = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    second = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    dining_id = (await _create_category(client, headers, name="Bulk Dining", kind="expense")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [first, second], "category_id": dining_id},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["transactions_updated"] == 2
    assert resp.json()["affected_account_ids"] == [account_id]
    assert str((await _read_transaction(first)).category_id) == dining_id
    assert str((await _read_transaction(second)).category_id) == dining_id


async def test_bulk_update_refuses_a_set_holding_a_transaction_with_no_merchant(client):
    """A row recorded before a merchant was required refuses any other change until it has one."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    first = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    second = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    await _clear_merchant(first)
    dining_id = (await _create_category(client, headers, name="Bulk Dining", kind="expense")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [first, second], "category_id": dining_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert "no merchant recorded" in resp.json()["detail"]
    assert str((await _read_transaction(second)).category_id) == category_id


async def test_bulk_update_setting_a_merchant_leaves_a_transfer_counterparty_alone(client):
    """A set holding one transfer and one expense keeps the transfer's recorded account."""
    headers, account_id, category_id, other_account_id, transfer_id = await _setup_transfer_user(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    transfer = (
        await _create_transaction(
            client,
            headers,
            account_id,
            transfer_id,
            counterparty_account_scope="tracked",
            counterparty_account_id=other_account_id,
        )
    ).json()["id"]
    merchant_id = (await _create_merchant(client, headers, name="Costco")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [expense, transfer], "merchant_id": merchant_id},
        headers=headers,
    )

    assert resp.status_code == 200
    transfer_row = await _read_transaction(transfer)
    assert str(transfer_row.counterparty_account_id) == other_account_id
    assert transfer_row.counterparty_account_scope == TransferCounterpartyScope.TRACKED
    assert str(transfer_row.merchant_id) == merchant_id
    assert str((await _read_transaction(expense)).merchant_id) == merchant_id


async def test_bulk_update_refuses_a_transfer_that_records_no_other_account(client):
    """Setting only a merchant still answers the transfer question, as a single edit does."""
    headers, account_id, _, _, transfer_id = await _setup_transfer_user(client)
    transfer = (
        await _create_transaction(client, headers, account_id, transfer_id, counterparty_account_scope="outside")
    ).json()["id"]
    await _clear_counterparty(transfer)
    merchant_before = (await _read_transaction(transfer)).merchant_id
    merchant_id = (await _create_merchant(client, headers, name="Costco")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [transfer], "merchant_id": merchant_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert "other account of a transfer" in resp.json()["detail"]

    # The row keeps the merchant it had, which is what proves the refusal ran before any write
    assert (await _read_transaction(transfer)).merchant_id == merchant_before


async def test_bulk_update_refuses_a_transfer_category_over_a_row_recording_nothing(client):
    """Moving an expense onto a transfer category needs the other account, which the bar cannot set."""
    headers, account_id, category_id, _, transfer_id = await _setup_transfer_user(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [expense], "category_id": transfer_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert str((await _read_transaction(expense)).category_id) == category_id


async def test_bulk_update_clears_the_counterparty_when_the_new_category_records_none(client):
    """A transfer moved onto an expense category drops the account it recorded."""
    headers, account_id, category_id, other_account_id, transfer_id = await _setup_transfer_user(client)
    transfer = (
        await _create_transaction(
            client,
            headers,
            account_id,
            transfer_id,
            counterparty_account_scope="tracked",
            counterparty_account_id=other_account_id,
        )
    ).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [transfer], "category_id": category_id},
        headers=headers,
    )

    assert resp.status_code == 200
    row = await _read_transaction(transfer)
    assert row.counterparty_account_id is None
    assert row.counterparty_account_scope is None


async def test_bulk_update_adding_a_tag_clears_a_counterparty_the_category_does_not_record(client):
    """A tags-only edit normalises the row the same way a single edit does."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    async with TestSession() as session:
        row = await session.get(Transaction, uuid.UUID(txn))
        row.counterparty_account_scope = TransferCounterpartyScope.OUTSIDE
        await session.commit()
    tag_id = (await _create_tag(client, headers, name="vacation")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "add_tag_ids": [tag_id]},
        headers=headers,
    )

    assert resp.status_code == 200
    assert (await _read_transaction(txn)).counterparty_account_scope is None


async def test_bulk_update_rejects_a_transaction_belonging_to_another_user(client):
    """An unreachable identifier answers 404 rather than reporting a change it never made."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    mine = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    other_headers, other_account_id, other_category_id = await _setup_user_with_deps(
        client, email="stranger@example.com", name_prefix="Stranger",
    )
    theirs = (
        await _create_transaction(client, other_headers, other_account_id, other_category_id)
    ).json()["id"]
    dining_id = (await _create_category(client, headers, name="Bulk Dining", kind="expense")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [mine, theirs], "category_id": dining_id},
        headers=headers,
    )

    assert resp.status_code == 404
    assert str((await _read_transaction(mine)).category_id) == category_id
    assert str((await _read_transaction(theirs)).category_id) == other_category_id


async def test_bulk_update_refuses_a_set_holding_an_archived_account(client):
    """An archived account takes no edits, so the whole set is refused."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    archived_account_id = (await _create_account(client, headers, name="Old Chequing")).json()["id"]
    kept = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    archived = (await _create_transaction(client, headers, archived_account_id, category_id)).json()["id"]
    archive_resp = await client.patch(
        f"/accounts/{archived_account_id}", json={"is_archived": True}, headers=headers,
    )
    assert archive_resp.status_code == 200
    dining_id = (await _create_category(client, headers, name="Bulk Dining", kind="expense")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [kept, archived], "category_id": dining_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert str((await _read_transaction(kept)).category_id) == category_id


async def test_bulk_update_adds_a_tag_without_disturbing_the_tags_already_there(client):
    """Adding a tag leaves every tag the transaction already carries in place."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    travel_id = (await _create_tag(client, headers, name="travel")).json()["id"]
    reimbursable_id = (await _create_tag(client, headers, name="reimbursable")).json()["id"]
    txn = (
        await _create_transaction(client, headers, account_id, category_id, tag_ids=[travel_id])
    ).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "add_tag_ids": [reimbursable_id]},
        headers=headers,
    )

    assert resp.status_code == 200
    detail = await client.get(f"/transactions/{txn}", headers=headers)
    assert set(detail.json()["tag_ids"]) == {travel_id, reimbursable_id}


async def test_bulk_update_adding_a_tag_the_transaction_already_has_changes_nothing(client):
    """A tag already attached is left as it is rather than failing the request."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    travel_id = (await _create_tag(client, headers, name="travel")).json()["id"]
    txn = (
        await _create_transaction(client, headers, account_id, category_id, tag_ids=[travel_id])
    ).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "add_tag_ids": [travel_id]},
        headers=headers,
    )

    assert resp.status_code == 200
    async with TestSession() as session:
        rows = await session.execute(
            select(TransactionTag).where(TransactionTag.transaction_id == uuid.UUID(txn)),
        )
        assert len(list(rows.scalars().all())) == 1


async def test_bulk_update_accepts_the_same_transaction_named_twice(client):
    """A repeated identifier is one transaction, not one found and one missing."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    first = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    second = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    dining_id = (await _create_category(client, headers, name="Bulk Dining", kind="expense")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [first, second, first], "category_id": dining_id},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["transactions_updated"] == 2
    assert str((await _read_transaction(first)).category_id) == dining_id
    assert str((await _read_transaction(second)).category_id) == dining_id


async def test_bulk_update_refuses_more_transactions_than_one_request_may_carry(client):
    """The request is bounded, so a selection past the cap is refused before any work."""
    headers, _account_id, category_id = await _setup_user_with_deps(client)

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [str(uuid.uuid4()) for _ in range(1001)], "category_id": category_id},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_bulk_update_refuses_an_empty_selection(client):
    """A request naming no transaction has nothing to apply to."""
    headers, _account_id, category_id = await _setup_user_with_deps(client)

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [], "category_id": category_id},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_bulk_update_refuses_a_request_that_sets_nothing(client):
    """Naming transactions without a field to set would report a count for no write."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch("/transactions/bulk", json={"transaction_ids": [txn]}, headers=headers)

    assert resp.status_code == 422


async def test_bulk_update_refuses_a_request_carrying_only_an_empty_tag_list(client):
    """An empty tag list sets no field, so it is not a change either."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "add_tag_ids": []},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_bulk_update_leaves_the_account_balances_where_they_were(client):
    """Category, merchant and tags move no money, so every stored balance stays as it was."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    dining_id = (await _create_category(client, headers, name="Bulk Dining", kind="expense")).json()["id"]
    before = await _read_snapshots(account_id)
    assert before, "the account should carry balances before the edit, or this proves nothing"

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "category_id": dining_id},
        headers=headers,
    )

    assert resp.status_code == 200
    assert await _read_snapshots(account_id) == before
