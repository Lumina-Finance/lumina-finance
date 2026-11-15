"""The fake Lunch Flow's own tests

Guards what the browser tests and a dev instance rely on it for: a scenario's key reaches only that
scenario, the date range is inclusive at both ends, pending transactions appear only when asked for,
and the sample scenario has transactions inside any recent import range
"""

from datetime import UTC, datetime, timedelta

import httpx

KEY_HEADER = "x-api-key"


async def _new_scenario(lunchflow: httpx.AsyncClient, path: str = "") -> tuple[str, str]:
    """Create a scenario and return its id and API key"""
    response = await lunchflow.post(f"/control/scenarios{path}")
    assert response.status_code == 201
    return response.json()["id"], response.json()["api_key"]


async def _add_account(lunchflow: httpx.AsyncClient, scenario_id: str, **overrides) -> int:
    """Add a Canadian dollar account and return its id"""
    response = await lunchflow.post(f"/control/scenarios/{scenario_id}/accounts", json={"name": "Chequing"} | overrides)
    assert response.status_code == 201
    return response.json()["id"]


async def test_a_key_reaches_only_its_own_scenarios_accounts(lunchflow):
    """Two users on one fake never see each other's accounts, and a key nobody holds is refused as Lunch Flow does"""
    first_id, first_key = await _new_scenario(lunchflow)
    _, second_key = await _new_scenario(lunchflow)
    account_id = await _add_account(lunchflow, first_id)

    mine = await lunchflow.get("/api/v1/accounts", headers={KEY_HEADER: first_key})
    theirs = await lunchflow.get("/api/v1/accounts", headers={KEY_HEADER: second_key})
    strangers = await lunchflow.get("/api/v1/accounts", headers={KEY_HEADER: "nope"})
    not_theirs = await lunchflow.get(f"/api/v1/accounts/{account_id}/balance", headers={KEY_HEADER: second_key})

    assert [account["id"] for account in mine.json()["accounts"]] == [account_id]
    assert theirs.json() == {"accounts": [], "total": 0}
    assert (strangers.status_code, strangers.json()) == (401, {"error": "Unauthorized", "message": "Invalid API key"})
    assert not_theirs.status_code == 404


async def test_a_revoked_key_is_refused(lunchflow):
    """Deleting the destination in Lunch Flow turns its key into a 401 on the next request"""
    scenario_id, key = await _new_scenario(lunchflow)

    revoked = await lunchflow.delete(f"/control/scenarios/{scenario_id}/api-key")
    refused = await lunchflow.get("/api/v1/accounts", headers={KEY_HEADER: key})

    assert revoked.status_code == 204
    assert refused.status_code == 401


async def test_transactions_cover_both_ends_of_the_range_and_pending_only_when_asked_for(lunchflow):
    """From and to are inclusive dates, and a pending transaction is left out unless include_pending is true"""
    scenario_id, key = await _new_scenario(lunchflow)
    account_id = await _add_account(lunchflow, scenario_id)
    added = await lunchflow.post(
        f"/control/scenarios/{scenario_id}/accounts/{account_id}/transactions",
        json={
            "transactions": [
                {"id": "before", "amount": "-1.00", "date": "2026-09-30"},
                {"id": "first", "amount": "-2.00", "date": "2026-10-01"},
                {"id": "last", "amount": "10.07", "date": "2026-10-03", "merchant": "Corner Store"},
                {"id": "after", "amount": "-4.00", "date": "2026-10-04"},
                {"id": "waiting", "amount": "-5.00", "date": "2026-10-02", "is_pending": True},
            ]
        },
    )
    assert added.status_code == 201
    url = f"/api/v1/accounts/{account_id}/transactions"
    window = {"from": "2026-10-01", "to": "2026-10-03"}

    booked = await lunchflow.get(url, params=window, headers={KEY_HEADER: key})
    with_pending = await lunchflow.get(url, params=window | {"include_pending": "true"}, headers={KEY_HEADER: key})

    assert [item["id"] for item in booked.json()["transactions"]] == ["first", "last"]
    assert [item["id"] for item in with_pending.json()["transactions"]] == ["first", "last", "waiting"]
    last = booked.json()["transactions"][1]
    assert (last["amount"], last["currency"], last["accountId"], last["merchant"], last["isPending"]) == (
        10.07,
        "CAD",
        account_id,
        "Corner Store",
        False,
    )


async def test_an_updated_account_shows_its_new_status_and_balance(lunchflow):
    """A status other than ACTIVE and a changed balance reach the next listing and balance read"""
    scenario_id, key = await _new_scenario(lunchflow)
    account_id = await _add_account(lunchflow, scenario_id, balance="10.00")

    await lunchflow.patch(f"/control/scenarios/{scenario_id}/accounts/{account_id}", json={"status": "EXPIRED", "balance": "12.34"})
    listed = await lunchflow.get("/api/v1/accounts", headers={KEY_HEADER: key})
    balance = await lunchflow.get(f"/api/v1/accounts/{account_id}/balance", headers={KEY_HEADER: key})

    assert listed.json()["accounts"][0]["status"] == "EXPIRED"
    assert balance.json() == {"balance": {"amount": 12.34, "currency": "CAD"}}


async def test_the_sample_scenario_holds_two_accounts_on_one_connection_with_recent_transactions(lunchflow):
    """An import starting 10 days back finds a transaction, and both sample accounts share one connection"""
    _, key = await _new_scenario(lunchflow, "/sample")

    listed = (await lunchflow.get("/api/v1/accounts", headers={KEY_HEADER: key})).json()["accounts"]
    chequing = next(account for account in listed if account["name"] == "Everyday Chequing")
    today = datetime.now(UTC).date()
    recent = await lunchflow.get(
        f"/api/v1/accounts/{chequing['id']}/transactions",
        params={"from": (today - timedelta(days=10)).isoformat(), "to": today.isoformat()},
        headers={KEY_HEADER: key},
    )

    assert [account["name"] for account in listed] == ["Everyday Chequing", "Rewards Visa"]
    assert len({account["connection_id"] for account in listed}) == 1
    assert [item["description"] for item in recent.json()["transactions"]] == [
        "EFTPOS BEAN THERE CAFE",
        "DIRECT CREDIT BRIGHTWORKS LTD SALARY",
        "EFTPOS NORTHERN FUEL STOP",
    ]
