from datetime import UTC, datetime

from tests.routes.conftest import _create_account, _create_user, _get_auth_header


async def _create_category(client, headers, **overrides):
    payload = {"name": "Test Groceries", "kind": "expense", **overrides}
    return await client.post("/categories", json=payload, headers=headers)


async def _create_transaction(client, headers, account_id, category_id, **overrides):
    payload = {
        "account_id": account_id,
        "category_id": category_id,
        "dt": "2025-12-31",
        "amount": -5000,
        "currency": "CAD",
        **overrides,
    }
    return await client.post("/transactions", json=payload, headers=headers)


async def test_dashboard_spending_breakdown_uses_viewer_timezone_at_utc_boundary(client, monkeypatch):
    """At Jan 1 01:00 UTC, a Toronto user's dashboard MTD is still December."""
    from app.routes import dashboard as dashboard_routes

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 1, 1, 1, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    monkeypatch.setattr(dashboard_routes, "datetime", FixedDateTime)

    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_id = (await _create_account(client, headers)).json()["id"]
    category_id = (await _create_category(client, headers)).json()["id"]

    await _create_transaction(client, headers, account_id, category_id, dt="2025-12-31", amount=-4100)
    await _create_transaction(client, headers, account_id, category_id, dt="2026-01-01", amount=-9999)

    resp = await client.get("/dashboard/spending-breakdown", params={"range": "MTD"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["expense"][0]["amount"] == 4100
