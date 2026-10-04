"""Stand-ins for DNS and a provider's server, so outbound requests never leave the test

The fake SimpleFIN Bridge answers as the Bridge does, for claims, account sets and their faults.
RecordingBridge answers whatever a test needs that the fake can't produce, such as a redirect or a
body that isn't JSON, and records each request so a test can check what went over the wire
"""

from collections.abc import Callable
from datetime import UTC, datetime
from ipaddress import ip_address
from typing import Any, Self

import httpx

from app.services.bank_sync.outbound import IpAddress, OutboundGuard
from app.services.bank_sync.providers.simplefin.adapter import SimpleFinAdapter

# Globally routable. Nothing connects to it, since requests go through a stand-in transport
PUBLIC_ADDRESS = "93.184.215.14"

SIMPLEFIN_BRIDGE_ORIGIN = "https://beta-bridge.simplefin.org"

# What the frozen_now fixture freezes the clock at: 8 pm on 3 October in Los Angeles, already
# 4 October in UTC, so a date taken in the wrong timezone shows
FROZEN_NOW = datetime(2026, 10, 4, 3, tzinfo=UTC)

# Builds the answer to a request, or raises a transport error instead
type Responder = Callable[[httpx.Request], httpx.Response]


class FixedResolver:
    """Resolves every host to fixed addresses and records each lookup"""

    def __init__(self, *addresses: str) -> None:
        """Answer every lookup with these addresses"""
        self.addresses = [ip_address(address) for address in addresses]
        self.lookups: list[tuple[str, int]] = []

    async def __call__(self, host: str, port: int) -> list[IpAddress]:
        """Record the lookup and answer it"""
        self.lookups.append((host, port))
        return self.addresses


class RecordingBridge:
    """A stand-in transport for the provider's server, recording each request that reaches it"""

    def __init__(self, respond: Responder | None = None) -> None:
        """Answer each request with the responder

        Args:
            respond: Builds the answer to a request, an empty JSON object by default
        """
        self.requests: list[httpx.Request] = []
        self._respond = respond or (lambda _request: httpx.Response(200, json={}))
        self.transport = httpx.MockTransport(self._answer)

    def _answer(self, request: httpx.Request) -> httpx.Response:
        """Record the request and answer it"""
        self.requests.append(request)
        return self._respond(request)


def answer_with(status: int, body: bytes, content_type: str = "text/plain") -> Responder:
    """Return a responder answering every request alike"""
    return lambda _request: httpx.Response(status, content=body, headers={"Content-Type": content_type})


def fail_with(error: type[httpx.TransportError]) -> Responder:
    """Return a responder failing every request the way the network would"""

    def fail(request: httpx.Request) -> httpx.Response:
        """Fail the request"""
        raise error("failed", request=request)

    return fail


def simplefin_adapter(transport: httpx.AsyncBaseTransport, *addresses: str) -> SimpleFinAdapter:
    """Return a SimpleFIN adapter allowed to reach SimpleFIN Bridge, whose requests reach only the transport

    Args:
        transport: Where every request goes
        addresses: What every host resolves to, a public address by default
    """
    resolver = FixedResolver(*(addresses or (PUBLIC_ADDRESS,)))
    return SimpleFinAdapter(OutboundGuard([SIMPLEFIN_BRIDGE_ORIGIN], resolve=resolver, transport=transport))


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
