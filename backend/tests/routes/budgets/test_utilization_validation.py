"""Route tests for budget utilization endpoints."""


from tests.routes.budgets._utilization_helpers import NONEXISTENT_ID
from tests.routes.support import _create_user, _get_auth_header

# --- GET /base-budgets/{id}/utilizations — path parameter validation ---


async def test_get_base_budget_utilizations_invalid_uuid_returns_422(client):
    """A path parameter that isn't a valid UUID is rejected by FastAPI's parser.

    Pins that malformed IDs never reach the handler — a future schema change
    (e.g., accepting a short ID form) would have to deliberately override this.
    """
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get("/base-budgets/not-a-uuid/utilizations", headers=headers)
    assert resp.status_code == 422


async def test_get_base_budget_utilizations_unknown_base_budget_returns_404(client):
    """A syntactically valid but nonexistent base budget id returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(f"/base-budgets/{NONEXISTENT_ID}/utilizations", headers=headers)
    assert resp.status_code == 404
