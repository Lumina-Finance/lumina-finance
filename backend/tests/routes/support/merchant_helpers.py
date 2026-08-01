"""Shared merchant route test helpers"""


async def _get_system_merchant_id(client, headers, name="Myself"):
    """Return the identifier of a merchant that ships with the app

    The create and edit routes require a merchant, so a test that does not care which one uses this
    rather than making its own

    Args:
        client: Async test client
        headers: Auth headers for the requesting user
        name: Merchant name to look up

    Returns:
        Identifier of the named system merchant
    """
    resp = await client.get("/merchants", headers=headers)
    return next(merchant["id"] for merchant in resp.json() if merchant["name"] == name)
