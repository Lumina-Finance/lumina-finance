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


async def _record_starting_balance(client, headers, account_id, amount):
    """Record an account's starting balance with the route API

    Args:
        client: Async test client
        headers: Auth headers for the requesting user
        account_id: Account receiving the starting balance
        amount: Balance in minor units as the user states it, a liability's being the amount owed

    Returns:
        API response from recording the starting balance
    """
    return await client.post(f"/accounts/{account_id}/starting-balance", json={"amount": amount}, headers=headers)
