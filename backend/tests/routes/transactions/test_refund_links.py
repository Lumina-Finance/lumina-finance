import pytest

from tests.routes.transactions._helpers import (
    NONEXISTENT_ID,
    _create_account,
    _create_category,
    _create_transaction,
    _seed_usd_currency,
    _setup_user_with_deps,
)


async def _create_refund(client, headers, account_id, category_id, expense_id, **overrides):
    """Create a refund of an expense through POST /transactions"""
    return await _create_transaction(
        client,
        headers,
        account_id,
        category_id,
        **{"amount": 5000, "refund_of_transaction_id": expense_id, **overrides},
    )


async def _get_transaction(client, headers, transaction_id):
    """Fetch one transaction's response body"""
    return (await client.get(f"/transactions/{transaction_id}", headers=headers)).json()


async def test_creating_a_refund_links_it_to_its_expense(client):
    """A refund created against an expense shows the link on both transactions."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()

    resp = await _create_refund(client, headers, account_id, category_id, expense["id"])

    assert resp.status_code == 201
    refund = resp.json()
    assert refund["refund_of_transaction_id"] == expense["id"]
    assert refund["refund_transaction_ids"] == []
    assert (await _get_transaction(client, headers, expense["id"]))["refund_transaction_ids"] == [refund["id"]]


async def test_listing_shows_links_on_both_transactions(client):
    """The list carries each transaction's links, so rows can show them without more requests."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    first = (await _create_refund(client, headers, account_id, category_id, expense["id"], amount=2000)).json()
    second = (await _create_refund(client, headers, account_id, category_id, expense["id"], amount=3000)).json()

    rows = {row["id"]: row for row in (await client.get("/transactions", headers=headers)).json()}

    assert rows[expense["id"]]["refund_transaction_ids"] == [first["id"], second["id"]]
    assert rows[first["id"]]["refund_of_transaction_id"] == expense["id"]
    assert rows[second["id"]]["refund_of_transaction_id"] == expense["id"]


async def test_a_refund_must_be_money_coming_in(client):
    """An outflow cannot be saved as a refund, and nothing is created."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()

    resp = await _create_transaction(
        client,
        headers,
        account_id,
        category_id,
        amount=-100,
        refund_of_transaction_id=expense["id"],
    )

    assert resp.status_code == 422
    assert resp.json()["detail"] == "A refund must be money coming in"
    assert len((await client.get("/transactions", headers=headers)).json()) == 1


async def test_only_an_expense_can_be_refunded(client):
    """An inflow, or an outflow in an income category, is refused as the thing refunded."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    income_category_id = (await _create_category(client, headers, name="Pay", kind="income")).json()["id"]
    inflow = (await _create_transaction(client, headers, account_id, category_id, amount=900)).json()
    income_outflow = (await _create_transaction(client, headers, account_id, income_category_id)).json()

    for original in (inflow, income_outflow):
        resp = await _create_refund(client, headers, account_id, category_id, original["id"])
        assert resp.status_code == 422
        assert resp.json()["detail"] == "Only an expense can be refunded"


async def test_another_users_expense_cannot_be_refunded(client):
    """Naming a transaction that is not yours answers 404 and reveals nothing."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_headers, other_account_id, other_category_id = await _setup_user_with_deps(
        client,
        email="other@example.com",
        name_prefix="Other",
    )
    other_expense = (await _create_transaction(client, other_headers, other_account_id, other_category_id)).json()

    resp = await _create_refund(client, headers, account_id, category_id, other_expense["id"])
    missing = await _create_refund(client, headers, account_id, category_id, NONEXISTENT_ID)

    assert resp.status_code == 404
    assert missing.status_code == 404
    assert resp.json() == missing.json()


async def test_unlinking_keeps_both_transactions(client):
    """Unlinking removes only the link, from either side's view."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = (await _create_refund(client, headers, account_id, category_id, expense["id"])).json()

    resp = await client.delete(f"/transactions/{refund['id']}/refund-link", headers=headers)

    assert resp.status_code == 204
    assert (await _get_transaction(client, headers, refund["id"]))["refund_of_transaction_id"] is None
    assert (await _get_transaction(client, headers, expense["id"]))["refund_transaction_ids"] == []
    assert (await client.delete(f"/transactions/{refund['id']}/refund-link", headers=headers)).status_code == 404


async def test_another_user_cannot_unlink_a_refund(client):
    """Unlinking someone else's refund answers 404 and leaves the link."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_headers, _, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = (await _create_refund(client, headers, account_id, category_id, expense["id"])).json()

    resp = await client.delete(f"/transactions/{refund['id']}/refund-link", headers=other_headers)

    assert resp.status_code == 404
    assert (await _get_transaction(client, headers, refund["id"]))["refund_of_transaction_id"] == expense["id"]


async def test_deleting_either_side_removes_the_link(client):
    """Deleting the refund frees the expense, and deleting the expense leaves the refund unlinked."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = (await _create_refund(client, headers, account_id, category_id, expense["id"], amount=2500)).json()
    other_refund = (await _create_refund(client, headers, account_id, category_id, expense["id"], amount=2500)).json()

    assert (await client.delete(f"/transactions/{refund['id']}", headers=headers)).status_code == 204
    assert (await _get_transaction(client, headers, expense["id"]))["refund_transaction_ids"] == [other_refund["id"]]

    assert (await client.delete(f"/transactions/{expense['id']}", headers=headers)).status_code == 204
    assert (await _get_transaction(client, headers, other_refund["id"]))["refund_of_transaction_id"] is None


@pytest.mark.parametrize(
    ("account_currency", "refund_overrides"),
    [
        ("USD", {"currency": "USD"}),
        ("CAD", {"currency": "USD", "fx_rate": 0.7}),
    ],
)
async def test_creating_a_refund_in_another_currency_is_refused_and_writes_nothing(client, account_currency, refund_overrides):
    """A refund whose own currency is another one is refused, whatever its account, with no transaction left behind."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    await _seed_usd_currency()
    refund_account_id = (await _create_account(client, headers, name="Other", currency=account_currency)).json()["id"]

    resp = await _create_refund(client, headers, refund_account_id, category_id, expense["id"], **refund_overrides)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "A refund can only be linked to an expense in its own currency"
    assert (await _get_transaction(client, headers, expense["id"]))["refund_transaction_ids"] == []
    listed = await client.get("/transactions", params={"account_id": refund_account_id}, headers=headers)
    assert listed.json() == []


async def test_a_refund_from_another_account_in_the_same_currency_is_accepted(client):
    """The refusal turns on currency alone, so money back to a second account in that currency still links."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    second_account_id = (await _create_account(client, headers, name="Second")).json()["id"]

    resp = await _create_refund(client, headers, second_account_id, category_id, expense["id"])

    assert resp.status_code == 201
    assert resp.json()["refund_of_transaction_id"] == expense["id"]


async def test_a_refund_in_the_expenses_currency_on_an_account_in_another_is_accepted(client):
    """The rule compares the transactions' own currencies, so the account's currency doesn't refuse it."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    await _seed_usd_currency()
    usd_account_id = (await _create_account(client, headers, name="US", currency="USD")).json()["id"]

    resp = await _create_refund(client, headers, usd_account_id, category_id, expense["id"], fx_rate=1.3)

    assert resp.status_code == 201
    assert resp.json()["refund_of_transaction_id"] == expense["id"]
