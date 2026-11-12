import asyncio

import httpx
import pytest

from tests.fake_simplefin_bridge import state
from tests.fake_simplefin_bridge._helpers import (
    DAY_SECONDS,
    _add_account,
    _add_transactions,
    _claim_access_url,
    _create_scenario,
    _get_accounts,
)

# A fixed window end, so no test depends on today's date
END = 1_790_000_000

# A booked transaction inside every window these tests ask for
BOOKED = {"id": "TRN-1", "posted": END - DAY_SECONDS, "amount": "-12.34", "description": "COFFEE"}


async def _claimed_scenario_with_transaction(bridge: httpx.AsyncClient) -> str:
    """Return the access URL of a scenario holding one account with one booked transaction"""
    scenario_id, setup_token = await _create_scenario(bridge)
    account_id = await _add_account(bridge, scenario_id)
    await _add_transactions(bridge, scenario_id, account_id, [BOOKED])
    return await _claim_access_url(bridge, setup_token)


async def test_accounts_range_of_91_days_is_refused(bridge):
    """A window longer than 90 days gets the Bridge's API usage error and no accounts"""
    access_url = await _claimed_scenario_with_transaction(bridge)

    resp = await _get_accounts(bridge, access_url, {"start-date": END - 91 * DAY_SECONDS, "end-date": END})

    assert resp.status_code == 200
    assert [error["code"] for error in resp.json()["errlist"]] == ["gen.api"]
    assert resp.json()["accounts"] == []


async def test_accounts_range_of_exactly_90_days_is_served(bridge):
    """The limit is 90 days of seconds, so a window of exactly that length is answered in full"""
    access_url = await _claimed_scenario_with_transaction(bridge)

    resp = await _get_accounts(bridge, access_url, {"start-date": END - 90 * DAY_SECONDS, "end-date": END})

    assert resp.status_code == 200
    assert resp.json()["errlist"] == []
    assert [item["id"] for item in resp.json()["accounts"][0]["transactions"]] == ["TRN-1"]


async def test_accounts_scenarios_of_different_tokens_are_isolated(bridge):
    """Each access URL sees only its own scenario's accounts and errors, so parallel tests can't interfere"""
    first_id, first_token = await _create_scenario(bridge)
    second_id, second_token = await _create_scenario(bridge)
    await _add_account(bridge, first_id, id="ACT-first")
    await _add_account(bridge, second_id, id="ACT-second")
    error = await bridge.post(f"/control/scenarios/{first_id}/errors", json={"code": "con.auth", "msg": "Sign in again"})
    assert error.status_code == 201

    first = await _get_accounts(bridge, await _claim_access_url(bridge, first_token))
    second = await _get_accounts(bridge, await _claim_access_url(bridge, second_token))

    assert first.status_code == 200
    assert second.status_code == 200
    assert [account["id"] for account in first.json()["accounts"]] == ["ACT-first"]
    assert [error["code"] for error in first.json()["errlist"]] == ["con.auth"]
    assert [account["id"] for account in second.json()["accounts"]] == ["ACT-second"]
    assert second.json()["errlist"] == []


async def test_accounts_booked_transactions_past_1000_in_a_response_are_left_out(bridge):
    """The cap counts booked transactions across every account in the response, and pending ones still come back"""
    scenario_id, setup_token = await _create_scenario(bridge)
    first_account = await _add_account(bridge, scenario_id)
    second_account = await _add_account(bridge, scenario_id)
    booked = [{"posted": END - DAY_SECONDS - n, "amount": "-1.00", "description": "SNACK"} for n in range(1_001)]
    await _add_transactions(bridge, scenario_id, first_account, booked[:600])
    await _add_transactions(bridge, scenario_id, second_account, [*booked[600:], {"pending": True, "amount": "-5.00", "description": "HOLD"}])
    access_url = await _claim_access_url(bridge, setup_token)

    resp = await _get_accounts(bridge, access_url, {"start-date": END - 30 * DAY_SECONDS, "end-date": END, "pending": 1})

    assert resp.status_code == 200
    transactions = [item for account in resp.json()["accounts"] for item in account["transactions"]]
    assert sum(not item.get("pending") for item in transactions) == 1_000
    assert [item["description"] for item in transactions if item.get("pending")] == ["HOLD"]


async def test_accounts_window_includes_its_start_and_excludes_its_end(bridge):
    """start-date is inclusive and end-date exclusive, so adjacent windows neither skip nor repeat a transaction"""
    scenario_id, setup_token = await _create_scenario(bridge)
    account_id = await _add_account(bridge, scenario_id)
    start = END - 30 * DAY_SECONDS
    await _add_transactions(
        bridge,
        scenario_id,
        account_id,
        [
            {"id": "TRN-at-start", "posted": start, "amount": "-1.00", "description": "FIRST"},
            {"id": "TRN-at-end", "posted": END, "amount": "-2.00", "description": "NEXT WINDOW"},
        ],
    )
    access_url = await _claim_access_url(bridge, setup_token)

    resp = await _get_accounts(bridge, access_url, {"start-date": start, "end-date": END})

    assert resp.status_code == 200
    assert [item["id"] for item in resp.json()["accounts"][0]["transactions"]] == ["TRN-at-start"]


async def test_accounts_timeout_fault_raises_read_timeout_in_process(bridge):
    """Mounted in-process, a timeout fault times out at the client's read timeout as a request to the server does"""
    scenario_id, setup_token = await _create_scenario(bridge)
    access_url = await _claim_access_url(bridge, setup_token)
    fault = await bridge.put(f"/control/scenarios/{scenario_id}/fault", json={"kind": "timeout"})
    assert fault.status_code == 200

    # A per-request timeout reaches the transport, so only this request is held to it
    with pytest.raises(httpx.ReadTimeout):
        await bridge.get(f"{access_url}/accounts", params={"version": "2"}, timeout=0.2)


async def test_accounts_timeout_fault_frees_the_request_it_holds_once_cleared(bridge):
    """Clearing a timeout fault answers the request it holds at once, so a browser test can free the bank sync worker it held

    Left held, the worker would wait out its read timeout, keeping other tests' syncs waiting too
    """
    scenario_id, setup_token = await _create_scenario(bridge)
    access_url = await _claim_access_url(bridge, setup_token)
    await bridge.put(f"/control/scenarios/{scenario_id}/fault", json={"kind": "timeout"})
    held = asyncio.create_task(bridge.get(f"{access_url}/accounts", params={"version": "2"}, timeout=10))
    async with asyncio.timeout(2):
        await state.bridge.scenarios[scenario_id].request_held.wait()

    cleared = await bridge.delete(f"/control/scenarios/{scenario_id}/fault")

    assert cleared.status_code == 204
    async with asyncio.timeout(2):
        assert (await held).status_code == 504
