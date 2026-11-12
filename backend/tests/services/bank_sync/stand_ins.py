"""Stand-ins for DNS and a provider's server, so outbound requests never leave the test

RecordingBridge answers whatever a test needs, such as a redirect or a body that isn't JSON, and
records each request so a test can check what went over the wire
"""

from collections.abc import Callable
from datetime import UTC, datetime
from ipaddress import ip_address

import httpx

from app.services.bank_sync.outbound import IpAddress

# Globally routable. Nothing connects to it, since requests go through a stand-in transport
PUBLIC_ADDRESS = "93.184.215.14"

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
