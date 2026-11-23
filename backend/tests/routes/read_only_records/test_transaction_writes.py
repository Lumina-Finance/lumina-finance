"""What the transaction routes do on an account the installed check keeps read-only, as its currency is another than the user's main one

Nothing on the account changes and nothing new is added to it, while the server still accepts deleting
its transactions. An account owned through a group, or in the user's main currency, is never asked about
"""

import pytest

from app.allowance_hook import AllowanceKind
from tests.routes.read_only_records._helpers import _new_transaction, _open_account, _sign_up_holding_usd
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check, refuse_other_currencies
from tests.routes.support.transaction_helpers import _create_transaction, _get_system_category_id
from tests.routes.transactions._import_helpers import _import_run


async def _transaction_ids(client, headers, account_id: str) -> list[str]:
    """Return the ids of the account's transactions"""
    listed = await client.get("/transactions", params={"account_id": account_id}, headers=headers)
    assert listed.status_code == 200, listed.text
    return [transaction["id"] for transaction in listed.json()]


@pytest.mark.parametrize(
    ("currency", "in_group", "refused", "added"),
    [
        pytest.param("USD", False, True, False, id="refused"),
        pytest.param("USD", True, True, True, id="group-owned"),
        pytest.param("USD", False, False, True, id="no-check"),
        pytest.param("CAD", False, True, True, id="main-currency"),
    ],
)
async def test_add_transaction_to_an_account_in_another_currency(client, currency, in_group, refused, added):
    """Only a personal account in another currency, while the check refuses other currencies, refuses the transaction with its sentence"""
    headers = await _sign_up_holding_usd(client)
    group_id = (await client.post("/groups", json={"name": "Household"}, headers=headers)).json()["id"] if in_group else None
    account_id = await _open_account(client, headers, "Travel", currency=currency, group_id=group_id)
    category_id = await _get_system_category_id(client, headers)
    if refused:
        refuse_other_currencies()
    else:
        install_check(refused={AllowanceKind.TAX_ADVANTAGED_CATEGORY})

    response = await _create_transaction(client, headers, account_id, category_id, currency=currency)

    if added:
        assert response.status_code == 201, response.text
        assert len(await _transaction_ids(client, headers, account_id)) == 1
    else:
        assert response.status_code == 403, response.text
        assert response.json()["detail"] == ALLOWANCE_REASON
        assert await _transaction_ids(client, headers, account_id) == []


async def test_edit_transaction_on_a_read_only_account_is_refused_and_changes_nothing(client):
    """The amount stays as it was"""
    headers = await _sign_up_holding_usd(client)
    account_id = await _open_account(client, headers, "Travel")
    transaction_id = await _new_transaction(client, headers, account_id)
    refuse_other_currencies()
    before = (await client.get(f"/transactions/{transaction_id}", headers=headers)).json()

    response = await client.patch(f"/transactions/{transaction_id}", json={"amount": -7_500}, headers=headers)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert (await client.get(f"/transactions/{transaction_id}", headers=headers)).json() == before


@pytest.mark.parametrize("direction", ["onto", "off"])
async def test_move_transaction_onto_or_off_a_read_only_account_is_refused_and_moves_nothing(client, direction):
    """A move would add to the read-only account or take from it, so the transaction stays where it was

    The other account is a group's, so it is never read-only itself
    """
    headers = await _sign_up_holding_usd(client)
    usd_id = await _open_account(client, headers, "Travel")
    group_id = (await client.post("/groups", json={"name": "Household"}, headers=headers)).json()["id"]
    other_id = await _open_account(client, headers, "Joint", group_id=group_id)
    source_id = other_id if direction == "onto" else usd_id
    target_id = usd_id if direction == "onto" else other_id
    transaction_id = await _new_transaction(client, headers, source_id)
    refuse_other_currencies()

    response = await client.patch(f"/transactions/{transaction_id}", json={"account_id": target_id}, headers=headers)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert await _transaction_ids(client, headers, source_id) == [transaction_id]


async def test_bulk_edit_including_a_read_only_accounts_transaction_is_refused_and_changes_none(client):
    """A Canadian transaction picked beside the US one keeps its notes too, as a bulk edit changes all or none"""
    headers = await _sign_up_holding_usd(client)
    usd_transaction = await _new_transaction(client, headers, await _open_account(client, headers, "Travel"))
    cad_transaction = await _new_transaction(client, headers, await _open_account(client, headers, "Everyday", currency="CAD"), currency="CAD")
    refuse_other_currencies()

    body = {"transaction_ids": [usd_transaction, cad_transaction], "notes": "Trip"}

    response = await client.patch("/transactions/bulk", json=body, headers=headers)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    for transaction_id in (usd_transaction, cad_transaction):
        assert (await client.get(f"/transactions/{transaction_id}", headers=headers)).json()["notes"] is None


async def test_link_refund_on_a_read_only_account_is_refused_and_links_nothing(client):
    """The refund stays unlinked"""
    headers = await _sign_up_holding_usd(client)
    account_id = await _open_account(client, headers, "Travel")
    expense_id = await _new_transaction(client, headers, account_id)
    refund_id = await _new_transaction(client, headers, account_id, amount=5_000)
    refuse_other_currencies()

    response = await client.post(f"/transactions/{refund_id}/refund-link", json={"original_transaction_id": expense_id}, headers=headers)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert (await client.get(f"/transactions/{refund_id}", headers=headers)).json()["refund_of_transaction_id"] is None


async def test_link_refund_to_an_expense_on_a_read_only_account_is_refused_and_links_nothing(client):
    """The refund is in a Canadian account that can change, yet linking it would change the expense's refunds"""
    headers = await _sign_up_holding_usd(client)
    expense_id = await _new_transaction(client, headers, await _open_account(client, headers, "Travel"))
    everyday_id = await _open_account(client, headers, "Everyday", currency="CAD")
    refund_id = await _new_transaction(client, headers, everyday_id, amount=5_000, fx_rate=1.35)
    refuse_other_currencies()

    response = await client.post(f"/transactions/{refund_id}/refund-link", json={"original_transaction_id": expense_id}, headers=headers)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert (await client.get(f"/transactions/{refund_id}", headers=headers)).json()["refund_of_transaction_id"] is None


async def test_unlink_refund_on_a_read_only_account_is_refused_and_keeps_the_link(client):
    """The refund still points at its expense"""
    headers = await _sign_up_holding_usd(client)
    account_id = await _open_account(client, headers, "Travel")
    expense_id = await _new_transaction(client, headers, account_id)
    refund_id = await _new_transaction(client, headers, account_id, amount=5_000)
    linked = await client.post(f"/transactions/{refund_id}/refund-link", json={"original_transaction_id": expense_id}, headers=headers)
    assert linked.status_code == 204, linked.text
    refuse_other_currencies()

    response = await client.delete(f"/transactions/{refund_id}/refund-link", headers=headers)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert (await client.get(f"/transactions/{refund_id}", headers=headers)).json()["refund_of_transaction_id"] == expense_id


async def test_bulk_move_onto_a_read_only_account_is_refused_and_moves_nothing(client):
    """Both transactions stay in the group's account they were picked from"""
    headers = await _sign_up_holding_usd(client)
    usd_id = await _open_account(client, headers, "Travel")
    group_id = (await client.post("/groups", json={"name": "Household"}, headers=headers)).json()["id"]
    joint_id = await _open_account(client, headers, "Joint", group_id=group_id)
    transaction_ids = [await _new_transaction(client, headers, joint_id) for _ in range(2)]
    refuse_other_currencies()

    response = await client.patch("/transactions/bulk", json={"transaction_ids": transaction_ids, "account_id": usd_id}, headers=headers)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert sorted(await _transaction_ids(client, headers, joint_id)) == sorted(transaction_ids)
    assert await _transaction_ids(client, headers, usd_id) == []


async def test_import_into_a_read_only_account_is_refused_and_adds_nothing(client):
    """A file's rows mapped onto the account would add to it"""
    headers = await _sign_up_holding_usd(client)
    account_id = await _open_account(client, headers, "Travel")
    category_id = await _get_system_category_id(client, headers)
    refuse_other_currencies()

    response = await _import_run(
        client,
        headers,
        {
            "accounts": [{"source": "Travel card", "account_id": account_id}],
            "categories": [{"source": "Groceries", "category_id": category_id}],
            "rows": [{"account_source": "Travel card", "category_source": "Groceries", "dt": "2026-04-11", "amount": "-10.00"}],
        },
    )

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert await _transaction_ids(client, headers, account_id) == []


async def test_delete_transaction_on_a_read_only_account_goes_through(client):
    """The transaction is gone"""
    headers = await _sign_up_holding_usd(client)
    account_id = await _open_account(client, headers, "Travel")
    transaction_id = await _new_transaction(client, headers, account_id)
    refuse_other_currencies()

    response = await client.delete(f"/transactions/{transaction_id}", headers=headers)

    assert response.status_code == 204, response.text
    assert await _transaction_ids(client, headers, account_id) == []


async def test_bulk_delete_on_a_read_only_account_goes_through(client):
    """Both transactions are gone"""
    headers = await _sign_up_holding_usd(client)
    account_id = await _open_account(client, headers, "Travel")
    transaction_ids = [await _new_transaction(client, headers, account_id) for _ in range(2)]
    refuse_other_currencies()

    response = await client.post("/transactions/bulk/delete", json={"transaction_ids": transaction_ids}, headers=headers)

    assert response.status_code == 200, response.text
    assert await _transaction_ids(client, headers, account_id) == []
