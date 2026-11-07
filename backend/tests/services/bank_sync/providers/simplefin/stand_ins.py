"""Stand-ins for reaching the in-process fake SimpleFIN Bridge through the SimpleFIN adapter

The fake SimpleFIN Bridge answers as the Bridge does, for claims, account sets and their faults, and
AccountsTimeOut lets it answer claims while every accounts request times out. PausedBridge holds a
request until the test releases it
"""

import asyncio
from typing import Any, Self

import httpx

from app.services.bank_sync.outbound import OutboundGuard
from app.services.bank_sync.providers.simplefin.adapter import SimpleFinAdapter
from tests.fake_simplefin_bridge import FakeBridgeTransport
from tests.services.bank_sync.stand_ins import PUBLIC_ADDRESS, FixedResolver

SIMPLEFIN_BRIDGE_ORIGIN = "https://beta-bridge.simplefin.org"


def simplefin_adapter(transport: httpx.AsyncBaseTransport, *addresses: str) -> SimpleFinAdapter:
    """Return a SimpleFIN adapter allowed to reach SimpleFIN Bridge. Its requests reach only the transport

    Args:
        transport: Where every request goes
        addresses: What every host resolves to, a public address by default
    """
    resolver = FixedResolver(*(addresses or (PUBLIC_ADDRESS,)))
    return SimpleFinAdapter(OutboundGuard([SIMPLEFIN_BRIDGE_ORIGIN], resolve=resolver, transport=transport))


class AccountsTimeOut(httpx.AsyncBaseTransport):
    """Lets a claim reach the fake SimpleFIN Bridge and times out every accounts request"""

    def __init__(self) -> None:
        """Forward to the fake Bridge"""
        self._inner = FakeBridgeTransport()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        """Time out an accounts request, and forward anything else"""
        if request.url.path.endswith("/accounts"):
            raise httpx.ReadTimeout("timed out", request=request)
        return await self._inner.handle_async_request(request)


class PausedBridge(httpx.AsyncBaseTransport):
    """Forwards to the fake SimpleFIN Bridge, holding the first request whose path has a marker until released"""

    def __init__(self, marker: str) -> None:
        """Hold the first request whose path contains the marker, such as /claim/ or /accounts"""
        self._inner = FakeBridgeTransport()
        self._marker = marker
        self.reached = asyncio.Event()
        self.release = asyncio.Event()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        """Hold the first marked request until released, and forward every request"""
        if self._marker in request.url.path and not self.reached.is_set():
            self.reached.set()
            await self.release.wait()
        return await self._inner.handle_async_request(request)


class FakeBridgeScenario:
    """One test's scenario on the in-process fake SimpleFIN Bridge, changed through its control API"""

    def __init__(self, control: httpx.AsyncClient, scenario_id: str, setup_token: str) -> None:
        """Wrap a scenario the fake has created

        Args:
            control: A client on the fake's control API
            scenario_id: The scenario's id
            setup_token: A setup token claiming access to the scenario
        """
        self._control = control
        self._path = f"/control/scenarios/{scenario_id}"
        self.setup_token = setup_token

    @classmethod
    async def create(cls, control: httpx.AsyncClient) -> Self:
        """Create an empty scenario"""
        response = await control.post("/control/scenarios")
        assert response.status_code == 201
        return cls(control, response.json()["id"], response.json()["setup_token"])

    async def new_setup_token(self) -> str:
        """Return another setup token reaching the scenario, as a reconnect needs"""
        response = await self._control.post(f"{self._path}/setup-tokens")
        assert response.status_code == 201
        return response.json()["setup_token"]

    async def change(self, method: str, path: str, body: dict[str, Any] | None = None) -> None:
        """Send one control call for the scenario, such as adding an account or setting a fault

        Args:
            method: HTTP method of the control call
            path: Path under the scenario, such as /accounts
            body: The call's JSON body
        """
        response = await self._control.request(method, f"{self._path}{path}", json=body)
        assert response.is_success, response.text

    async def add_harbour_accounts(self) -> None:
        """Add Everyday Chequing and Online Savings under one Harbour Bank login, and Rewards Visa under another bank's"""
        await self.change("POST", "/connections", {"conn_id": "CON-harbour", "name": "Harbour Bank", "org_id": "ORG-harbour"})
        await self.change(
            "POST", "/connections", {"conn_id": "CON-harbourline", "name": "Harbourline Card Services", "org_id": "ORG-harbourline"}
        )
        for account_id, name, conn_id, balance in [
            ("ACT-chequing", "Everyday Chequing", "CON-harbour", "2510.75"),
            ("ACT-savings", "Online Savings", "CON-harbour", "8200.00"),
            ("ACT-visa", "Rewards Visa", "CON-harbourline", "-640.12"),
        ]:
            account = {"id": account_id, "name": name, "conn_id": conn_id, "currency": "USD", "balance": balance, "balance_date": 1791115200}
            await self.change("POST", "/accounts", account)
