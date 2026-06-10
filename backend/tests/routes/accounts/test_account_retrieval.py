

from tests.routes.accounts._account_helpers import (
    NONEXISTENT_ID,
    _create_second_user,
)
from tests.routes.support import ACCOUNT_PAYLOAD, _create_account, _create_user, _get_auth_header

# --- GET /accounts/{account_id} ---


async def test_get_account_returns_account(client):
    """Valid account ID returns the account with all fields."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    resp = await client.get(f"/accounts/{account_id}", headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == account_id
    assert data["owner_id"] is not None
    assert data["group_id"] is None
    assert data["account_kind"] == ACCOUNT_PAYLOAD["account_kind"]
    assert data["account_type"] == ACCOUNT_PAYLOAD["account_type"]
    assert data["name"] == ACCOUNT_PAYLOAD["name"]
    assert data["institution"] is None
    assert data["currency"] == ACCOUNT_PAYLOAD["currency"]
    assert data["current_balance"] == 0
    assert data["credit_limit"] is None
    for field in (
        "tax_treatment",
        "lifetime_contribution_limit",
        "accrued_contributions",
        "accrued_lifetime_contribution_limit",
        "ytd_contributions",
        "ytd_withdrawals",
        "lifetime_contributions",
        "lifetime_withdrawals",
        "current_year_contribution_limit",
        "current_year_withdrawal_limit",
    ):
        assert field not in data
    assert data["is_archived"] is False
    assert data["closed_at"] is None
    assert data["created_at"] is not None


async def test_get_account_not_found_returns_404(client):
    """Non-existent account ID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/accounts/{NONEXISTENT_ID}", headers=headers)

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Account not found"


async def test_get_account_other_user_returns_404(client):
    """Accessing another user's account returns 404, not 403."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.get(f"/accounts/{account_id}", headers=other_headers)

    assert resp.status_code == 404


async def test_get_account_without_auth_returns_401(client):
    """GET /accounts/{id} without an Authorization header returns 401."""
    resp = await client.get(f"/accounts/{NONEXISTENT_ID}")
    assert resp.status_code == 401


async def test_legacy_tax_advantaged_config_route_removed(client):
    """Old account-level tax config routes are no longer part of the API."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = (await _create_account(client, headers)).json()["id"]

    resp = await client.get(f"/accounts/{account_id}/tax-advantaged-configs", headers=headers)

    assert resp.status_code == 404
