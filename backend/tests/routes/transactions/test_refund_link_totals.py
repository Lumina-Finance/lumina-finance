"""Refunds linked to one expense can't total more than the expense"""

import asyncio
import uuid

from sqlalchemy import select, text

from app.models.transaction import Transaction
from app.models.transaction_link import TransactionLink
from app.services.transactions import links as links_module
from app.services.transactions import update as update_module
from tests.conftest import TestSession
from tests.routes.budgets._utilization_helpers import _create_base_with_instance, _get_budget_utilization_entry
from tests.routes.support import _wait_until_blocked
from tests.routes.transactions._helpers import (
    _create_account,
    _create_transaction,
    _get,
    _link,
    _refund,
    _seed_usd_currency,
    _setup_user_with_deps,
)

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


async def test_a_refund_being_unlinked_is_offered_expenses_again(client):
    """With its link marked as removed, a linked refund lists the expenses, its own not counting its amount."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = await _refund(client, headers, account_id, category_id, expense["id"], amount=1500)
    url = f"/transactions/{refund['id']}/refund-link-candidates"

    still_linked = await client.get(url, headers=headers)
    unlinked = await client.get(url, params={"unlinked_id": refund["id"]}, headers=headers)

    assert still_linked.json() == []
    assert [(row["id"], row["refunded_amount"]) for row in unlinked.json()] == [(expense["id"], 0)]


async def test_an_expense_is_offered_the_refund_being_unlinked(client):
    """With a refund's link marked as removed, its expense lists it among the money that can be linked."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = await _refund(client, headers, account_id, category_id, expense["id"], amount=1500)
    url = f"/transactions/{expense['id']}/refund-link-candidates"

    still_linked = await client.get(url, headers=headers)
    unlinked = await client.get(url, params={"unlinked_id": refund["id"]}, headers=headers)

    assert [row["id"] for row in still_linked.json()] == []
    assert [row["id"] for row in unlinked.json()] == [refund["id"]]


async def test_concurrent_refunds_cannot_pass_the_expense(client):
    """Requests racing for the last of an expense queue behind its lock, so only one of each kind fits."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    created_for = (await _create_transaction(client, headers, account_id, category_id)).json()
    linked_for = (await _create_transaction(client, headers, account_id, category_id)).json()
    inflows = [(await _create_transaction(client, headers, account_id, category_id, amount=3000)).json() for _ in range(3)]

    created = await asyncio.gather(
        *[
            _create_transaction(client, headers, account_id, category_id, amount=3000, refund_of_transaction_id=created_for["id"])
            for _ in range(3)
        ],
    )
    linked = await asyncio.gather(*[_link(client, headers, inflow["id"], linked_for["id"]) for inflow in inflows])

    assert sorted(resp.status_code for resp in created) == [201, 422, 422]
    assert sorted(resp.status_code for resp in linked) == [204, 422, 422]


async def test_an_edit_raising_a_refund_waits_for_a_link_being_made(client, monkeypatch):
    """A raise that queues behind a link in flight counts it, rather than both passing and overshooting."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    first = await _refund(client, headers, account_id, category_id, expense["id"], amount=2000)
    second = (await _create_transaction(client, headers, account_id, category_id, amount=2500)).json()

    original = update_module.check_transaction_access
    entered = asyncio.Event()
    edit_pid = None

    async def record_edit(db, *args, **kwargs):
        nonlocal edit_pid
        edit_pid = await db.scalar(text("SELECT pg_backend_pid()"))
        entered.set()
        return await original(db, *args, **kwargs)

    monkeypatch.setattr(update_module, "check_transaction_access", record_edit)
    async with TestSession() as holder:
        await holder.execute(select(Transaction.id).where(Transaction.id == uuid.UUID(expense["id"])).with_for_update())
        holder.add(TransactionLink(refund_transaction_id=uuid.UUID(second["id"]), original_transaction_id=uuid.UUID(expense["id"])))
        await holder.flush()
        holder_pid = await holder.scalar(text("SELECT pg_backend_pid()"))
        edit = asyncio.create_task(client.patch(f"/transactions/{first['id']}", json={"amount": 3000}, headers=headers))
        await entered.wait()
        try:
            await _wait_until_blocked(holder_pid, edit_pid)
        finally:
            await holder.commit()
        resp = await edit

    assert resp.status_code == 422
    assert "Refunds can't total more than the expense" in resp.json()["detail"]
    assert (await _get(client, headers, first["id"]))["amount"] == 2000


async def test_a_refund_cannot_move_to_another_currencys_account_and_still_counts(client):
    """A move into another currency's account is refused, so the refund can't step out of the total."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = await _refund(client, headers, account_id, category_id, expense["id"], amount=3000)
    await _seed_usd_currency()
    usd_account_id = (await _create_account(client, headers, name="US", currency="USD")).json()["id"]

    moved = await client.patch(
        f"/transactions/{refund['id']}",
        json={"account_id": usd_account_id, "fx_rate": 1.3, "currency": "USD"},
        headers=headers,
    )
    raised = await client.patch(f"/transactions/{refund['id']}", json={"amount": 5001}, headers=headers)

    assert moved.status_code == 422
    assert raised.status_code == 422


async def test_a_link_changes_no_total_balance_or_budget(client):
    """Linking and unlinking leave the overview, the account balance and the budget exactly as they were."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    base_id, budget_id = await _create_base_with_instance(client, headers, category_ids=[category_id])
    expense = (await _create_transaction(client, headers, account_id, category_id, dt="2026-03-05", amount=-5000)).json()
    inflow = (await _create_transaction(client, headers, account_id, category_id, dt="2026-03-06", amount=2000)).json()

    async def figures():
        overview = (await client.get("/transactions/overview", headers=headers)).json()
        account = (await client.get(f"/accounts/{account_id}", headers=headers)).json()
        budget = await _get_budget_utilization_entry(client, headers, base_id, budget_id)
        return overview, account["current_balance"], budget["total_spent"]

    before = await figures()
    assert before[2] == 3000
    assert (await _link(client, headers, inflow["id"], expense["id"])).status_code == 204
    assert await figures() == before
    assert (await client.delete(f"/transactions/{inflow['id']}/refund-link", headers=headers)).status_code == 204
    assert await figures() == before


async def _deadlock_against(monkeypatch, module, request, expense_id, refund_id):
    """Hold the expense while the request holds the refund and waits for it, then close the cycle and return the answer"""
    original = module.check_transaction_access
    entered = asyncio.Event()
    request_pid = None

    async def record(db, *args, **kwargs):
        nonlocal request_pid
        request_pid = await db.scalar(text("SELECT pg_backend_pid()"))
        entered.set()
        return await original(db, *args, **kwargs)

    monkeypatch.setattr(module, "check_transaction_access", record)
    async with TestSession() as holder:
        await holder.execute(select(Transaction.id).where(Transaction.id == uuid.UUID(expense_id)).with_for_update())
        holder_pid = await holder.scalar(text("SELECT pg_backend_pid()"))
        task = asyncio.create_task(request())
        await entered.wait()
        await _wait_until_blocked(holder_pid, request_pid)

        # The request has waited longest, so Postgres breaks the cycle by failing the request
        await holder.execute(select(Transaction.id).where(Transaction.id == uuid.UUID(refund_id)).with_for_update())
        await holder.commit()
    return await task


async def test_an_edit_of_a_refund_caught_in_a_deadlock_answers_409_and_changes_nothing(client, monkeypatch):
    """A bulk change holds the expense and wants the refund while the edit holds the refund and wants the expense."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = await _refund(client, headers, account_id, category_id, expense["id"], amount=2000)

    async def edit():
        return await client.patch(f"/transactions/{refund['id']}", json={"amount": 3000}, headers=headers)

    resp = await _deadlock_against(monkeypatch, update_module, edit, expense["id"], refund["id"])

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Another change reached one of these transactions first"
    assert (await _get(client, headers, refund["id"]))["amount"] == 2000


async def test_a_link_caught_in_a_deadlock_answers_409_and_links_nothing(client, monkeypatch):
    """Linking locks the refund before the expense, so it can meet a bulk change going the other way."""
    headers, account_id, category_id = await _setup_user_with_deps(client)
    expense = (await _create_transaction(client, headers, account_id, category_id)).json()
    refund = (await _create_transaction(client, headers, account_id, category_id, amount=2000)).json()

    async def link():
        return await _link(client, headers, refund["id"], expense["id"])

    resp = await _deadlock_against(monkeypatch, links_module, link, expense["id"], refund["id"])

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Another change reached this transaction first"
    assert (await _get(client, headers, refund["id"]))["refund_of_transaction_id"] is None
