"""Refunds linked to one expense can't total more than the expense"""

from tests.routes.transactions._helpers import _create_transaction, _setup_user_with_deps
from tests.routes.transactions.test_refund_link_management import _get, _link, _refund

TOTAL_REFUSAL = "Refunds can't total more than the expense they refund"


async def test_refunds_cannot_total_more_than_the_expense(client):
    """A refund that would pass the expense's amount is refused whether it is created or linked."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    await _refund(client, headers, account_id, category_id, expense["id"], amount=3000)
    spare = (await _create_transaction(client, headers, account_id, category_id, amount=2001)).json()

    created = await _create_transaction(
        client,
        headers,
        account_id,
        category_id,
        amount=2001,
        refund_of_transaction_id=expense["id"],
    )
    linked = await _link(client, headers, spare["id"], expense["id"])

    for resp in (created, linked):
        assert resp.status_code == 422
        assert resp.json()["detail"] == TOTAL_REFUSAL
    assert len((await _get(client, headers, expense["id"]))["refund_transaction_ids"]) == 1


async def test_refunds_may_total_exactly_the_expense(client):
    """The last refund that brings the total to the expense's amount is accepted."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    await _refund(client, headers, account_id, category_id, expense["id"], amount=3000)
    exact = (await _create_transaction(client, headers, account_id, category_id, amount=2000)).json()

    assert (await _link(client, headers, exact["id"], expense["id"])).status_code == 204


async def test_an_edit_cannot_push_refunds_past_the_expense(client):
    """Raising a linked refund, or lowering its expense, below what the refunds total is refused whole."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    first = await _refund(client, headers, account_id, category_id, expense["id"], amount=2000)
    await _refund(client, headers, account_id, category_id, expense["id"], amount=2500)

    raised = await client.patch(f"/transactions/{first['id']}", json={"amount": 2600}, headers=headers)
    lowered = await client.patch(f"/transactions/{expense['id']}", json={"amount": -4000}, headers=headers)

    for resp in (raised, lowered):
        assert resp.status_code == 422
        assert "Refunds can't total more than the expense" in resp.json()["detail"]
    assert (await _get(client, headers, first["id"]))["amount"] == 2000
    assert (await _get(client, headers, expense["id"]))["amount"] == -5000


async def test_candidates_say_how_much_of_each_expense_is_already_refunded(client):
    """A refund's candidate expenses carry the total their refunds already give back."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    await _refund(client, headers, account_id, category_id, expense["id"], amount=1500)
    refund = (await _create_transaction(client, headers, account_id, category_id, amount=900)).json()

    resp = await client.get(f"/transactions/{refund['id']}/refund-link-candidates", headers=headers)

    assert [row["refunded_amount"] for row in resp.json()] == [1500]
