import uuid

import pytest
from sqlalchemy import func, select

from app.models.tag import TransactionTag
from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.transactions._helpers import (
    _create_account,
    _create_category,
    _create_tag,
    _create_transaction,
    _setup_user_with_deps,
)


async def _transaction_exists(transaction_id):
    async with TestSession() as session:
        return await session.get(Transaction, uuid.UUID(transaction_id)) is not None


async def _current_balance(client, headers, account_id):
    return (await client.get(f"/accounts/{account_id}", headers=headers)).json()["current_balance"]


async def test_bulk_delete_removes_the_selected_rows_and_rebuilds_every_balance(client):
    """The selected rows and their tags go, unselected rows stay, and each account's balance follows."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    savings_id = (await _create_account(client, headers, name="Savings")).json()["id"]
    tag = (await _create_tag(client, headers, name="Test import")).json()["id"]
    kept = [
        (await _create_transaction(client, headers, account, category_id, amount=amount, dt="2026-03-01")).json()["id"]
        for account, amount in ((account_id, -1000), (savings_id, 5000))
    ]

    # Two dates in one account, so rebuilding from any day but the earliest leaves a deleted amount in
    selected = [
        (await _create_transaction(client, headers, account, category_id, amount=amount, dt=dt, tag_ids=[tag])).json()["id"]
        for account, amount, dt in ((account_id, -2500, "2026-03-10"), (account_id, 40000, "2026-03-05"), (savings_id, -700, "2026-03-08"))
    ]
    assert await _current_balance(client, headers, account_id) == -1000 - 2500 + 40000
    assert await _current_balance(client, headers, savings_id) == 5000 - 700

    response = await client.post("/transactions/bulk/delete", headers=headers, json={"transaction_ids": selected})

    assert response.status_code == 200
    assert response.json()["transactions_deleted"] == 3
    assert set(response.json()["affected_account_ids"]) == {account_id, savings_id}
    assert [await _transaction_exists(identifier) for identifier in selected] == [False, False, False]
    assert [await _transaction_exists(identifier) for identifier in kept] == [True, True]
    assert await _current_balance(client, headers, account_id) == -1000
    assert await _current_balance(client, headers, savings_id) == 5000
    async with TestSession() as session:
        assert await session.scalar(select(func.count()).select_from(TransactionTag)) == 0


@pytest.mark.parametrize("failure, expected_status, expected_detail", [
    ("archived", 422, "Account is archived"),
    ("other_user", 404, "1 of 2 transactions were not found"),
    ("group", 422, "Transactions in group accounts can't be deleted in bulk"),
])
async def test_bulk_delete_is_all_or_nothing_when_a_selected_row_refuses(client, failure, expected_status, expected_detail):
    """A set holding one row the user cannot delete in bulk deletes nothing."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    first = (await _create_transaction(client, headers, account_id, category_id)).json()["id"]
    second_headers, second_account, second_category = headers, None, category_id
    if failure == "other_user":
        second_headers, second_account, second_category = await _setup_user_with_deps(
            client, email="other@example.com", name_prefix="Other",
        )
    if failure == "group":
        group = (await client.post("/groups", headers=second_headers, json={"name": "Household"})).json()["id"]
        second_account = (await _create_account(client, second_headers, name="Shared", group_id=group)).json()["id"]
        second_category = (await _create_category(client, second_headers, name="Shared food", group_id=group)).json()["id"]
    if failure == "archived":
        second_account = (await _create_account(client, headers, name="Old Chequing")).json()["id"]
    second = (await _create_transaction(client, second_headers, second_account, second_category)).json()["id"]
    if failure == "archived":
        assert (await client.patch(f"/accounts/{second_account}", headers=headers, json={"is_archived": True})).status_code == 200

    response = await client.post("/transactions/bulk/delete", headers=headers, json={"transaction_ids": [first, second]})

    assert response.status_code == expected_status
    assert response.json()["detail"] == expected_detail
    assert await _transaction_exists(first)
    assert await _transaction_exists(second)


async def test_bulk_delete_refuses_more_transactions_than_one_request_may_carry(client):
    """The selection is bounded like a bulk edit's, so one past the cap is refused before any work."""
    headers, _account_id, _category_id = await _setup_user_with_deps(client)

    response = await client.post("/transactions/bulk/delete", headers=headers, json={
        "transaction_ids": [str(uuid.uuid4()) for _ in range(1001)],
    })

    assert response.status_code == 422
