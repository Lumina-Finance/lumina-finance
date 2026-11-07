"""The fake Akahu's own tests

Guards what the browser tests and a dev instance rely on it for: a scenario's pair of tokens reaches
only that scenario and needs both tokens, a range excludes its start and includes its end, a cursor
leads through every page, pending transactions have no id, and the sample scenario has transactions
inside any recent import range
"""

from datetime import UTC, datetime, timedelta

import httpx


def _headers(scenario: dict) -> dict[str, str]:
    """Return the headers that reach a scenario"""
    return {"Authorization": f"Bearer {scenario['user_access_token']}", "X-Akahu-Id": scenario["app_id_token"]}


async def _new_scenario(akahu: httpx.AsyncClient, path: str = "") -> dict:
    """Create a scenario and return its id and tokens"""
    response = await akahu.post(f"/control/scenarios{path}")
    assert response.status_code == 201
    return response.json()


async def _add_account(akahu: httpx.AsyncClient, scenario: dict, **overrides) -> str:
    """Add a New Zealand dollar account and return its id"""
    response = await akahu.post(f"/control/scenarios/{scenario['id']}/accounts", json={"name": "Chequing"} | overrides)
    assert response.status_code == 201
    return response.json()["id"]


async def test_a_pair_of_tokens_reaches_only_its_own_scenario_and_needs_both(akahu):
    """Two users on one fake never see each other's accounts, and a pair with one wrong token is refused as Akahu does"""
    first = await _new_scenario(akahu)
    second = await _new_scenario(akahu)
    account_id = await _add_account(akahu, first)

    mine = await akahu.get("/v1/accounts", headers=_headers(first))
    theirs = await akahu.get("/v1/accounts", headers=_headers(second))
    wrong_app = await akahu.get("/v1/accounts", headers=_headers(first) | {"X-Akahu-Id": "app_token_nope"})
    no_headers = await akahu.get("/v1/me")
    not_theirs = await akahu.get(f"/v1/accounts/{account_id}/transactions", headers=_headers(second))

    assert [item["_id"] for item in mine.json()["items"]] == [account_id]
    assert theirs.json() == {"success": True, "items": []}
    assert (wrong_app.status_code, wrong_app.json()["success"]) == (401, False)
    assert no_headers.status_code == 401
    assert not_theirs.status_code == 404


async def test_revoked_tokens_are_refused(akahu):
    """Deleting the personal app in Akahu turns its tokens into a 401 on the next request"""
    scenario = await _new_scenario(akahu)

    revoked = await akahu.delete(f"/control/scenarios/{scenario['id']}/tokens")
    refused = await akahu.get("/v1/me", headers=_headers(scenario))

    assert revoked.status_code == 204
    assert refused.status_code == 401


async def test_transactions_exclude_the_start_include_the_end_and_follow_a_cursor(akahu):
    """The start instant is left out, the end is kept, and a page size of two leads through all the rest by cursor"""
    scenario = await _new_scenario(akahu)
    account_id = await _add_account(akahu, scenario)
    await akahu.patch(f"/control/scenarios/{scenario['id']}", json={"page_size": 2})
    added = await akahu.post(
        f"/control/scenarios/{scenario['id']}/accounts/{account_id}/transactions",
        json={
            "transactions": [
                {"id": "at_start", "amount": "-1.00", "date": "2026-10-01T00:00:00.000Z"},
                {"id": "first", "amount": "-2.00", "date": "2026-10-01T00:00:00.001Z"},
                {"id": "middle", "amount": "10.07", "date": "2026-10-02T12:00:00.000Z", "description": "Corner Store"},
                {"id": "at_end", "amount": "-4.00", "date": "2026-10-03T00:00:00.000Z"},
                {"id": "after", "amount": "-5.00", "date": "2026-10-03T00:00:00.001Z"},
            ]
        },
    )
    assert added.status_code == 201
    url = f"/v1/accounts/{account_id}/transactions"
    window = {"start": "2026-10-01T00:00:00.000Z", "end": "2026-10-03T00:00:00.000Z"}

    first_page = (await akahu.get(url, params=window, headers=_headers(scenario))).json()
    second_page = (await akahu.get(url, params=window | {"cursor": first_page["cursor"]["next"]}, headers=_headers(scenario))).json()

    assert [item["_id"] for item in first_page["items"]] == ["first", "middle"]
    assert [item["_id"] for item in second_page["items"]] == ["at_end"]
    assert second_page["cursor"] == {"next": None}
    middle = first_page["items"][1]
    assert (middle["amount"], middle["description"], middle["_account"]) == (10.07, "Corner Store", account_id)


async def test_pending_transactions_have_no_id_and_come_for_every_account_at_once(akahu):
    """A pending item shows in the pending listing only, with the account it belongs to and no _id"""
    scenario = await _new_scenario(akahu)
    account_id = await _add_account(akahu, scenario)
    await akahu.post(
        f"/control/scenarios/{scenario['id']}/accounts/{account_id}/transactions",
        json={"transactions": [{"amount": "-12.00", "date": "2026-10-02T12:00:00.000Z", "description": "Hold", "is_pending": True}]},
    )

    pending = (await akahu.get("/v1/transactions/pending", headers=_headers(scenario))).json()
    booked = (await akahu.get(f"/v1/accounts/{account_id}/transactions", headers=_headers(scenario))).json()

    assert [(item["_account"], item["amount"], item["description"]) for item in pending["items"]] == [(account_id, -12.0, "Hold")]
    assert "_id" not in pending["items"][0]
    assert booked["items"] == []


async def test_an_updated_account_shows_its_new_status_and_balance(akahu):
    """A status of INACTIVE and a changed balance reach the next listing"""
    scenario = await _new_scenario(akahu)
    account_id = await _add_account(akahu, scenario, balance="10.00")

    await akahu.patch(f"/control/scenarios/{scenario['id']}/accounts/{account_id}", json={"status": "INACTIVE", "balance": "12.34"})
    [listed] = (await akahu.get("/v1/accounts", headers=_headers(scenario))).json()["items"]

    assert listed["status"] == "INACTIVE"
    assert listed["balance"]["current"] == 12.34


async def test_the_sample_scenario_holds_two_accounts_on_one_connection_with_recent_transactions(akahu):
    """An import starting 10 days back finds transactions, both sample accounts share one connection, and one is pending"""
    scenario = await _new_scenario(akahu, "/sample")

    listed = (await akahu.get("/v1/accounts", headers=_headers(scenario))).json()["items"]
    chequing = next(account for account in listed if account["name"] == "Everyday Chequing")
    now = datetime.now(UTC)
    recent = await akahu.get(
        f"/v1/accounts/{chequing['_id']}/transactions",
        params={"start": (now - timedelta(days=10)).isoformat(), "end": now.isoformat()},
        headers=_headers(scenario),
    )
    pending = (await akahu.get("/v1/transactions/pending", headers=_headers(scenario))).json()["items"]

    assert [account["name"] for account in listed] == ["Everyday Chequing", "Rewards Visa"]
    assert len({account["connection"]["_id"] for account in listed}) == 1
    assert [item["description"] for item in recent.json()["items"]] == [
        "EFTPOS BEAN THERE CAFE",
        "DIRECT CREDIT BRIGHTWORKS LTD SALARY",
        "EFTPOS NORTHERN FUEL STOP",
    ]
    assert [item["description"] for item in pending] == ["CARD PURCHASE FRESHWAY MARKET"]
