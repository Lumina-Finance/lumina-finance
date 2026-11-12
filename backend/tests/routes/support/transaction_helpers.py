"""Writing transactions through the routes: finding a seeded system category and creating a transaction in it"""

from tests.routes.support.merchant_helpers import _get_system_merchant_id


async def _get_system_category_id(client, headers, name="Groceries"):
    """Return the ID for a seeded system category"""
    resp = await client.get("/categories", headers=headers)
    return next(category["id"] for category in resp.json() if category["name"] == name)


async def _create_transaction(client, headers, account_id, category_id, **overrides):
    """Create a transaction via POST /transactions

    Defaults: dt="2026-03-15", amount=-5000, currency="CAD"

    Args:
        client: The async test client
        headers: Auth headers for the requesting user
        account_id: UUID of the account to attach the transaction to
        category_id: UUID of the category to assign
        **overrides: Fields to override in the default payload

    Returns:
        The HTTP response from the API
    """
    payload = {
        "account_id": account_id,
        "category_id": category_id,
        "dt": "2026-03-15",
        "amount": -5000,
        "currency": "CAD",
        **overrides,
    }

    # The route requires a merchant, so a test that does not care which one gets the shared Myself
    if "merchant_id" not in payload:
        payload["merchant_id"] = await _get_system_merchant_id(client, headers)
    return await client.post("/transactions", json=payload, headers=headers)
