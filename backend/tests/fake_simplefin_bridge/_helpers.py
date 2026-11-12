"""Control and protocol calls the fake Bridge's own tests share"""

import base64

import httpx

BRIDGE_URL = "http://bridge.test"
DAY_SECONDS = 86_400


async def _create_scenario(bridge: httpx.AsyncClient) -> tuple[str, str]:
    """Create a scenario and return its id and setup token"""
    resp = await bridge.post("/control/scenarios")
    assert resp.status_code == 201
    return resp.json()["id"], resp.json()["setup_token"]


async def _add_account(bridge: httpx.AsyncClient, scenario_id: str, **overrides) -> str:
    """Add a USD bank account on a new connection and return the account's id"""
    connection = await bridge.post(f"/control/scenarios/{scenario_id}/connections", json={"name": "Fake Bank", "org_id": "ORG-fake"})
    assert connection.status_code == 201

    payload = {"name": "Chequing", "conn_id": connection.json()["conn_id"], "currency": "USD", "balance": "100.00"}
    account = await bridge.post(f"/control/scenarios/{scenario_id}/accounts", json=payload | overrides)
    assert account.status_code == 201
    return account.json()["id"]


async def _add_transactions(bridge: httpx.AsyncClient, scenario_id: str, account_id: str, transactions: list[dict]) -> None:
    """Add transactions to a bank account"""
    resp = await bridge.post(f"/control/scenarios/{scenario_id}/accounts/{account_id}/transactions", json={"transactions": transactions})
    assert resp.status_code == 201


async def _claim(bridge: httpx.AsyncClient, setup_token: str) -> httpx.Response:
    """Post to the claim URL a setup token decodes to"""
    return await bridge.post(base64.b64decode(setup_token).decode())


async def _claim_access_url(bridge: httpx.AsyncClient, setup_token: str) -> str:
    """Claim a setup token and return the access URL"""
    resp = await _claim(bridge, setup_token)
    assert resp.status_code == 200
    return resp.text


async def _get_accounts(bridge: httpx.AsyncClient, access_url: str, params: dict | None = None) -> httpx.Response:
    """Request version 2 of the account set with the access URL's Basic credentials"""
    return await bridge.get(f"{access_url}/accounts", params={"version": "2"} | (params or {}))
