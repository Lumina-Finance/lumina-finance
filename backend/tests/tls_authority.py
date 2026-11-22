"""A throwaway certificate authority issuing a server certificate for one host"""

import ipaddress
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


@dataclass(frozen=True)
class IssuedCertificate:
    """The authority's certificate, and the server's certificate and key written to files"""

    authority_pem: str
    certificate_path: Path
    key_path: Path


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


def _subject_name(host: str) -> x509.GeneralName:
    """Return the certificate's name for the host, an address entry when the host is an IP address"""
    try:
        return x509.IPAddress(ipaddress.ip_address(host))
    except ValueError:
        return x509.DNSName(host)


def issue_certificate(directory: Path, host: str, name: str) -> IssuedCertificate:
    """Issue a certificate for the host from a new throwaway authority

    Built with every extension strict verification asks for. Python applies that verification by default

    Args:
        directory: Where the server's certificate and key are written
        host: The only host name or IP address the certificate covers
        name: Names the authority and the files, so several servers can share a directory

    Returns:
        The authority's certificate and the server's files
    """
    valid_from = datetime.now(UTC) - timedelta(minutes=5)
    valid_until = valid_from + timedelta(hours=1)

    authority_key = ec.generate_private_key(ec.SECP256R1())
    authority_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"{name} test authority")])
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
        .add_extension(x509.SubjectAlternativeName([_subject_name(host)]), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(_key_usage(signs_certificates=False), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(server_key.public_key()), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(authority_key.public_key()), critical=False)
        .sign(authority_key, hashes.SHA256())
    )

    certificate_path = directory / f"{name}.crt"
    key_path = directory / f"{name}.key"
    certificate_path.write_bytes(server.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(server_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    return IssuedCertificate(authority.public_bytes(serialization.Encoding.PEM).decode("ascii"), certificate_path, key_path)
