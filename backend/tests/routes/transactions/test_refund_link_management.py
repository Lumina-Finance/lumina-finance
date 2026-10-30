"""Linking an existing refund, choosing what deleting a linked transaction takes, and keeping links valid"""

from tests.routes.transactions._helpers import (
    NONEXISTENT_ID,
    _create_account,
    _create_category,
    _create_transaction,
    _get,
    _link,
    _refund,
    _seed_usd_currency,
    _setup_user_with_deps,
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


async def test_deleting_an_expense_with_its_refunds_removes_all_of_them(client):
    """Deleting an expense with its refunds leaves nothing of them and nothing else changes."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    first = await _refund(client, headers, account_id, category_id, expense["id"], amount=2500)
    second = await _refund(client, headers, account_id, category_id, expense["id"], amount=2500)
    bystander = (await _create_transaction(client, headers, account_id, category_id)).json()

    resp = await client.post(
        "/transactions/bulk/delete",
        json={"transaction_ids": [expense["id"], first["id"], second["id"]]},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["transactions_deleted"] == 3
    remaining = [row["id"] for row in (await client.get("/transactions", headers=headers)).json()]
    assert remaining == [bystander["id"]]


async def test_deleting_a_refund_with_its_expense_unlinks_its_sibling_refunds(client):
    """The expense goes with the refund, and another refund of it stays, unlinked."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = await _refund(client, headers, account_id, category_id, expense["id"], amount=2500)
    sibling = await _refund(client, headers, account_id, category_id, expense["id"], amount=2500)

    resp = await client.post(
        "/transactions/bulk/delete",
        json={"transaction_ids": [refund["id"], expense["id"]]},
        headers=headers,
    )

    assert resp.status_code == 200
    assert (await _get(client, headers, sibling["id"]))["refund_of_transaction_id"] is None
    assert (await client.get(f"/transactions/{expense['id']}", headers=headers)).status_code == 404


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
        assert "Unlink it first" in resp.json()["detail"]
        assert (await _get(client, headers, transaction["id"]))["amount"] == transaction["amount"]

    bulk = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [expense["id"], refund["id"]], "direction": "reverse"},
        headers=headers,
    )
    assert bulk.status_code == 422
    assert (await _get(client, headers, expense["id"]))["amount"] == expense["amount"]


async def test_an_edit_cannot_file_a_linked_expense_or_refund_under_the_wrong_kind_of_category(client):
    """Filing a linked expense under income, or its refund as a transfer, is refused."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    income_id = (await _create_category(client, headers, name="Pay", kind="income")).json()["id"]
    transfer_id = (await _create_category(client, headers, name="Move", kind="transfer")).json()["id"]
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = await _refund(client, headers, account_id, category_id, expense["id"])

    for transaction, changes in (
        (expense, {"category_id": income_id}),
        (refund, {"category_id": transfer_id, "counterparty_account_scope": "outside"}),
    ):
        resp = await client.patch(f"/transactions/{transaction['id']}", json=changes, headers=headers)
        assert resp.status_code == 422, resp.text
        assert (await _get(client, headers, transaction["id"]))["category_id"] == category_id


async def test_a_transaction_in_an_archived_account_is_neither_offered_nor_linked(client):
    """Linking refuses an archived account on either side, and the picker leaves such rows out."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    archived_id = (await _create_account(client, headers, name="Old")).json()["id"]
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    old_expense = (await _create_transaction(client, headers, archived_id, category_id)).json()
    old_refund = (await _create_transaction(client, headers, archived_id, category_id, amount=700)).json()
    await client.patch(f"/accounts/{archived_id}", json={"is_archived": True}, headers=headers)

    assert await _candidates(client, headers, expense["id"]) == []
    assert await _candidates(client, headers, old_refund["id"]) == []
    assert (await _link(client, headers, old_refund["id"], expense["id"])).status_code == 422
    refund = (await _create_transaction(client, headers, account_id, category_id, amount=700)).json()
    assert (await _link(client, headers, refund["id"], old_expense["id"])).status_code == 422


async def _group_account_id(client, headers):
    """Create a group and an account belonging to it, and return the account id"""
    group_id = (await client.post("/groups", json={"name": "Smith Family"}, headers=headers)).json()["id"]
    return (await _create_account(client, headers, name="Shared", group_id=group_id)).json()["id"]


async def test_a_transaction_in_a_group_account_is_neither_offered_nor_linked(client):
    """Linking refuses a group account on either side, an edit cannot move a refund into one, and the picker leaves it out."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    group_account_id = await _group_account_id(client, headers)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = (await _create_transaction(client, headers, account_id, category_id, amount=700)).json()
    shared_expense = (await _create_transaction(client, headers, group_account_id, category_id)).json()
    shared_refund = (await _create_transaction(client, headers, group_account_id, category_id, amount=700)).json()

    assert await _candidates(client, headers, expense["id"]) == [refund["id"]]
    assert await _candidates(client, headers, refund["id"]) == [expense["id"]]
    assert await _candidates(client, headers, shared_refund["id"]) == []
    assert (await _link(client, headers, shared_refund["id"], expense["id"])).status_code == 422
    assert (await _link(client, headers, refund["id"], shared_expense["id"])).status_code == 422

    await _link(client, headers, refund["id"], expense["id"])
    moved = await client.patch(f"/transactions/{refund['id']}", json={"account_id": group_account_id}, headers=headers)
    assert moved.status_code == 422
    assert (await _get(client, headers, refund["id"]))["account_id"] == account_id


async def test_the_picker_offers_only_what_linking_accepts(client):
    """A transfer inflow is not offered to an expense, and an income-category outflow is not offered to a refund."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    income_id = (await _create_category(client, headers, name="Pay", kind="income")).json()["id"]
    transfer_id = (await _create_category(client, headers, name="Move", kind="transfer")).json()["id"]
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = (await _create_transaction(client, headers, account_id, category_id, amount=700)).json()
    transfer_in = (await _create_transaction(client, headers, account_id, transfer_id, amount=900, counterparty_account_scope="outside")).json()
    income_out = (await _create_transaction(client, headers, account_id, income_id, amount=-300)).json()

    assert await _candidates(client, headers, expense["id"]) == [refund["id"]]
    assert await _candidates(client, headers, refund["id"]) == [expense["id"]]
    assert (await _link(client, headers, transfer_in["id"], expense["id"])).status_code == 422
    assert (await _link(client, headers, refund["id"], income_out["id"])).status_code == 422


async def _candidates(client, headers, transaction_id, **params):
    """Fetch the ids of the transactions this one can be linked to"""
    resp = await client.get(f"/transactions/{transaction_id}/refund-link-candidates", params=params, headers=headers)
    assert resp.status_code == 200, resp.text
    return [row["id"] for row in resp.json()]


async def test_an_expense_is_offered_the_money_that_came_in_and_nothing_claimed(client):
    """Only inflows not already the refund of something are offered, and a search narrows them."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    other_expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    free = (await _create_transaction(client, headers, account_id, category_id, amount=700, notes="Store credit")).json()
    claimed = await _refund(client, headers, account_id, category_id, other_expense["id"])

    offered = await _candidates(client, headers, expense["id"])

    assert offered == [free["id"]]
    assert claimed["id"] not in offered
    assert await _candidates(client, headers, expense["id"], q="Store") == [free["id"]]
    assert await _candidates(client, headers, expense["id"], q="Nothing like this") == []


async def test_candidates_come_exact_amount_first_then_nearest_then_newest(client):
    """An exact amount leads, then the nearer amounts, and a tie in distance goes to the newer date."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id, amount=-5000)).json()
    nearby_expense = (await _create_transaction(client, headers, account_id, category_id, amount=-5100)).json()
    ids = {}
    for name, amount, dt in [
        ("old exact", 5000, "2026-03-01"),
        ("near newer", 4800, "2026-03-13"),
        ("near older", 5200, "2026-03-12"),
        ("far", 4000, "2026-03-10"),
        ("farthest", 9000, "2026-03-20"),
    ]:
        ids[name] = (await _create_transaction(client, headers, account_id, category_id, amount=amount, dt=dt)).json()["id"]

    exact_first = await _candidates(client, headers, expense["id"])
    no_exact = await _candidates(client, headers, nearby_expense["id"])

    assert exact_first == [ids["old exact"], ids["near newer"], ids["near older"], ids["far"], ids["farthest"]]
    assert no_exact == [ids["near older"], ids["old exact"], ids["near newer"], ids["far"], ids["farthest"]]


async def test_candidates_are_narrowed_by_the_list_filters(client):
    """The transaction list's filters keep only the candidates they match."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id, amount=-5000)).json()
    early = (await _create_transaction(client, headers, account_id, category_id, amount=5000, dt="2026-03-01")).json()
    other_category_id = (await _create_category(client, headers, name="Gifts")).json()["id"]
    late = (await _create_transaction(client, headers, account_id, other_category_id, amount=800, dt="2026-03-20")).json()

    assert await _candidates(client, headers, expense["id"], category_id=other_category_id) == [late["id"]]
    assert await _candidates(client, headers, expense["id"], from_date="2026-03-10") == [late["id"]]
    assert await _candidates(client, headers, expense["id"], to_date="2026-03-10") == [early["id"]]
    assert await _candidates(client, headers, expense["id"], min_amount=1000, max_amount=6000, amount_currency="CAD") == [early["id"]]
    assert await _candidates(client, headers, expense["id"], account_id=account_id) == [early["id"], late["id"]]


async def test_a_refund_is_offered_the_expenses_until_it_is_linked(client):
    """An unlinked inflow is offered the expenses, and a linked one is offered none."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = (await _create_transaction(client, headers, account_id, category_id, amount=700)).json()

    assert await _candidates(client, headers, refund["id"]) == [expense["id"]]

    await _link(client, headers, refund["id"], expense["id"])

    assert await _candidates(client, headers, refund["id"]) == []


async def test_a_transfer_and_another_users_transaction_have_no_candidates(client):
    """A transfer is offered nothing, and someone else's transaction answers 404."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_headers, _, _ = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")
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
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()

    assert await _candidates(client, headers, transfer["id"]) == []
    resp = await client.get(f"/transactions/{expense['id']}/refund-link-candidates", headers=other_headers)
    assert resp.status_code == 404


async def test_an_edit_that_keeps_the_link_valid_is_accepted(client):
    """Changing a linked refund's amount or note is an ordinary edit."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = await _refund(client, headers, account_id, category_id, expense["id"])

    resp = await client.patch(f"/transactions/{refund['id']}", json={"amount": 777, "notes": "Partial"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["refund_of_transaction_id"] == expense["id"]


async def test_a_refund_in_another_currency_is_neither_offered_nor_linked(client):
    """The picker leaves out money in another currency, so a direct request to link it is refused too."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    same = (await _create_transaction(client, headers, account_id, category_id, amount=700)).json()
    await _seed_usd_currency()
    usd_account_id = (await _create_account(client, headers, name="US", currency="USD")).json()["id"]
    usd_refund = (await _create_transaction(client, headers, usd_account_id, category_id, amount=700, currency="USD")).json()
    usd_expense = (await _create_transaction(client, headers, usd_account_id, category_id, currency="USD")).json()

    assert await _candidates(client, headers, expense["id"]) == [same["id"]]
    assert await _candidates(client, headers, same["id"]) == [expense["id"]]
    for refund_id, original_id in ((usd_refund["id"], expense["id"]), (same["id"], usd_expense["id"])):
        resp = await _link(client, headers, refund_id, original_id)
        assert resp.status_code == 422
        assert resp.json()["detail"] == "A refund can only be linked to an expense in its own currency"
        assert (await _get(client, headers, refund_id))["refund_of_transaction_id"] is None


async def test_a_missing_transaction_and_another_users_answer_the_same(client):
    """Linking, unlinking and listing candidates can't tell someone else's transaction from one that doesn't exist."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    other_headers, other_account_id, other_category_id = await _setup_user_with_deps(client, email="other@example.com", name_prefix="Other")
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = await _refund(client, headers, account_id, category_id, expense["id"], amount=100)
    free = (await _create_transaction(client, headers, account_id, category_id, amount=100)).json()
    their_inflow = (await _create_transaction(client, other_headers, other_account_id, other_category_id, amount=100)).json()
    their_expense = (await _create_transaction(client, other_headers, other_account_id, other_category_id)).json()

    pairs = (
        (await _link(client, headers, NONEXISTENT_ID, expense["id"]), await _link(client, headers, their_inflow["id"], expense["id"])),
        (await _link(client, headers, free["id"], NONEXISTENT_ID), await _link(client, headers, free["id"], their_expense["id"])),
        (
            await client.delete(f"/transactions/{NONEXISTENT_ID}/refund-link", headers=other_headers),
            await client.delete(f"/transactions/{refund['id']}/refund-link", headers=other_headers),
        ),
        (
            await client.get(f"/transactions/{NONEXISTENT_ID}/refund-link-candidates", headers=other_headers),
            await client.get(f"/transactions/{expense['id']}/refund-link-candidates", headers=other_headers),
        ),
    )

    for missing, not_theirs in pairs:
        assert missing.status_code == 404
        assert not_theirs.status_code == 404
        assert missing.json() == not_theirs.json()
    assert their_inflow["id"] not in await _candidates(client, headers, expense["id"], unlinked_id=their_inflow["id"])


async def test_a_bulk_edit_that_files_a_linked_row_under_the_wrong_category_changes_nothing(client):
    """The set holding a linked expense moved to income is refused whole, and an edit that keeps the link passes."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    income_id = (await _create_category(client, headers, name="Pay", kind="income")).json()["id"]
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = await _refund(client, headers, account_id, category_id, expense["id"], amount=100)
    bystander = (await _create_transaction(client, headers, account_id, category_id)).json()

    refused = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [expense["id"], bystander["id"]], "category_id": income_id},
        headers=headers,
    )
    kept = await client.patch(
        "/transactions/bulk",
        json={"transaction_ids": [expense["id"], refund["id"]], "dt": "2026-02-02"},
        headers=headers,
    )

    assert refused.status_code == 422
    assert "Unlink it first" in refused.json()["detail"]
    assert (await _get(client, headers, bystander["id"]))["category_id"] == category_id
    assert kept.status_code == 200
    assert (await _get(client, headers, refund["id"]))["refund_of_transaction_id"] == expense["id"]
