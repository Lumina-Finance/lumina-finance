"""What the account routes do with an account the installed check keeps read-only, as its currency is another than the user's main one

Each account says why it is read-only. Nothing on it changes, while it can always be archived, brought
back from the archive or deleted
"""

from tests.routes.read_only_records._helpers import _currency_asks, _new_account, _refuse_other_currencies, _sign_up_holding_usd
from tests.routes.support.account_helpers import _account_names, _record_starting_balance
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON


async def test_list_and_detail_say_why_only_a_personal_account_in_another_currency_is_read_only(client):
    """The check is asked once for the whole list, and a group's US account and a Canadian one can change"""
    headers = await _sign_up_holding_usd(client)
    group_id = (await client.post("/groups", json={"name": "Household"}, headers=headers)).json()["id"]
    travel_id = await _new_account(client, headers, "Travel")
    await _new_account(client, headers, "Joint", group_id=group_id)
    await _new_account(client, headers, "Everyday", currency="CAD")
    asked = _refuse_other_currencies()

    listed = await client.get("/accounts", headers=headers)
    detail = await client.get(f"/accounts/{travel_id}", headers=headers)

    assert listed.status_code == 200, listed.text
    assert {row["name"]: row["read_only_reason"] for row in listed.json()} == {"Travel": ALLOWANCE_REASON, "Joint": None, "Everyday": None}
    assert detail.status_code == 200, detail.text
    assert detail.json()["read_only_reason"] == ALLOWANCE_REASON
    assert _currency_asks(asked) == 2


async def test_list_with_no_check_installed_says_no_account_is_read_only(client):
    """The US account can change"""
    headers = await _sign_up_holding_usd(client)
    await _new_account(client, headers, "Travel")

    listed = await client.get("/accounts", headers=headers)

    assert listed.status_code == 200, listed.text
    assert [row["read_only_reason"] for row in listed.json()] == [None]


async def test_edit_read_only_account_is_refused_and_changes_nothing(client):
    """The name stays as it was"""
    headers = await _sign_up_holding_usd(client)
    account_id = await _new_account(client, headers, "Travel")
    _refuse_other_currencies()

    response = await client.patch(f"/accounts/{account_id}", json={"name": "Holiday"}, headers=headers)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert await _account_names(client, headers) == ["Travel"]


async def test_starting_balance_on_a_read_only_account_is_refused_and_records_nothing(client):
    """The balance stays at nothing"""
    headers = await _sign_up_holding_usd(client)
    account_id = await _new_account(client, headers, "Travel")
    _refuse_other_currencies()

    response = await _record_starting_balance(client, headers, account_id, 100_00)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == ALLOWANCE_REASON
    assert (await client.get(f"/accounts/{account_id}", headers=headers)).json()["current_balance"] == 0


async def test_archive_and_unarchive_read_only_account_go_through(client):
    """The account can be put away and brought back, and stays read-only once back"""
    headers = await _sign_up_holding_usd(client)
    account_id = await _new_account(client, headers, "Travel")
    _refuse_other_currencies()

    archived = await client.patch(f"/accounts/{account_id}", json={"is_archived": True}, headers=headers)
    unarchived = await client.patch(f"/accounts/{account_id}", json={"is_archived": False}, headers=headers)

    assert archived.status_code == 200, archived.text
    assert archived.json()["is_archived"] is True
    assert unarchived.status_code == 200, unarchived.text
    assert unarchived.json()["is_archived"] is False
    assert unarchived.json()["read_only_reason"] == ALLOWANCE_REASON


async def test_archive_read_only_account_from_the_edit_form_goes_through(client):
    """The form sends every field as it stands with the switch turned on, and only the switch changed"""
    headers = await _sign_up_holding_usd(client)
    account_id = await _new_account(client, headers, "Travel")
    _refuse_other_currencies()

    response = await client.patch(
        f"/accounts/{account_id}",
        json={"name": "Travel", "institution_id": None, "notes": None, "is_archived": True, "tax_advantaged_category_id": None},
        headers=headers,
    )

    assert response.status_code == 200, response.text
    assert response.json()["is_archived"] is True


async def test_delete_read_only_account_goes_through(client):
    """The account is gone"""
    headers = await _sign_up_holding_usd(client)
    account_id = await _new_account(client, headers, "Travel")
    _refuse_other_currencies()

    response = await client.delete(f"/accounts/{account_id}", headers=headers)

    assert response.status_code == 204, response.text
    assert await _account_names(client, headers) == []
