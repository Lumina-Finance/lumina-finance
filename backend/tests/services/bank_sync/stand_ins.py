"""Stand-ins for DNS and a provider's server, so outbound requests never leave the test"""

from collections.abc import Callable
from ipaddress import ip_address

import httpx

from app.services.bank_sync.outbound import IpAddress

# Globally routable. Nothing connects to it, since requests go through a stand-in transport
PUBLIC_ADDRESS = "93.184.215.14"


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

    def __init__(self, respond: Callable[[httpx.Request], httpx.Response] | None = None) -> None:
        """Answer each request with the responder, which may raise a transport error instead

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
