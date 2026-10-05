"""Outbound request guard tests

A SimpleFIN setup token decodes to a URL the user controls, so these guard against a crafted URL
or a hostile DNS answer making the server reach an internal address
"""

import asyncio
import socket

import httpx
import pytest

from app.services.bank_sync import outbound
from app.services.bank_sync.outbound import AddressRefused, IpAddress, OriginRefused, OutboundGuard
from tests.services.bank_sync.local_bridge import LOOPBACK, serve_local_bridge
from tests.services.bank_sync.stand_ins import PUBLIC_ADDRESS, FixedResolver, RecordingBridge, fail_with

_BRIDGE_ORIGIN = "https://bridge.simplefin.org"

# Globally routable, like PUBLIC_ADDRESS, and never connected to
_PUBLIC_IPV6_ADDRESS = "2606:4700:4700::1111"
_ACCOUNTS_URL = httpx.URL("https://bridge.simplefin.org/simplefin/accounts")


async def test_allowed_origin_is_reached_at_the_checked_address_under_its_own_name():
    """The connection goes to the address that was checked, while the server still sees its host name"""
    resolver = FixedResolver(PUBLIC_ADDRESS)
    bridge = RecordingBridge()
    guard = OutboundGuard([_BRIDGE_ORIGIN], resolve=resolver, transport=bridge.transport)

    response = await guard.send("GET", _ACCOUNTS_URL)

    assert response.status_code == 200
    assert resolver.lookups == [("bridge.simplefin.org", 443)]
    [request] = bridge.requests
    assert request.url.host == PUBLIC_ADDRESS
    assert request.url.path == "/simplefin/accounts"
    assert request.headers["host"] == "bridge.simplefin.org"
    assert request.extensions["sni_hostname"] == "bridge.simplefin.org"


@pytest.mark.parametrize(
    "url",
    [
        "http://bridge.simplefin.org/simplefin/claim/token",
        "https://intranet.example/simplefin/claim/token",
        "https://bridge.simplefin.org:8443/simplefin/claim/token",
        "https://user:secret@bridge.simplefin.org/simplefin/accounts",
    ],
    ids=["plain-http", "unlisted-origin", "unlisted-port", "user-info"],
)
async def test_url_outside_the_allowlist_is_refused_before_anything_is_sent(url):
    """Nothing is resolved or sent for a URL the allowlist doesn't cover"""
    resolver = FixedResolver(PUBLIC_ADDRESS)
    bridge = RecordingBridge()
    guard = OutboundGuard([_BRIDGE_ORIGIN], resolve=resolver, transport=bridge.transport)

    with pytest.raises(OriginRefused):
        await guard.send("GET", httpx.URL(url))

    assert resolver.lookups == []
    assert bridge.requests == []


@pytest.mark.parametrize(
    "addresses",
    [
        ("10.0.4.2",),
        ("100.64.0.7",),
        ("169.254.169.254",),
        ("127.0.0.1",),
        ("::1",),
        ("::ffff:10.0.4.2",),
        (PUBLIC_ADDRESS, "10.0.4.2"),
    ],
    ids=["private", "shared", "metadata", "loopback", "ipv6-loopback", "ipv6-mapped-private", "public-and-private"],
)
async def test_host_resolving_to_a_non_public_address_is_refused(addresses):
    """An allowed host is refused once DNS points it, even partly, at an address that isn't public"""
    bridge = RecordingBridge()
    guard = OutboundGuard([_BRIDGE_ORIGIN], resolve=FixedResolver(*addresses), transport=bridge.transport)

    with pytest.raises(AddressRefused):
        await guard.send("GET", _ACCOUNTS_URL)

    assert bridge.requests == []


async def test_address_that_cant_be_connected_to_falls_back_to_the_next_checked_one():
    """A host whose IPv6 address has no route from here is still reached over its IPv4 address"""

    def answer(request: httpx.Request) -> httpx.Response:
        """Fail to connect over IPv6, as a container without an IPv6 route does"""
        if request.url.host == _PUBLIC_IPV6_ADDRESS:
            raise httpx.ConnectError("Network is unreachable", request=request)
        return httpx.Response(200, json={})

    bridge = RecordingBridge(answer)
    guard = OutboundGuard([_BRIDGE_ORIGIN], resolve=FixedResolver(_PUBLIC_IPV6_ADDRESS, PUBLIC_ADDRESS), transport=bridge.transport)

    response = await guard.send("GET", _ACCOUNTS_URL)

    assert response.status_code == 200
    assert [request.url.host for request in bridge.requests] == [_PUBLIC_IPV6_ADDRESS, PUBLIC_ADDRESS]


@pytest.mark.parametrize(
    ("error", "attempts"),
    [(httpx.ConnectError, 2), (httpx.ConnectTimeout, 2), (httpx.ReadTimeout, 1)],
    ids=["no-address-connects", "no-address-connects-in-time", "fails-after-connecting"],
)
async def test_request_moves_to_another_address_only_while_connecting(error, attempts):
    """Every address is tried before giving up, while a request that may have arrived is never resent"""
    bridge = RecordingBridge(fail_with(error))
    guard = OutboundGuard([_BRIDGE_ORIGIN], resolve=FixedResolver(_PUBLIC_IPV6_ADDRESS, PUBLIC_ADDRESS), transport=bridge.transport)

    with pytest.raises(error):
        await guard.send("GET", _ACCOUNTS_URL)

    assert len(bridge.requests) == attempts


async def test_redirect_is_not_followed():
    """A redirect, here towards a metadata endpoint, comes back as the answer and is never requested"""
    bridge = RecordingBridge(lambda _request: httpx.Response(302, headers={"Location": "http://169.254.169.254/latest/meta-data"}))
    guard = OutboundGuard([_BRIDGE_ORIGIN], resolve=FixedResolver(PUBLIC_ADDRESS), transport=bridge.transport)

    response = await guard.send("GET", _ACCOUNTS_URL)

    assert response.status_code == 302
    assert len(bridge.requests) == 1


async def _fail_lookup(host: str, port: int) -> list[IpAddress]:
    """Fail the way the system resolver does for an unknown name"""
    raise socket.gaierror(socket.EAI_NONAME, "Name or service not known")


@pytest.mark.parametrize("resolve", [_fail_lookup, FixedResolver()], ids=["lookup-fails", "no-addresses"])
async def test_host_that_does_not_resolve_fails_as_a_connection_error(resolve):
    """A lookup failure reaches callers as the transport failure they already handle"""
    bridge = RecordingBridge()
    guard = OutboundGuard([_BRIDGE_ORIGIN], resolve=resolve, transport=bridge.transport)

    with pytest.raises(httpx.ConnectError):
        await guard.send("GET", _ACCOUNTS_URL)

    assert bridge.requests == []


async def test_host_lookup_that_never_answers_times_out_as_connecting(monkeypatch):
    """A resolver that hangs is held to the connect timeout, so a sync can't wait on it forever"""
    monkeypatch.setattr(outbound, "REQUEST_TIMEOUT", httpx.Timeout(30.0, connect=0.05))

    async def hang(host: str, port: int) -> list[IpAddress]:
        """Never answer, as a resolver whose server has gone quiet"""
        await asyncio.Event().wait()
        return []

    bridge = RecordingBridge()
    guard = OutboundGuard([_BRIDGE_ORIGIN], resolve=hang, transport=bridge.transport)

    # Bounded, so a lookup left unlimited fails the test rather than hanging it
    async with asyncio.timeout(5):
        with pytest.raises(httpx.ConnectTimeout):
            await guard.send("GET", _ACCOUNTS_URL)

    assert bridge.requests == []


async def test_test_origin_reaches_a_private_address_over_http():
    """The testing-only origin lets a development instance reach a fake Bridge on its private network"""
    bridge = RecordingBridge()
    guard = OutboundGuard([_BRIDGE_ORIGIN], "http://fake-bridge:8080", resolve=FixedResolver("172.18.0.5"), transport=bridge.transport)

    await guard.send("GET", httpx.URL("http://fake-bridge:8080/simplefin/accounts"))

    [request] = bridge.requests
    assert request.url.host == "172.18.0.5"
    assert request.headers["host"] == "fake-bridge:8080"


@pytest.mark.parametrize(
    "url",
    [
        "http://fake-bridge:8081/simplefin/accounts",
        "https://fake-bridge:8080/simplefin/accounts",
        "http://other-bridge:8080/simplefin/accounts",
    ],
    ids=["other-port", "other-scheme", "other-private-host"],
)
async def test_test_origin_exempts_only_itself(url):
    """The testing-only setting exempts exactly one origin, so nothing beside it reaches a private address"""
    bridge = RecordingBridge()
    guard = OutboundGuard([_BRIDGE_ORIGIN], "http://fake-bridge:8080", resolve=FixedResolver("172.18.0.5"), transport=bridge.transport)

    with pytest.raises(OriginRefused):
        await guard.send("GET", httpx.URL(url))

    assert bridge.requests == []


async def test_test_origin_refuses_the_allowed_origins():
    """While the testing-only origin is set nothing else is reached, so a dev instance can't sync production's connections"""
    bridge = RecordingBridge()
    guard = OutboundGuard([_BRIDGE_ORIGIN], "http://fake-bridge:8080", resolve=FixedResolver(PUBLIC_ADDRESS), transport=bridge.transport)

    with pytest.raises(OriginRefused):
        await guard.send("GET", _ACCOUNTS_URL)

    assert bridge.requests == []


async def test_proxy_named_in_the_environment_is_not_used(tmp_path, monkeypatch):
    """A proxy would connect to whatever address it resolved, so the request goes straight to the checked one

    Nothing listens at the proxy's address, so the request succeeds only by bypassing it
    """
    for name in ("HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"):
        monkeypatch.setenv(name, "http://127.0.0.1:9")
    for name in ("NO_PROXY", "no_proxy"):
        monkeypatch.delenv(name, raising=False)

    async with serve_local_bridge(tmp_path, "bridge.test", lambda _head: (200, "application/json", b"{}"), tls=False) as bridge:
        # No transport, so the client is built as in production
        guard = OutboundGuard([], bridge.origin, resolve=FixedResolver(LOOPBACK))

        response = await guard.send("GET", httpx.URL(f"{bridge.origin}/simplefin/accounts"))

    assert response.status_code == 200
    assert len(bridge.request_heads) == 1


async def test_tls_connects_to_the_checked_address_and_verifies_the_host_name(tmp_path):
    """A real TLS request reaches a loopback server whose certificate names only the host

    The host name resolves nowhere but through the guard, and the certificate doesn't name the
    loopback address, so the request succeeds only by connecting to the checked address while
    presenting the host name for TLS
    """

    def answer(_head: bytes) -> tuple[int, str, bytes]:
        """Answer with an empty account set"""
        return 200, "application/json", b"{}"

    async with serve_local_bridge(tmp_path, "bridge.test", answer) as bridge:
        resolver = FixedResolver(LOOPBACK)
        guard = OutboundGuard([], bridge.origin, resolve=resolver, transport=httpx.AsyncHTTPTransport(verify=bridge.client_tls))

        response = await guard.send("GET", httpx.URL(f"{bridge.origin}/simplefin/accounts"))

    assert response.json() == {}
    assert resolver.lookups == [("bridge.test", bridge.port)]
    assert bridge.server_names == ["bridge.test"]
    [head] = bridge.request_heads
    assert f"\r\nhost: bridge.test:{bridge.port}\r\n" in head.decode("ascii").lower()
