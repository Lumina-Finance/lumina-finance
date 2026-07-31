

from tests.routes.accounts._account_helpers import (
    NONEXISTENT_ID,
    _create_second_user,
)
from tests.routes.support import _create_account, _create_user, _get_auth_header

# --- DELETE /accounts/{account_id} ---


async def test_delete_account_returns_204(client):
    """DELETE removes the account and returns 204."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.delete(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 204

    # Verify account is gone
    get_resp = await client.get(f"/accounts/{account_id}", headers=headers)
    assert get_resp.status_code == 404


async def test_delete_account_not_found_returns_404(client):
    """DELETE non-existent account returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.delete(f"/accounts/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404


async def test_delete_account_other_user_returns_404(client):
    """Deleting another user's account returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.delete(f"/accounts/{account_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_delete_account_without_auth_returns_401(client):
    """DELETE /accounts/{id} without an Authorization header returns 401."""
    resp = await client.delete(f"/accounts/{NONEXISTENT_ID}")
    assert resp.status_code == 401


async def test_double_delete_returns_404_on_second(client):
    """Deleting the same account twice returns 204 then 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp1 = await client.delete(f"/accounts/{account_id}", headers=headers)
    resp2 = await client.delete(f"/accounts/{account_id}", headers=headers)

    assert resp1.status_code == 204
    assert resp2.status_code == 404


# --- Accounts recorded as the other side of a transfer ---


async def _setup_recorded_transfer(client):
    """Record a transfer in one account that points at a second account.

    Returns:
        Tuple of (auth_headers, account holding the transfer, account it records)
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    holder_id = (await _create_account(client, headers)).json()["id"]
    recorded_id = (await _create_account(client, headers, name="Savings")).json()["id"]

    categories = await client.get("/categories", headers=headers)
    transfer_id = next(cat["id"] for cat in categories.json() if cat["name"] == "Transfer")

    created = await client.post("/transactions", json={
        "account_id": holder_id,
        "category_id": transfer_id,
        "dt": "2026-03-15",
        "amount": -5000,
        "currency": "CAD",
        "other_account_scope": "tracked",
        "other_account_id": recorded_id,
    }, headers=headers)
    assert created.status_code == 201
    return headers, holder_id, recorded_id


async def test_delete_account_recorded_on_a_transfer_elsewhere_returns_409(client):
    """Deleting it would strip what another account's transfer recorded, so it is refused."""
    headers, _, recorded_id = await _setup_recorded_transfer(client)

    resp = await client.delete(f"/accounts/{recorded_id}", headers=headers)

    assert resp.status_code == 409


async def test_delete_account_holding_the_transfer_returns_204(client):
    """The transfer goes with the account it is recorded in, so that side is free to delete."""
    headers, holder_id, _ = await _setup_recorded_transfer(client)

    resp = await client.delete(f"/accounts/{holder_id}", headers=headers)

    assert resp.status_code == 204
