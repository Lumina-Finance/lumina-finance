"""What merging a category, merchant or tag does to the transactions of an account the installed check keeps read-only

A merge tidies the user's lists rather than editing a transaction, so it still moves the read-only
account's transactions onto the replacement
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
