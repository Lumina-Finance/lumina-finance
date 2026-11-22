"""A local server standing in for SimpleFIN Bridge, over HTTPS under a certificate naming its host

It listens on loopback while its certificate names only the host, so a client reaches it only by
connecting to the address it was given and verifying TLS against the host name. Served over plain
HTTP instead, it lets a test see where a client's connection really went
"""

import asyncio
import ssl
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from http import HTTPStatus
from pathlib import Path

from tests.tls_authority import issue_certificate

LOOPBACK = "127.0.0.1"

# Answers a request from its head with a status, a content type and a body
type Responder = Callable[[bytes], tuple[int, str, bytes]]


@dataclass
class LocalBridge:
    """The running server, and what reached it"""

    host: str
    port: int

    # A client context trusting only the server's certificate authority, or None over plain HTTP
    client_tls: ssl.SSLContext | None
    request_heads: list[bytes] = field(default_factory=list)

    # The TLS server name each client presented
    server_names: list[str | None] = field(default_factory=list)

    @property
    def origin(self) -> str:
        """The server's origin under its host name"""
        return f"{'https' if self.client_tls else 'http'}://{self.host}:{self.port}"


def _issue_tls(directory: Path, host: str) -> tuple[ssl.SSLContext, ssl.SSLContext]:
    """Return the server's context under a certificate for the host, and a client context trusting its authority"""
    issued = issue_certificate(directory, host, "bridge")
    server_tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_tls.load_cert_chain(issued.certificate_path, issued.key_path)
    client_tls = ssl.create_default_context(cadata=issued.authority_pem)
    return server_tls, client_tls


@asynccontextmanager
async def serve_local_bridge(directory: Path, host: str, respond: Responder, *, tls: bool = True) -> AsyncIterator[LocalBridge]:
    """Serve HTTPS on loopback under a certificate naming the host, one request per connection

    Args:
        directory: Where the certificate and key are written
        host: The name the certificate covers
        respond: Answers each request
        tls: False serves plain HTTP with no certificate

    Yields:
        The running server
    """
    server_tls, client_tls = _issue_tls(directory, host) if tls else (None, None)
    bridge = LocalBridge(host=host, port=0, client_tls=client_tls)
    if server_tls:
        server_tls.sni_callback = lambda _connection, server_name, _context: bridge.server_names.append(server_name)

    async def answer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        """Read one request head and send the response, then close"""
        head = await reader.readuntil(b"\r\n\r\n")
        bridge.request_heads.append(head)
        status, content_type, body = respond(head)
        writer.write(
            f"HTTP/1.1 {status} {HTTPStatus(status).phrase}\r\n"
            f"Content-Type: {content_type}\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode("ascii")
            + body
        )
        await writer.drain()
        writer.close()

    server = await asyncio.start_server(answer, LOOPBACK, 0, ssl=server_tls)
    bridge.port = server.sockets[0].getsockname()[1]
    try:
        yield bridge
    finally:
        server.close()
        await server.wait_closed()
