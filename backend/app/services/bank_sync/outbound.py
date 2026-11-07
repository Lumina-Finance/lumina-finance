"""Outbound request guard for bank provider requests

A credential the user pastes can carry a URL they control, which the server then calls, so every
provider request goes through this guard to keep a crafted URL from reaching an internal service.
Only an allowed HTTPS origin is contacted, every address its host resolves to must be public, and
the connection goes to the address that was checked, so a DNS answer that changes in between
can't send it elsewhere. A testing-only origin, while set, replaces the allowed origins with itself
"""

import asyncio
import contextlib
import logging
import socket
from collections.abc import Awaitable, Callable, Collection, Mapping, Sequence
from contextvars import ContextVar
from ipaddress import IPv4Address, IPv6Address, ip_address

import httpx

from app.http_client import build_http_client

type IpAddress = IPv4Address | IPv6Address
type Resolver = Callable[[str, int], Awaitable[list[IpAddress]]]

# A dead provider fails a sync within seconds, while a slow bank fetch still has time to answer
REQUEST_TIMEOUT = httpx.Timeout(30.0, connect=5.0)

_DEFAULT_PORTS = {"http": 80, "https": 443}

# httpx logs every request line, URL included, at INFO, and httpcore traces each connection at
# DEBUG. A claim URL's path is its secret, so nothing these loggers say during a guarded request
# is kept. Each is named, because a filter on a logger doesn't see what its children log
_HTTP_LIBRARY_LOGGERS = ("httpx", "httpcore.connection", "httpcore.http11", "httpcore.proxy")
_guarded_request_running: ContextVar[bool] = ContextVar("guarded_request_running", default=False)


class _DropWhileGuarded(logging.Filter):
    """Drops what the HTTP libraries log while a guarded request runs in this context"""

    def filter(self, record: logging.LogRecord) -> bool:
        """Keep the record only outside a guarded request"""
        return not _guarded_request_running.get()


for _logger_name in _HTTP_LIBRARY_LOGGERS:
    logging.getLogger(_logger_name).addFilter(_DropWhileGuarded())


class OutboundRefused(Exception):
    """The guard refused a request before sending it. The message names only the host"""


class OriginRefused(OutboundRefused):
    """The URL carries user info, isn't HTTPS, or is on an origin the guard doesn't allow"""


class AddressRefused(OutboundRefused):
    """The host resolves to at least one address that isn't publicly routable"""


async def resolve_host(host: str, port: int) -> list[IpAddress]:
    """Return every address a host name resolves to

    Args:
        host: Host name or literal address
        port: Port the connection will use

    Returns:
        The resolved addresses, in the order the system prefers them
    """
    # AI_ADDRCONFIG leaves out IPv6 answers on a machine with no IPv6 address, as containers
    # often are, so the connection doesn't start with addresses it can never reach
    address_infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM, flags=socket.AI_ADDRCONFIG)
    return [ip_address(sockaddr[0]) for *_, sockaddr in address_infos]


def _origin_of(url: httpx.URL) -> tuple[str, str, int | None]:
    """Return the scheme, host and port that identify a URL's origin"""
    return url.scheme, url.raw_host.decode("ascii").lower(), url.port or _DEFAULT_PORTS.get(url.scheme)


class OutboundGuard:
    """Sends provider requests only to allowed origins, at addresses checked to be public"""

    def __init__(
        self,
        allowed_origins: Collection[str],
        test_origin: str | None = None,
        *,
        resolve: Resolver = resolve_host,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        """Build a guard over a set of allowed origins

        Args:
            allowed_origins: HTTPS origins requests may reach while no test origin is set
            test_origin: Testing only, the one origin requests may reach while it is set, every
                other origin, the allowed ones included, being refused. It is exempt from the
                HTTPS and public address checks
            resolve: Resolves a host name, which tests substitute
            transport: Transport to send through, which tests substitute
        """
        self._allowed_origins = {_origin_of(httpx.URL(origin)) for origin in allowed_origins}
        self._test_origin = _origin_of(httpx.URL(test_origin)) if test_origin else None
        self._resolve = resolve
        self._transport = transport

    def check_origin(self, url: httpx.URL) -> None:
        """Refuse a URL the guard won't send to, before anything is resolved or sent

        Args:
            url: The URL a request would go to

        Raises:
            OriginRefused: The URL carries user info, isn't HTTPS, or is on an origin not allowed, which
                while a test origin is set is every origin but that one
        """
        if url.userinfo:
            raise OriginRefused(f"A URL for {url.host} carries user info")

        # A development instance can hold production's connections, restored with its encryption
        # key, so while the testing-only origin is set nothing else is reached, the real Bridge
        # included, and those connections can't sync with real credentials
        origin = _origin_of(url)
        if self._test_origin is not None:
            if origin != self._test_origin:
                raise OriginRefused(f"{url.host} is not the testing-only origin")
            return
        if url.scheme != "https" or origin not in self._allowed_origins:
            raise OriginRefused(f"{url.host} is not an allowed origin")

    async def send(
        self,
        method: str,
        url: httpx.URL,
        *,
        headers: Mapping[str, str] | None = None,
        params: Sequence[tuple[str, str]] | None = None,
        auth: httpx.BasicAuth | None = None,
        content: bytes | None = None,
    ) -> httpx.Response:
        """Send one request through the guard, without following a redirect

        Args:
            method: HTTP method
            url: Where the request goes, without user info
            headers: Request headers
            params: Query parameters, repeatable
            auth: Credentials, sent only as an Authorization header
            content: Request body

        Returns:
            The response, whatever its status, read under the response size cap

        Raises:
            OriginRefused: The URL's origin is not allowed
            AddressRefused: The host resolves to an address that isn't public
            httpx.RequestError: The host couldn't be resolved in time or the request failed
        """
        self.check_origin(url)

        host = url.raw_host.decode("ascii")
        is_test_origin = _origin_of(url) == self._test_origin
        # The lookup counts toward the connect timeout, since a resolver that never answers would
        # otherwise hold the request with no limit at all
        try:
            async with asyncio.timeout(REQUEST_TIMEOUT.connect):
                addresses = await self._resolve(host, url.port or _DEFAULT_PORTS[url.scheme])
        except TimeoutError:
            raise httpx.ConnectTimeout(f"Couldn't resolve {host} in time") from None
        except OSError:
            raise httpx.ConnectError(f"Couldn't resolve {host}") from None

        if not addresses:
            raise httpx.ConnectError(f"Couldn't resolve {host}")
        # An IPv4 address written in IPv6 form is judged as the IPv4 address it reaches, which
        # is_global does itself since Python 3.13
        if not is_test_origin and not all(address.is_global for address in addresses):
            raise AddressRefused(f"{host} resolves to an address that isn't public")

        # The connection goes to a checked address, while the Host header and the TLS server name
        # keep the original host, so certificate checks still name it
        request_headers = {**(headers or {}), "Host": url.netloc.decode("ascii")}

        guarded = _guarded_request_running.set(True)
        try:
            # A proxy from the environment would make the connection itself, to whatever address it
            # resolved, so none is used
            async with build_http_client(REQUEST_TIMEOUT, transport=self._transport, trust_env=False) as client:

                async def request_at(address: IpAddress) -> httpx.Response:
                    """Send the request to one checked address"""
                    return await client.request(
                        method,
                        url.copy_with(host=str(address)),
                        headers=request_headers,
                        params=params,
                        auth=auth,
                        content=content,
                        follow_redirects=False,
                        extensions={"sni_hostname": host},
                    )

                # A host can list an address this server has no route to, such as IPv6 in a
                # container without it, so a failed connection moves on to the next checked one.
                # Only connecting is retried, since a request that may have arrived is never resent
                for address in addresses[:-1]:
                    with contextlib.suppress(httpx.ConnectError, httpx.ConnectTimeout):
                        return await request_at(address)
                return await request_at(addresses[-1])
        finally:
            _guarded_request_running.reset(guarded)
