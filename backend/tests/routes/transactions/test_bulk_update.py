import uuid
from datetime import date

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
    _seed_usd_currency,
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
    """A category or a note moves no money, so every stored balance stays as it was."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    dining_id = (await _create_category(client, headers, name="Bulk Dining", kind="expense")).json()["id"]
    before = await _read_snapshots(account_id)
    assert before, "the account should carry balances before the edit, or this proves nothing"

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "category_id": dining_id, "notes": "Corrected"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert await _read_snapshots(account_id) == before


async def test_bulk_update_leaves_the_balances_alone_for_a_merchant_and_tag_edit(client):
    """A merchant and a tag move no money either, and they are the most common bulk edit there is."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    merchant_id = (await _create_merchant(client, headers, name="Costco")).json()["id"]
    tag_id = (await _create_tag(client, headers, name="vacation")).json()["id"]
    before = await _read_snapshots(account_id)
    assert before, "the account should carry balances before the edit, or this proves nothing"

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "merchant_id": merchant_id, "add_tag_ids": [tag_id]},
        headers=headers,
    )

    assert resp.status_code == 200
    assert await _read_snapshots(account_id) == before


# --- A field sent as null ---


async def test_bulk_update_refuses_a_null_date(client):
    """The date column takes no null, so sending one is refused rather than reaching the database."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "dt": None},
        headers=headers,
    )

    assert resp.status_code == 422


async def test_bulk_update_refuses_a_null_merchant(client):
    """Clearing the merchant would leave a row the edit rules require to have one."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "merchant_id": None},
        headers=headers,
    )

    assert resp.status_code == 422
    assert (await _read_transaction(txn)).merchant_id is not None


# --- The note ---


async def test_bulk_update_sets_a_note_on_every_selected_transaction(client):
    """A note replaces whatever each transaction carried."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    first = (await _create_transaction(client, headers, account_id, category_id, notes="Weekly shop")).json()["id"]
    second = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [first, second], "notes": "Corrected"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert (await _read_transaction(first)).notes == "Corrected"
    assert (await _read_transaction(second)).notes == "Corrected"


async def test_bulk_update_clears_a_note_sent_as_null(client):
    """Null is a real answer for a note, meaning take it off."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id, notes="Weekly shop")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "notes": None},
        headers=headers,
    )

    assert resp.status_code == 200
    assert (await _read_transaction(txn)).notes is None


async def test_bulk_update_leaves_a_note_alone_when_the_request_omits_it(client):
    """A field the request did not carry is left as it was."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id, notes="Weekly shop")).json()["id"]
    dining_id = (await _create_category(client, headers, name="Bulk Dining", kind="expense")).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "category_id": dining_id},
        headers=headers,
    )

    assert resp.status_code == 200
    assert (await _read_transaction(txn)).notes == "Weekly shop"


# --- Moving to another account ---


async def test_bulk_update_moves_transactions_and_rebuilds_both_accounts(client):
    """A move rebuilds the account the rows left and the one they arrived in."""
    headers, source_id, category_id = await _setup_user_with_deps(client)
    target_id = (await _create_account(client, headers, name="Savings")).json()["id"]

    # Stays behind, so the source account still has history after the move
    await _create_transaction(client, headers, source_id, category_id, dt="2026-07-15", amount=-400)
    first = (
        await _create_transaction(client, headers, source_id, category_id, dt="2026-08-01", amount=-1000)
    ).json()["id"]
    second = (
        await _create_transaction(client, headers, source_id, category_id, dt="2026-08-20", amount=-2500)
    ).json()["id"]

    # Already in the target, bracketing the arrival date, so its later balances have to be rebuilt
    await _create_transaction(client, headers, target_id, category_id, dt="2026-08-10", amount=-800)

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [first, second], "account_id": target_id},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["affected_account_ids"] == sorted([source_id, target_id])

    source_balances = dict(await _read_snapshots(source_id))
    assert source_balances[date(2026, 7, 15)] == -400
    assert max(source_balances) == date(2026, 7, 15)

    target_balances = dict(await _read_snapshots(target_id))
    assert target_balances[date(2026, 8, 1)] == -1000
    assert target_balances[date(2026, 8, 10)] == -1800
    assert target_balances[date(2026, 8, 20)] == -4300


async def test_bulk_update_rebuilds_every_account_a_date_change_touches(client):
    """A selection spans accounts, so a date change rebuilds each one it reaches."""
    headers, first_account, category_id = await _setup_user_with_deps(client)
    second_account = (await _create_account(client, headers, name="Savings")).json()["id"]
    first = (
        await _create_transaction(client, headers, first_account, category_id, dt="2026-08-20", amount=-1000)
    ).json()["id"]
    second = (
        await _create_transaction(client, headers, second_account, category_id, dt="2026-08-20", amount=-2000)
    ).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [first, second], "dt": "2026-08-14"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert dict(await _read_snapshots(first_account))[date(2026, 8, 14)] == -1000
    assert date(2026, 8, 20) not in dict(await _read_snapshots(first_account))
    assert dict(await _read_snapshots(second_account))[date(2026, 8, 14)] == -2000
    assert date(2026, 8, 20) not in dict(await _read_snapshots(second_account))


async def test_bulk_update_rebuilds_the_target_from_a_row_that_was_already_there(client):
    """A row already in the target account contributes its own earlier date to the rebuild."""
    headers, source_id, category_id = await _setup_user_with_deps(client)
    target_id = (await _create_account(client, headers, name="Savings")).json()["id"]
    moving = (
        await _create_transaction(client, headers, source_id, category_id, dt="2026-08-20", amount=-1000)
    ).json()["id"]
    already_there = (
        await _create_transaction(client, headers, target_id, category_id, dt="2026-08-01", amount=-500)
    ).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [moving, already_there], "account_id": target_id, "dt": "2026-08-25"},
        headers=headers,
    )

    assert resp.status_code == 200
    target_balances = dict(await _read_snapshots(target_id))

    # Rebuilt from 2026-08-01, so the row that used to sit there is gone from that date
    assert date(2026, 8, 1) not in target_balances
    assert target_balances[date(2026, 8, 25)] == -1500


async def test_bulk_update_refuses_a_move_that_leaves_a_row_without_an_exchange_rate(client):
    """A row keeps its stored rate across a move, and without one it cannot change currency."""
    await _seed_usd_currency()
    headers, source_id, category_id = await _setup_user_with_deps(client)
    target_id = (await _create_account(client, headers, name="US Savings", currency="USD")).json()["id"]
    txn = (
        await _create_transaction(client, headers, source_id, category_id, currency="CAD")
    ).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "account_id": target_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert "exchange rate" in resp.json()["detail"]
    assert str((await _read_transaction(txn)).account_id) == source_id


async def test_bulk_update_moves_a_row_that_carries_an_exchange_rate(client):
    """The same move is accepted once the row records a rate."""
    await _seed_usd_currency()
    headers, source_id, category_id = await _setup_user_with_deps(client)
    target_id = (await _create_account(client, headers, name="US Savings", currency="USD")).json()["id"]
    txn = (
        await _create_transaction(client, headers, source_id, category_id, currency="CAD", fx_rate=1.35)
    ).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "account_id": target_id},
        headers=headers,
    )

    assert resp.status_code == 200
    assert str((await _read_transaction(txn)).account_id) == target_id


async def test_bulk_update_refuses_a_move_to_an_archived_account(client):
    """An archived account takes no history."""
    headers, source_id, category_id = await _setup_user_with_deps(client)
    target_id = (await _create_account(client, headers, name="Old Savings")).json()["id"]
    txn = (await _create_transaction(client, headers, source_id, category_id)).json()["id"]
    await client.patch(f"/accounts/{target_id}", json={"is_archived": True}, headers=headers)

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "account_id": target_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert str((await _read_transaction(txn)).account_id) == source_id


async def test_bulk_update_refuses_a_move_to_a_closed_account(client):
    """A closed account is a second state that takes no new transactions."""
    headers, source_id, category_id = await _setup_user_with_deps(client)
    target_id = (await _create_account(client, headers, name="Closed Savings")).json()["id"]
    txn = (await _create_transaction(client, headers, source_id, category_id)).json()["id"]
    await client.patch(f"/accounts/{target_id}", json={"closed_at": "2026-03-01"}, headers=headers)

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "account_id": target_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert str((await _read_transaction(txn)).account_id) == source_id


# --- The other account a transfer records ---


async def test_bulk_update_sets_a_transfer_category_and_its_other_account_together(client):
    """One request can move rows onto a transfer category and answer what that category asks."""
    headers, account_id, _, other_account_id, transfer_id = await _setup_transfer_user(client)
    category_id = (await _create_category(client, headers, name="Bulk Dining", kind="expense")).json()["id"]
    first = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    second = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [first, second],
            "category_id": transfer_id,
            "counterparty_account_scope": "tracked",
            "counterparty_account_id": other_account_id,
        },
        headers=headers,
    )

    assert resp.status_code == 200
    for txn in (first, second):
        row = await _read_transaction(txn)
        assert str(row.category_id) == transfer_id
        assert str(row.counterparty_account_id) == other_account_id


async def test_bulk_update_records_money_that_left_the_tracked_accounts(client):
    """An outside answer records the scope and no account."""
    headers, account_id, category_id, _, transfer_id = await _setup_transfer_user(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [txn],
            "category_id": transfer_id,
            "counterparty_account_scope": "outside",
        },
        headers=headers,
    )

    assert resp.status_code == 200
    row = await _read_transaction(txn)
    assert row.counterparty_account_scope == TransferCounterpartyScope.OUTSIDE
    assert row.counterparty_account_id is None


async def test_bulk_update_refuses_an_other_account_under_a_category_that_records_none(client):
    """An expense records no other account, so naming one is refused."""
    headers, account_id, category_id, other_account_id, _ = await _setup_transfer_user(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [txn],
            "counterparty_account_scope": "tracked",
            "counterparty_account_id": other_account_id,
        },
        headers=headers,
    )

    assert resp.status_code == 422
    assert "records no other account" in resp.json()["detail"]


async def test_bulk_update_refuses_a_scope_alone_under_a_category_that_records_none(client):
    """Either half of the answer is an answer, so a scope on its own is refused as an account is."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "counterparty_account_scope": "outside"},
        headers=headers,
    )

    assert resp.status_code == 422
    assert "records no other account" in resp.json()["detail"]


async def test_bulk_update_refuses_a_transfer_recording_its_own_account(client):
    """A transfer cannot record the account it already sits in."""
    headers, account_id, _, _, transfer_id = await _setup_transfer_user(client)
    category_id = (await _create_category(client, headers, name="Bulk Dining", kind="expense")).json()["id"]
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    resp = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [txn],
            "category_id": transfer_id,
            "counterparty_account_scope": "tracked",
            "counterparty_account_id": account_id,
        },
        headers=headers,
    )

    assert resp.status_code == 422
    assert "their own account" in resp.json()["detail"]


async def test_bulk_update_refuses_a_move_into_the_account_a_transfer_already_records(client):
    """The move makes the recorded account the row's own, which a check on the sent value would miss."""
    headers, account_id, _, other_account_id, transfer_id = await _setup_transfer_user(client)
    txn = (
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
        json={"transaction_ids": [txn], "account_id": other_account_id},
        headers=headers,
    )

    assert resp.status_code == 422
    assert "their own account" in resp.json()["detail"]
    assert str((await _read_transaction(txn)).account_id) == account_id


async def test_bulk_update_refuses_a_counterparty_answer_that_contradicts_itself(client):
    """A tracked answer needs an account and any other answer forbids one."""
    headers, account_id, category_id, other_account_id, _ = await _setup_transfer_user(client)
    txn = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]

    tracked_without_account = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [txn], "counterparty_account_scope": "tracked"},
        headers=headers,
    )
    outside_with_account = await client.patch(
        "/transactions/bulk",
        json={
            "transaction_ids": [txn],
            "counterparty_account_scope": "outside",
            "counterparty_account_id": other_account_id,
        },
        headers=headers,
    )

    assert tracked_without_account.status_code == 422
    assert outside_with_account.status_code == 422
