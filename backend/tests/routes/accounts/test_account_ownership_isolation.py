

from tests.routes.accounts._account_helpers import _create_second_user
from tests.routes.support import _create_account, _create_user, _get_auth_header

# --- Ownership isolation ---


async def test_other_user_cannot_patch_account(client):
    """PATCH on another user's account returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    create_resp = await _create_account(client, headers)
    account_id = create_resp.json()["id"]

    other_headers = _get_auth_header(await _create_second_user(client))

    resp = await client.patch(f"/accounts/{account_id}", json={"name": "Hacked"}, headers=other_headers)

    assert resp.status_code == 404


async def test_list_accounts_excludes_other_users_accounts(client):
    """User A's accounts do not appear in User B's list."""
    signup_resp = await _create_user(client)
    headers_a = _get_auth_header(signup_resp)
    await _create_account(client, headers_a, name="User A Account")

    headers_b = _get_auth_header(await _create_second_user(client))
    await _create_account(client, headers_b, name="User B Account")

    # User B should only see their own account
    resp = await client.get("/accounts", headers=headers_b)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "User B Account"
