from datetime import datetime
from zoneinfo import ZoneInfo


class _FixedClock:
    """Fixed clock used to make dashboard ranges deterministic"""

    def __init__(self, instant):
        """Store the fixed instant returned by the test clock"""
        self.instant = instant

    def now(self, tz=None):
        """Return the fixed instant in the requested timezone"""
        return self.instant.astimezone(tz) if tz else self.instant


def _owner_local_creation_day(account):
    """Return the account owner's local creation date"""
    return datetime.fromisoformat(account["created_at"]).astimezone(ZoneInfo("America/Toronto")).date()


async def _create_category(client, headers, **overrides):
    """Create an expense category for dashboard widget tests"""
    payload = {"name": "Test Groceries", "kind": "expense", **overrides}
    return await client.post("/categories", json=payload, headers=headers)


async def _create_merchant(client, headers, **overrides):
    """Create a merchant for dashboard widget tests"""
    payload = {"name": "Test Merchant", **overrides}
    return await client.post("/merchants", json=payload, headers=headers)


async def _create_transaction(client, headers, account_id, category_id, **overrides):
    """Create a transaction for dashboard widget tests"""
    payload = {
        "account_id": account_id,
        "category_id": category_id,
        "dt": "2025-12-31",
        "amount": -5000,
        "currency": "CAD",
        **overrides,
    }
    return await client.post("/transactions", json=payload, headers=headers)
