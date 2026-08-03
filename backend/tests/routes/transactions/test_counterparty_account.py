import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.base import TransferCounterpartyScope
from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.transactions._helpers import (
    _create_account,
    _create_category,
    _create_transaction,
    _get_system_category_id,
    _setup_user_with_deps,
)

# --- The counterparty account recorded on a transfer ---


async def _setup_transfer_user(client):
    """Return auth headers, an account, a second account, and a transfer category."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = (await _create_account(client, headers)).json()["id"]
    counterparty_account_id = (await _create_account(client, headers, name="Savings")).json()["id"]
    transfer_id = await _get_system_category_id(client, headers, "Transfer")
    return headers, account_id, counterparty_account_id, transfer_id


async def test_create_transfer_without_an_answer_is_rejected(client):
    """A transfer has to record its counterparty account as it is entered."""
    headers, account_id, _, transfer_id = await _setup_transfer_user(client)

    resp = await _create_transaction(client, headers, account_id, transfer_id)

    assert resp.status_code == 422


async def test_create_transfer_recording_a_tracked_account(client):
    """A transfer records a counterparty account without writing anything to it."""
    headers, account_id, counterparty_account_id, transfer_id = await _setup_transfer_user(client)

    resp = await _create_transaction(
        client, headers, account_id, transfer_id,
        counterparty_account_scope="tracked", counterparty_account_id=counterparty_account_id,
    )

    assert resp.status_code == 201
    assert resp.json()["counterparty_account_id"] == counterparty_account_id
    assert resp.json()["counterparty_account_scope"] == "tracked"

    # Recording an account creates no transaction there, so the user still has exactly one row
    listing = await client.get("/transactions", headers=headers)
    assert [txn["account_id"] for txn in listing.json()] == [account_id]


async def test_create_transfer_recording_money_leaving_the_tracked_accounts(client):
    """An answer of outside carries no account and is stored as its own state."""
    headers, account_id, _, transfer_id = await _setup_transfer_user(client)

    resp = await _create_transaction(
        client, headers, account_id, transfer_id, counterparty_account_scope="outside",
    )

    assert resp.status_code == 201
    assert resp.json()["counterparty_account_scope"] == "outside"
    assert resp.json()["counterparty_account_id"] is None


async def test_create_transfer_recording_its_own_account_is_rejected(client):
    """Money cannot move from an account to itself."""
    headers, account_id, _, transfer_id = await _setup_transfer_user(client)

    resp = await _create_transaction(
        client, headers, account_id, transfer_id,
        counterparty_account_scope="tracked", counterparty_account_id=account_id,
    )

    assert resp.status_code == 422


async def test_create_transfer_recording_an_unreachable_account_is_rejected(client):
    """Another user's account cannot be recorded as the counterparty."""
    headers, account_id, _, transfer_id = await _setup_transfer_user(client)
    _, stranger_account_id, _ = await _setup_user_with_deps(
        client, email="second@example.com", name_prefix="Other",
    )

    resp = await _create_transaction(
        client, headers, account_id, transfer_id,
        counterparty_account_scope="tracked", counterparty_account_id=stranger_account_id,
    )

    assert resp.status_code == 404


async def test_create_transfer_with_a_tracked_answer_and_no_account_is_rejected(client):
    """The two columns have to agree, which the database rule also enforces."""
    headers, account_id, _, transfer_id = await _setup_transfer_user(client)

    resp = await _create_transaction(
        client, headers, account_id, transfer_id, counterparty_account_scope="tracked",
    )

    assert resp.status_code == 422


async def test_the_database_refuses_an_account_recorded_without_a_scope(client):
    """The check constraint holds on writes that do not come through the API."""
    headers, account_id, counterparty_account_id, transfer_id = await _setup_transfer_user(client)
    created = await _create_transaction(
        client, headers, account_id, transfer_id, counterparty_account_scope="outside",
    )
    txn_id = created.json()["id"]

    with pytest.raises(IntegrityError):
        async with TestSession() as session:
            txn = await session.get(Transaction, uuid.UUID(txn_id))
            txn.counterparty_account_id = uuid.UUID(counterparty_account_id)
            txn.counterparty_account_scope = None
            await session.commit()


async def test_the_database_refuses_a_tracked_scope_with_no_account(client):
    """The other half of the same rule, which the API rejects before the database sees it."""
    headers, account_id, _, transfer_id = await _setup_transfer_user(client)
    created = await _create_transaction(
        client, headers, account_id, transfer_id, counterparty_account_scope="outside",
    )
    txn_id = created.json()["id"]

    with pytest.raises(IntegrityError):
        async with TestSession() as session:
            txn = await session.get(Transaction, uuid.UUID(txn_id))
            txn.counterparty_account_scope = TransferCounterpartyScope.TRACKED
            await session.commit()


async def test_balance_adjustment_rejects_the_field(client):
    """A balance adjustment is a correction with no counterparty account."""
    headers, account_id, counterparty_account_id, _ = await _setup_transfer_user(client)
    balance_adjustment_id = await _get_system_category_id(client, headers, "Balance Adjustment")

    resp = await _create_transaction(
        client, headers, account_id, balance_adjustment_id,
        counterparty_account_scope="tracked", counterparty_account_id=counterparty_account_id,
    )

    assert resp.status_code == 422


async def test_balance_adjustment_needs_no_answer(client):
    """The requirement covers transfer categories with a counterparty account, which excludes this one."""
    headers, account_id, _, _ = await _setup_transfer_user(client)
    balance_adjustment_id = await _get_system_category_id(client, headers, "Balance Adjustment")

    resp = await _create_transaction(client, headers, account_id, balance_adjustment_id)

    assert resp.status_code == 201


async def test_expense_rejects_the_field(client):
    """Only transfers record a counterparty account."""
    headers, account_id, category_id = await _setup_user_with_deps(client)

    resp = await _create_transaction(
        client, headers, account_id, category_id, counterparty_account_scope="outside",
    )

    assert resp.status_code == 422


async def test_editing_an_unanswered_transfer_is_refused_until_it_answers(client):
    """Touching a transfer recorded before the field existed is what brings it onto the new footing."""
    headers, account_id, _, transfer_id = await _setup_transfer_user(client)
    created = await _create_transaction(
        client, headers, account_id, transfer_id, counterparty_account_scope="outside",
    )
    txn_id = created.json()["id"]

    # Empty both columns to match a row predating them, which the API itself cannot produce
    async with TestSession() as session:
        txn = await session.get(Transaction, uuid.UUID(txn_id))
        txn.counterparty_account_scope = None
        txn.counterparty_account_id = None
        await session.commit()

    resp = await client.patch(f"/transactions/{txn_id}", json={"notes": "corrected"}, headers=headers)

    assert resp.status_code == 422

    # Answering it in the same edit is what lets the correction through
    answered = await client.patch(
        f"/transactions/{txn_id}",
        json={"notes": "corrected", "counterparty_account_scope": "outside"},
        headers=headers,
    )
    assert answered.status_code == 200
    assert answered.json()["notes"] == "corrected"


async def test_update_can_record_the_answer_later(client):
    """The field is accepted on update so history can be filled in."""
    headers, account_id, counterparty_account_id, transfer_id = await _setup_transfer_user(client)
    created = await _create_transaction(
        client, headers, account_id, transfer_id, counterparty_account_scope="outside",
    )
    txn_id = created.json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={"counterparty_account_scope": "tracked", "counterparty_account_id": counterparty_account_id},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["counterparty_account_id"] == counterparty_account_id


async def test_moving_to_a_category_with_no_counterparty_account_clears_the_answer(client):
    """A category change drops an answer that no longer applies rather than refusing the edit."""
    headers, account_id, counterparty_account_id, transfer_id = await _setup_transfer_user(client)
    expense_id = (await _create_category(client, headers, name="Groceries run", kind="expense")).json()["id"]
    created = await _create_transaction(
        client, headers, account_id, transfer_id,
        counterparty_account_scope="tracked", counterparty_account_id=counterparty_account_id,
    )
    txn_id = created.json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}", json={"category_id": expense_id}, headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["counterparty_account_id"] is None
    assert resp.json()["counterparty_account_scope"] is None


async def test_setting_the_field_alongside_a_category_that_rejects_it_fails(client):
    """An explicit answer on a category with no counterparty account is a contradiction, not a clear."""
    headers, account_id, counterparty_account_id, transfer_id = await _setup_transfer_user(client)
    expense_id = (await _create_category(client, headers, name="Groceries trip", kind="expense")).json()["id"]
    created = await _create_transaction(
        client, headers, account_id, transfer_id, counterparty_account_scope="outside",
    )
    txn_id = created.json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={
            "category_id": expense_id,
            "counterparty_account_scope": "tracked",
            "counterparty_account_id": counterparty_account_id,
        },
        headers=headers,
    )

    assert resp.status_code == 422


async def test_editing_a_transaction_into_a_transfer_requires_an_answer(client):
    """An edit that forms a new transfer answers the question the same way creating one does."""
    headers, account_id, _, transfer_id = await _setup_transfer_user(client)
    expense_id = (await _create_category(client, headers, name="Corner shop", kind="expense")).json()["id"]
    created = await _create_transaction(client, headers, account_id, expense_id)
    txn_id = created.json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}", json={"category_id": transfer_id}, headers=headers,
    )

    assert resp.status_code == 422


async def test_editing_a_transaction_into_a_transfer_succeeds_with_an_answer(client):
    """The same edit goes through once it records its counterparty account."""
    headers, account_id, counterparty_account_id, transfer_id = await _setup_transfer_user(client)
    expense_id = (await _create_category(client, headers, name="Corner store", kind="expense")).json()["id"]
    created = await _create_transaction(client, headers, account_id, expense_id)
    txn_id = created.json()["id"]

    resp = await client.patch(
        f"/transactions/{txn_id}",
        json={
            "category_id": transfer_id,
            "counterparty_account_scope": "tracked",
            "counterparty_account_id": counterparty_account_id,
        },
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["counterparty_account_id"] == counterparty_account_id


async def test_editing_an_answered_transfer_needs_nothing_resent(client):
    """A transfer that already records its counterparty account is untouched by the requirement."""
    headers, account_id, _, transfer_id = await _setup_transfer_user(client)
    created = await _create_transaction(
        client, headers, account_id, transfer_id, counterparty_account_scope="outside",
    )
    txn_id = created.json()["id"]

    resp = await client.patch(f"/transactions/{txn_id}", json={"amount": -777}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["counterparty_account_scope"] == "outside"
