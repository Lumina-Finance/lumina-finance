"""Route tests for budget utilization endpoints."""


from tests.routes.support import _create_user, _get_auth_header

# --- GET /budgets/{id}/utilization — path parameter validation ---


async def test_get_budget_utilization_invalid_uuid_returns_422(client):
    """A path parameter that isn't a valid UUID is rejected by FastAPI's parser.

    Pins that malformed IDs never reach the handler — a future schema change
    (e.g., accepting a short ID form) would have to deliberately override this.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/budgets/not-a-uuid/utilization", headers=headers)
    assert resp.status_code == 422
