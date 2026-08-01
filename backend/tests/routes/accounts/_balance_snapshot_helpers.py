"""Route tests for the account balance snapshot endpoints and lifecycle hooks"""
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.models.account import AccountBalanceSnapshot
from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.support import _get_auth_header, _get_system_merchant_id


def _creation_day(account_resp):
    """Return the account owner's local creation date from the API timestamp"""
    return datetime.fromisoformat(account_resp.json()["created_at"]).astimezone(ZoneInfo("America/Toronto")).date()

async def _get_snapshots_for(account_id):
    """Query the DB directly for an account's balance snapshots ordered by ts"""
    async with TestSession() as session:

        # Fetch the account snapshot history in the same order returned by the API
        result = await session.execute(
            select(AccountBalanceSnapshot)
            .where(AccountBalanceSnapshot.account_id == account_id)
            .order_by(AccountBalanceSnapshot.dt),
        )
        return list(result.scalars().all())

async def _seed_usd_currency():
    """Insert the USD currency row needed for multi-currency transaction tests"""
    async with TestSession() as session:

        # Insert USD as seeded currency data for cross-currency snapshot tests
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()

async def _create_category(client, headers, **overrides):
    """Create an expense category via POST /categories"""
    payload = {"name": "Test Groceries", "kind": "expense", **overrides}
    return await client.post("/categories", json=payload, headers=headers)

async def _create_transaction(client, headers, account_id, category_id, **overrides):
    """Create a transaction via POST /transactions"""
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

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"

async def _create_second_user(client):
    """Sign up a second user and return (auth_headers, user_id)"""
    resp = await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "SecurePassword123!",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    return _get_auth_header(resp), resp.json()["user"]["id"]

async def _create_group(client, headers):
    """Create a group and return its id"""
    resp = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    return resp.json()["id"]

async def _grant_account_permission(client, admin_headers, account_id, user_id, level):
    """Grant a user a permission level on a group account"""
    return await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": user_id, "level": level},
        headers=admin_headers,
    )

async def _seed_three_day_history(client, headers, account_id):
    """Create transactions on 3/1, 3/5, and 3/10 so the account has 3 snapshots"""
    cat_resp = await _create_category(client, headers)
    category_id = cat_resp.json()["id"]
    await _create_transaction(
        client, headers, account_id, category_id,
        dt="2026-03-01", amount=1000,
    )
    await _create_transaction(
        client, headers, account_id, category_id,
        dt="2026-03-05", amount=2000,
    )
    await _create_transaction(
        client, headers, account_id, category_id,
        dt="2026-03-10", amount=3000,
    )
