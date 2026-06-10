"""Shared account route test helpers"""

ACCOUNT_PAYLOAD = {
    "account_kind": "asset",
    "account_type": "checking",
    "name": "Main Chequing",
    "currency": "CAD",
}


async def _create_account(client, headers, **overrides):
    """Create an account with the route API

    Args:
        client: Async test client
        headers: Auth headers for the requesting user
        **overrides: Fields to override in the default payload

    Returns:
        API response from creating the account
    """
    payload = {**ACCOUNT_PAYLOAD, **overrides}
    return await client.post("/accounts", json=payload, headers=headers)
