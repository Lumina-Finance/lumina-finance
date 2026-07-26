

from tests.routes.support import _get_auth_header

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"

async def _create_second_user(client):
    """Sign up a second user and return (headers, user_id)"""
    resp = await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "SecurePassword123!",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    return _get_auth_header(resp), resp.json()["user"]["id"]

async def _create_category(client, headers, **overrides):
    """Create a category via POST /categories"""
    payload = {"name": "Test Groceries", "kind": "expense", **overrides}
    resp = await client.post("/categories", json=payload, headers=headers)
    return resp.json()["id"]

async def _get_system_category_id(client, headers, name="Groceries"):
    """Return the ID for a seeded system category"""
    resp = await client.get("/categories", headers=headers)
    return next(category["id"] for category in resp.json() if category["name"] == name)

async def _create_group(client, headers, **overrides):
    """Create a group via POST /groups"""
    payload = {"name": "Smith Family", **overrides}
    resp = await client.post("/groups", json=payload, headers=headers)
    return resp.json()["id"]

async def _create_base_budget(client, headers, *, category_ids=None, **overrides):
    """Create a base budget via POST /base-budgets

    Defaults: name="March Budget", currency="CAD", one freshly-created tracked category
    Pass category_ids explicitly to override (including an empty list, which the API rejects)
    """
    if category_ids is None:
        category_ids = [await _create_category(client, headers, name="Default Cat")]
    payload = {
        "name": "March Budget",
        "currency": "CAD",
        "recurrence_freq": "monthly",
        "recurrence_dom": 1,
        "category_ids": category_ids,
        **overrides,
    }
    return await client.post("/base-budgets", json=payload, headers=headers)

async def _create_budget_instance(client, headers, base_budget_id, **overrides):
    """Create a budget instance via POST /base-budgets/{id}/budgets

    Defaults: period_start=2026-03-01, overall_limit=100000. period_end is
    computed by the backend from the base's cadence
    """
    payload = {
        "period_start": "2026-03-01",
        "overall_limit": 100000,
        **overrides,
    }
    return await client.post(
        f"/base-budgets/{base_budget_id}/budgets", json=payload, headers=headers,
    )
