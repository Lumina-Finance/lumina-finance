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
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

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


def _key_usage(*, signs_certificates: bool) -> x509.KeyUsage:
    """Return the key usage of a certificate authority or of a server"""
    return x509.KeyUsage(
        digital_signature=not signs_certificates,
        content_commitment=False,
        key_encipherment=False,
        data_encipherment=False,
        key_agreement=False,
        key_cert_sign=signs_certificates,
        crl_sign=signs_certificates,
        encipher_only=False,
        decipher_only=False,
    )


def _issue_tls(directory: Path, host: str) -> tuple[ssl.SSLContext, ssl.SSLContext]:
    """Issue a certificate for the host from a throwaway authority

    Built with every extension strict verification asks for. Python applies that verification by default

    Args:
        directory: Where the server's certificate and key are written
        host: The only name the certificate covers

    Returns:
        The server's context and a client context trusting the authority
    """
    valid_from = datetime.now(UTC) - timedelta(minutes=5)
    valid_until = valid_from + timedelta(hours=1)

    authority_key = ec.generate_private_key(ec.SECP256R1())
    authority_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Local bridge test authority")])
    authority = (
        x509.CertificateBuilder()
        .subject_name(authority_name)
        .issuer_name(authority_name)
        .public_key(authority_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(valid_from)
        .not_valid_after(valid_until)
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .add_extension(_key_usage(signs_certificates=True), critical=True)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(authority_key.public_key()), critical=False)
        .sign(authority_key, hashes.SHA256())
    )

    server_key = ec.generate_private_key(ec.SECP256R1())
    server = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, host)]))
        .issuer_name(authority_name)
        .public_key(server_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(valid_from)
        .not_valid_after(valid_until)
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(host)]), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(_key_usage(signs_certificates=False), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(server_key.public_key()), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(authority_key.public_key()), critical=False)
        .sign(authority_key, hashes.SHA256())
    )

    certificate_path = directory / "bridge.crt"
    key_path = directory / "bridge.key"
    certificate_path.write_bytes(server.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(server_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))

    server_tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_tls.load_cert_chain(certificate_path, key_path)
    client_tls = ssl.create_default_context(cadata=authority.public_bytes(serialization.Encoding.PEM).decode("ascii"))
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
