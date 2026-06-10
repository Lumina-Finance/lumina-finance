"""Route tests for the account balance snapshot endpoints and lifecycle hooks."""


from tests.routes.support import _create_account, _create_user, _get_auth_header

# --- GET /accounts/{account_id}/snapshots — validation ---


async def test_list_snapshots_with_inverted_date_range_returns_422(client):
    """from_date later than to_date is rejected."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]

    resp = await client.get(
        f"/accounts/{account_id}/snapshots",
        params={
            "from_date": "2026-04-01",
            "to_date": "2026-03-01",
        },
        headers=headers,
    )
    assert resp.status_code == 422


async def test_list_snapshots_with_invalid_date_format_returns_422(client):
    """A malformed date string is rejected by FastAPI's query validation."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]

    resp = await client.get(
        f"/accounts/{account_id}/snapshots",
        params={"from_date": "not-a-date"},
        headers=headers,
    )
    assert resp.status_code == 422
