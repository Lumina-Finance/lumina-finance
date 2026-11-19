"""Connections the serving engine replaces, and the limits the app role's connections carry"""

import asyncio
import time

import pytest
from sqlalchemy import event, text

from app import database
from app.database import create_serving_engine
from tests.conftest import engine as admin_engine
from tests.conftest import migrator_engine, scoped_engine

# How long the test waits for an ended connection's process to be gone before it reuses the pool
_TERMINATION_WAIT_MS = 5_000

# A connect timeout short enough to keep the test quick. The engine must honour it in place of its own
_SHORT_CONNECT_TIMEOUT_SECONDS = 0.5


def _app_role_url() -> str:
    """Return the app role's URL for this worker's test database, password included"""
    return scoped_engine.url.render_as_string(hide_password=False)


async def _role_setting(engine, name: str) -> str:
    """Return a setting as PostgreSQL holds it, in its base unit, on a new connection of the engine's role"""
    async with engine.connect() as connection:
        return await connection.scalar(text("SELECT setting FROM pg_settings WHERE name = :name"), {"name": name})


async def test_a_pooled_connection_the_database_ended_is_replaced_before_it_is_used():
    """A database restart between two requests leaves the second on a fresh connection instead of failing it"""
    engine = create_serving_engine(_app_role_url())
    try:
        async with engine.connect() as connection:
            first_pid = await connection.scalar(text("SELECT pg_backend_pid()"))

        # Another connection of the same role ends the pooled one, as a database restart would
        async with scoped_engine.connect() as other:
            ended = await other.scalar(text("SELECT pg_terminate_backend(:pid, :wait_ms)"), {"pid": first_pid, "wait_ms": _TERMINATION_WAIT_MS})
        assert ended, "the pooled connection's process should be gone before the pool is used again"

        async with engine.connect() as connection:
            second_pid = await connection.scalar(text("SELECT pg_backend_pid()"))
        assert second_pid != first_pid
    finally:
        await engine.dispose()


async def test_connecting_to_a_database_that_never_answers_fails_within_the_connect_timeout(monkeypatch):
    """An unreachable database fails the request after the connect timeout, not after the driver's minute"""
    # Held so the connection stays open, since a stream writer nothing refers to closes its connection
    accepted = []

    def accept_and_say_nothing(_reader, writer) -> None:
        """Hold the connection open without ever answering, as a host that has stopped responding does"""
        accepted.append(writer)

    server = await asyncio.start_server(accept_and_say_nothing, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    monkeypatch.setattr(database, "CONNECT_TIMEOUT_SECONDS", _SHORT_CONNECT_TIMEOUT_SECONDS)
    engine = create_serving_engine(scoped_engine.url.set(host="127.0.0.1", port=port).render_as_string(hide_password=False))
    try:
        started = time.monotonic()
        with pytest.raises(TimeoutError):
            async with engine.connect():
                pass
        assert time.monotonic() - started < _SHORT_CONNECT_TIMEOUT_SECONDS + 2
    finally:
        await engine.dispose()
        server.close()
        for writer in accepted:
            writer.close()
        await server.wait_closed()


class _ConnectionRefusedForTest(Exception):
    """Raised in place of opening a connection, once the arguments it would open with are recorded"""


async def test_the_engine_requests_run_on_checks_pooled_connections_and_gives_up_connecting_after_ten_seconds():
    """The engine the app serves from is built with both protections, not only engines the other tests build"""
    connect_arguments = []

    def record_and_refuse(_dialect, _connection_record, _positional, keywords):
        """Keep the arguments the engine would connect with, and open nothing"""
        connect_arguments.append(keywords)
        raise _ConnectionRefusedForTest

    # Dropped without closing, since any connection still pooled belongs to another test's event loop
    await database.engine.dispose(close=False)
    event.listen(database.engine.sync_engine, "do_connect", record_and_refuse)
    try:
        with pytest.raises(_ConnectionRefusedForTest):
            async with database.engine.connect():
                pass
    finally:
        event.remove(database.engine.sync_engine, "do_connect", record_and_refuse)

    assert connect_arguments[0]["timeout"] == 10
    assert database.engine.sync_engine.pool._pre_ping


async def test_the_app_role_alone_carries_the_statement_and_idle_transaction_timeouts():
    """Every app role connection stops a statement after a minute and an idle transaction after five, and the other logins have neither"""
    assert await _role_setting(scoped_engine, "statement_timeout") == "60000"
    assert await _role_setting(scoped_engine, "idle_in_transaction_session_timeout") == "300000"
    for other_login in (migrator_engine, admin_engine):
        assert await _role_setting(other_login, "statement_timeout") == "0", "a migration or a backup may run as long as it needs"
        assert await _role_setting(other_login, "idle_in_transaction_session_timeout") == "0"
