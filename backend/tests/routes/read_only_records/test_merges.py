"""What merging or deleting a category, merchant or tag does to the transactions of an account the installed check keeps read-only

A merge tidies the user's lists rather than editing a transaction, so it still moves the read-only
account's transactions onto the replacement. A delete rewrites no transaction, so it answers one on a
read-only account as it would any other
"""

from tests.routes.budgets._helpers import _create_category
from tests.routes.read_only_records._helpers import _new_transaction, _open_account, _sign_up_holding_usd
from tests.routes.support.allowance_helpers import refuse_other_currencies


async def test_category_merge_moves_a_read_only_accounts_transaction_onto_the_replacement(client):
    """The US transaction filed under Cafes is filed under Coffee after the merge"""
    headers = await _sign_up_holding_usd(client)
    cafes_id = await _create_category(client, headers, name="Cafes")
    coffee_id = await _create_category(client, headers, name="Coffee")
    transaction_id = await _new_transaction(client, headers, await _open_account(client, headers, "Travel"), category_id=cafes_id)
    refuse_other_currencies()

    response = await client.post(f"/categories/{cafes_id}/merge", json={"replacement_category_id": coffee_id}, headers=headers)

    assert response.status_code == 204, response.text
    assert (await client.get(f"/transactions/{transaction_id}", headers=headers)).json()["category_id"] == coffee_id


async def test_tag_merge_moves_a_read_only_accounts_transaction_onto_the_replacement(client):
    """The US transaction tagged Trip is tagged Holiday after the merge"""
    headers = await _sign_up_holding_usd(client)
    trip_id = (await client.post("/tags", json={"name": "Trip"}, headers=headers)).json()["id"]
    holiday_id = (await client.post("/tags", json={"name": "Holiday"}, headers=headers)).json()["id"]
    transaction_id = await _new_transaction(client, headers, await _open_account(client, headers, "Travel"), tag_ids=[trip_id])
    refuse_other_currencies()

    response = await client.post(f"/tags/{trip_id}/merge", json={"replacement_tag_id": holiday_id}, headers=headers)

    assert response.status_code == 204, response.text
    assert (await client.get(f"/transactions/{transaction_id}", headers=headers)).json()["tag_ids"] == [holiday_id]


async def test_merchant_merge_moves_a_read_only_accounts_transaction_onto_the_replacement(client):
    """The US transaction from Starbucks Reserve is from Starbucks after the merge"""
    headers = await _sign_up_holding_usd(client)
    reserve_id = (await client.post("/merchants", json={"name": "Starbucks Reserve"}, headers=headers)).json()["id"]
    starbucks_id = (await client.post("/merchants", json={"name": "Starbucks"}, headers=headers)).json()["id"]
    transaction_id = await _new_transaction(client, headers, await _open_account(client, headers, "Travel"), merchant_id=reserve_id)
    refuse_other_currencies()

    response = await client.post(f"/merchants/{reserve_id}/merge", json={"replacement_merchant_id": starbucks_id}, headers=headers)

    assert response.status_code == 204, response.text
    assert (await client.get(f"/transactions/{transaction_id}", headers=headers)).json()["merchant_id"] == starbucks_id


async def test_category_merchant_and_tag_deletes_answer_a_read_only_accounts_transaction_as_any_other(client):
    """No delete rewrites a transaction: each is turned away while one still uses it, never with the check's sentence"""
    headers = await _sign_up_holding_usd(client)
    cafes_id = await _create_category(client, headers, name="Cafes")
    reserve_id = (await client.post("/merchants", json={"name": "Starbucks Reserve"}, headers=headers)).json()["id"]
    trip_id = (await client.post("/tags", json={"name": "Trip"}, headers=headers)).json()["id"]
    transaction_id = await _new_transaction(
        client, headers, await _open_account(client, headers, "Travel"), category_id=cafes_id, merchant_id=reserve_id, tag_ids=[trip_id]
    )
    refuse_other_currencies()

    deletes = [
        await client.delete(path, headers=headers) for path in (f"/categories/{cafes_id}", f"/merchants/{reserve_id}", f"/tags/{trip_id}")
    ]

    assert [(response.status_code, response.json()["detail"]) for response in deletes] == [
        (409, "Category is referenced by existing transactions"),
        (409, "Merchant is referenced by existing transactions"),
        (409, "Tag is referenced by existing transactions"),
    ]
    stored = (await client.get(f"/transactions/{transaction_id}", headers=headers)).json()
    assert (stored["category_id"], stored["merchant_id"], stored["tag_ids"]) == (cafes_id, reserve_id, [trip_id])
