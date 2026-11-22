"""Database connections that verify the server's certificate, guarding against one that trusts any server or falls back to plain text

With `PGSSLMODE=verify-full`, the database driver checks each connection's certificate against the
authority `PGSSLROOTCERT` names and against the host it was asked to reach. These tests show that every
command that connects takes those settings, each run as the image runs it, in a process of its own. The
server with TLS accepts network connections only over TLS, so a connection that reaches it at all came
over TLS
"""

import asyncio
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

from app.config import database as database_config
from app.config.database import app_database_url
from app.database import create_serving_engine
from tests.db.support import (
    APP_PASSWORD,
    LOGIN_PASSWORD,
    SUPERUSER_LOGIN,
    Cluster,
    Target,
    bootstrap_environment,
    migrate_environment,
    query,
    run_docker,
    run_job,
    run_python,
    start_server,
)
from tests.tls_authority import issue_certificate

# The address the throwaway servers are published on, and the only address in the server's certificate
_HOST = "127.0.0.1"

# Another name for the same address. The certificate doesn't cover it
_UNCOVERED_HOST = "localhost"

# Server settings that log every connection with the database it asked for, from the moment the server
# reads its login, whatever the outcome of that login
_LOGS_EACH_LOGIN = ("-c", "log_connections=on", "-c", "log_line_prefix=%d ")

# Writes the server's certificate and key into the container, then starts PostgreSQL with TLS on and a
# rule that accepts a network connection only over TLS. The server reads the files as it starts, and
# refuses a key readable by anyone but its own user
_TLS_SERVER_SCRIPT = """
set -eu
printf '%s\\n' "$SERVER_CERTIFICATE" > /tmp/server.crt
printf '%s\\n' "$SERVER_KEY" > /tmp/server.key
printf 'local all all trust\\nhostssl all all all scram-sha-256\\n' > /tmp/pg_hba.conf
chown postgres:postgres /tmp/server.crt /tmp/server.key /tmp/pg_hba.conf
chmod 600 /tmp/server.key
exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/server.crt -c ssl_key_file=/tmp/server.key \\
    -c hba_file=/tmp/pg_hba.conf "$@"
"""

# The start-up step the app and the bank sync worker run first, on the serving connection
_SERVING_START = "import asyncio; from app.db.database_keys import verify_database_keys; asyncio.run(verify_database_keys())"

# Every command that opens its own connection, each the first to connect in its process
_CONNECTING_COMMANDS = [
    pytest.param(("-m", "app.db.jobs", "bootstrap"), id="bootstrap"),
    pytest.param(("-m", "app.db.jobs", "migrate"), id="migrate"),
    pytest.param(("-m", "app.db.provision", "ensure-roles"), id="roles"),
    pytest.param(("-m", "app.db.provision", "apply-rls"), id="row-level-security"),
    pytest.param(("-m", "app.db.encryption_key", "ensure-key"), id="encryption-key"),
    pytest.param(("-m", "app.db.encryption_key", "verify-fingerprint"), id="encryption-key-check"),
    pytest.param(("-m", "app.db.bank_transaction_key", "ensure-key"), id="bank-transaction-key"),
    pytest.param(("-m", "app.db.bank_transaction_key", "reset-key"), id="bank-transaction-key-reset"),
    pytest.param(("-m", "alembic", "upgrade", "head"), id="schema-migrations"),
    pytest.param(("-m", "scripts.seed_merchants"), id="seeding"),
    pytest.param(("-m", "scripts.rotate_app_encryption_key", Fernet.generate_key().decode()), id="encryption-key-rotation"),
    pytest.param(("-c", _SERVING_START), id="serving"),
]


@dataclass(frozen=True)
class TlsServer:
    """A running server offering TLS, the authority that signed its certificate, and an unrelated one"""

    cluster: Cluster
    trusted_authority: Path
    other_authority: Path


@pytest.fixture(scope="module")
def tls_server(tmp_path_factory) -> Iterator[TlsServer]:
    """Start a server whose certificate covers only its loopback address, removed afterwards"""
    directory = tmp_path_factory.mktemp("database-tls")
    issued = issue_certificate(directory, _HOST, "database")
    other = issue_certificate(directory, _HOST, "other")
    trusted_authority = directory / "trusted-authority.pem"
    trusted_authority.write_text(issued.authority_pem)
    other_authority = directory / "other-authority.pem"
    other_authority.write_text(other.authority_pem)

    cluster = start_server(
        "-e", f"SERVER_CERTIFICATE={issued.certificate_path.read_text()}",
        "-e", f"SERVER_KEY={issued.key_path.read_text()}",
        "--entrypoint", "sh",
        command=("-c", _TLS_SERVER_SCRIPT, "sh", *_LOGS_EACH_LOGIN),
    )  # fmt: skip
    try:
        yield TlsServer(cluster, trusted_authority, other_authority)
    finally:
        run_docker("rm", "-f", "-v", cluster.container_id)


@pytest.fixture(scope="module")
def plain_server() -> Iterator[Cluster]:
    """Start a server offering no TLS, removed afterwards"""
    cluster = start_server(command=("postgres", *_LOGS_EACH_LOGIN))
    try:
        yield cluster
    finally:
        run_docker("rm", "-f", "-v", cluster.container_id)


def _verify_full(authority: Path) -> dict[str, str]:
    """Return the settings that make every connection require TLS and verify the server against the authority"""
    return {"PGSSLMODE": "verify-full", "PGSSLROOTCERT": str(authority)}


def _refused_target(server: Cluster, host: str) -> Target:
    """Return a database name of its own on the server, reached under the host

    The server logs the name once a connection gets past TLS and sends its login, whatever the outcome of
    that login, so a name missing from the log shows that no connection got that far
    """
    return Target(Cluster(server.container_id, host, server.port), f"refused_{uuid.uuid4().hex[:12]}")


async def test_every_role_connects_over_tls_when_the_certificate_verifies(tls_server, monkeypatch):
    """Bootstrap, migrate and the serving connection all reach the server under the authority that signed its certificate"""
    target = Target(tls_server.cluster, f"tls_{uuid.uuid4().hex[:12]}")
    await query(tls_server.cluster.engine(SUPERUSER_LOGIN, LOGIN_PASSWORD), f'CREATE DATABASE "{target.database_name}"')

    plain = await run_job("bootstrap", bootstrap_environment(target, PGSSLMODE="disable"))
    assert plain.returncode != 0, "the server should refuse a connection without TLS, so reaching it proves TLS"
    assert "no pg_hba.conf entry" in plain.stderr

    verify = _verify_full(tls_server.trusted_authority)
    bootstrapped = await run_job("bootstrap", bootstrap_environment(target, **verify))
    assert bootstrapped.returncode == 0, bootstrapped.stderr
    migrated = await run_job("migrate", migrate_environment(target, **verify))
    assert migrated.returncode == 0, migrated.stderr

    monkeypatch.setattr(database_config, "DB_HOST", target.cluster.host)
    monkeypatch.setattr(database_config, "DB_PORT", str(target.cluster.port))
    monkeypatch.setattr(database_config, "DB_NAME", target.database_name)
    monkeypatch.setenv("APP_DB_PASSWORD", APP_PASSWORD)
    for name, value in verify.items():
        monkeypatch.setenv(name, value)
    is_over_tls = await query(create_serving_engine(app_database_url()), "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()")
    assert is_over_tls is True, "the serving connection should run over TLS"


@pytest.mark.parametrize("command", _CONNECTING_COMMANDS)
async def test_each_connecting_command_refuses_a_certificate_from_another_authority(tls_server, command):
    """Every command that connects stops before sending its login to a server with a certificate from an authority outside the bundle"""
    target = _refused_target(tls_server.cluster, _HOST)
    environment = migrate_environment(
        target,
        DB_USER=SUPERUSER_LOGIN,
        DB_PASSWORD=LOGIN_PASSWORD,
        APP_DB_PASSWORD=APP_PASSWORD,
        **_verify_full(tls_server.other_authority),
    )

    run = await asyncio.to_thread(run_python, *command, environment=environment)

    assert run.returncode != 0, "the command should refuse the server"
    assert "certificate verify failed" in run.stderr, run.stderr
    assert target.database_name not in tls_server.cluster.logs(), "the command sent its login to a server it could not verify"


@pytest.mark.parametrize(
    ("offers_tls", "host", "reason"),
    [
        pytest.param(True, _UNCOVERED_HOST, "mismatch", id="another-host"),
        pytest.param(False, _HOST, "rejected SSL upgrade", id="no-tls"),
    ],
)
async def test_bootstrap_refuses_another_host_or_a_server_without_tls(request, tls_server, offers_tls, host, reason):
    """A certificate for another host, or a server offering no TLS, stops the connection instead of trusting it or using plain text

    The server without TLS holds the admin login bootstrap is given, so a fallback to plain text would succeed in logging in
    """
    server = tls_server.cluster if offers_tls else request.getfixturevalue("plain_server")
    target = _refused_target(server, host)

    run = await run_job("bootstrap", bootstrap_environment(target, **_verify_full(tls_server.trusted_authority)))

    assert run.returncode != 0, "bootstrap should refuse the server"
    assert reason in run.stderr, run.stderr
    assert target.database_name not in server.logs(), "bootstrap sent its login to a server it could not verify"
