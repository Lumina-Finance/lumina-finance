"""Linking an existing refund, choosing what deleting a linked transaction takes, and keeping links valid"""

from tests.routes.transactions._helpers import (
    _create_category,
    _create_transaction,
    _setup_user_with_deps,
)


async def _refund(client, headers, account_id, category_id, expense_id, **overrides):
    """Create a refund of an expense through POST /transactions"""
    return (
        await _create_transaction(
            client,
            headers,
            account_id,
            category_id,
            **{"amount": 5000, "refund_of_transaction_id": expense_id, **overrides},
        )
    ).json()


async def _get(client, headers, transaction_id):
    """Fetch one transaction's response body"""
    return (await client.get(f"/transactions/{transaction_id}", headers=headers)).json()


async def _link(client, headers, refund_id, original_id):
    """Link an existing transaction as the refund of an expense"""
    return await client.post(
        f"/transactions/{refund_id}/refund-link",
        json={"original_transaction_id": original_id},
        headers=headers,
    )


async def test_an_existing_transaction_can_be_linked_as_a_refund(client):
    """Linking a refund entered earlier shows the link on both and changes no amount."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = (await _create_transaction(client, headers, account_id, category_id, amount=1200)).json()

    resp = await _link(client, headers, refund["id"], expense["id"])

    assert resp.status_code == 204
    linked_refund = await _get(client, headers, refund["id"])
    assert linked_refund["refund_of_transaction_id"] == expense["id"]
    assert linked_refund["amount"] == 1200
    assert (await _get(client, headers, expense["id"]))["refund_transaction_ids"] == [refund["id"]]


async def test_a_refund_links_to_one_expense_only(client):
    """A refund already linked is refused a second expense, so unlinking comes first."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    other_expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = await _refund(client, headers, account_id, category_id, expense["id"])

    resp = await _link(client, headers, refund["id"], other_expense["id"])

    assert resp.status_code == 409
    assert resp.json()["detail"] == "This refund is already linked to an expense"
    assert (await _get(client, headers, refund["id"]))["refund_of_transaction_id"] == expense["id"]


async def test_linking_refuses_what_is_not_a_refund_of_an_expense(client):
    """Money going out, itself, or a non-expense is refused and nothing is linked."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    outflow = (await _create_transaction(client, headers, account_id, category_id, amount=-100)).json()
    income_category_id = (await _create_category(client, headers, name="Pay", kind="income")).json()["id"]
    inflow = (await _create_transaction(client, headers, account_id, category_id, amount=900)).json()
    pay = (await _create_transaction(client, headers, account_id, income_category_id, amount=900)).json()

    assert (await _link(client, headers, outflow["id"], expense["id"])).json()["detail"] == "A refund must be money coming in"
    assert (await _link(client, headers, inflow["id"], inflow["id"])).json()["detail"] == "A transaction can't refund itself"
    assert (await _link(client, headers, inflow["id"], pay["id"])).json()["detail"] == "Only an expense can be refunded"
    assert (await _get(client, headers, inflow["id"]))["refund_of_transaction_id"] is None


async def test_a_transfer_cannot_be_a_refund(client):
    """A refund filed under a transfer category is refused, since a transfer is not income."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    transfer_category_id = (await _create_category(client, headers, name="Move", kind="transfer")).json()["id"]
    transfer = (
        await _create_transaction(
            client,
            headers,
            account_id,
            transfer_category_id,
            amount=500,
            counterparty_account_scope="outside",
        )
    ).json()

    created = await _create_transaction(
        client,
        headers,
        account_id,
        transfer_category_id,
        amount=500,
        counterparty_account_scope="outside",
        refund_of_transaction_id=expense["id"],
    )
    linked = await _link(client, headers, transfer["id"], expense["id"])

    for resp in (created, linked):
        assert resp.status_code == 422
        assert resp.json()["detail"] == "A transfer can't be a refund"


async def test_another_user_cannot_link_a_refund(client):
    """Linking someone else's transactions answers 404 and leaves them unlinked."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_headers, _, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = (await _create_transaction(client, headers, account_id, category_id, amount=500)).json()

    assert (await _link(client, other_headers, refund["id"], expense["id"])).status_code == 404
    assert (await _get(client, headers, refund["id"]))["refund_of_transaction_id"] is None


async def test_deleting_with_its_linked_transactions_removes_all_of_them(client):
    """Choosing to delete the linked ones deletes an expense with its refunds, and nothing else."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    await _refund(client, headers, account_id, category_id, expense["id"])
    await _refund(client, headers, account_id, category_id, expense["id"])
    bystander = (await _create_transaction(client, headers, account_id, category_id)).json()

    resp = await client.delete(f"/transactions/{expense['id']}?delete_linked=true", headers=headers)

    assert resp.status_code == 204
    remaining = [row["id"] for row in (await client.get("/transactions", headers=headers)).json()]
    assert remaining == [bystander["id"]]


async def test_deleting_a_refund_with_its_expense_unlinks_its_sibling_refunds(client):
    """The expense goes with the refund, and another refund of it stays, unlinked."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = await _refund(client, headers, account_id, category_id, expense["id"])
    sibling = await _refund(client, headers, account_id, category_id, expense["id"])

    resp = await client.delete(f"/transactions/{refund['id']}?delete_linked=true", headers=headers)

    assert resp.status_code == 204
    assert (await _get(client, headers, sibling["id"]))["refund_of_transaction_id"] is None
    assert (await client.get(f"/transactions/{expense['id']}", headers=headers)).status_code == 404


async def test_bulk_delete_with_linked_removes_the_other_sides(client):
    """A bulk delete that chooses the linked ones takes the transactions linked to the selected."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = await _refund(client, headers, account_id, category_id, expense["id"])

    resp = await client.post(
        "/transactions/bulk/delete",
        json={"transaction_ids": [refund["id"]], "delete_linked": True},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["transactions_deleted"] == 2
    assert (await client.get("/transactions", headers=headers)).json() == []


async def test_bulk_delete_without_the_choice_keeps_the_other_side(client):
    """Without the choice only the link goes and the other transaction stays."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = await _refund(client, headers, account_id, category_id, expense["id"])

    await client.post("/transactions/bulk/delete", json={"transaction_ids": [expense["id"]]}, headers=headers)

    assert (await _get(client, headers, refund["id"]))["refund_of_transaction_id"] is None


async def test_an_edit_cannot_leave_a_link_between_things_that_are_not_a_refund_and_an_expense(client):
    """Flipping a linked refund to money out, or its expense to money in, is refused whole."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = await _refund(client, headers, account_id, category_id, expense["id"])

    for transaction, amount in ((refund, -500), (expense, 500)):
        resp = await client.patch(f"/transactions/{transaction['id']}", json={"amount": amount}, headers=headers)
        assert resp.status_code == 422
        assert "Unlink them first" in resp.json()["detail"]
        assert (await _get(client, headers, transaction["id"]))["amount"] == transaction["amount"]

    bulk = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [expense["id"], refund["id"]], "direction": "reverse"},
        headers=headers,
    )
    assert bulk.status_code == 422
    assert (await _get(client, headers, expense["id"]))["amount"] == expense["amount"]


async def test_an_edit_that_keeps_the_link_valid_is_accepted(client):
    """Changing a linked refund's amount or note is an ordinary edit."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = await _refund(client, headers, account_id, category_id, expense["id"])

    resp = await client.patch(f"/transactions/{refund['id']}", json={"amount": 777, "notes": "Partial"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["refund_of_transaction_id"] == expense["id"]
