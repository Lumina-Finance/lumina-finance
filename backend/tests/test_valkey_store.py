"""The ValKey store keeps a cache from ever failing or stalling a request

Tests with a healthy server use the real test ValKey. The failure cases use a server that misbehaves
on purpose, since a real one cannot be made to stall mid-reply on demand
"""

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from datetime import timedelta
from types import SimpleNamespace

import pytest

from app import main
from app import valkey_store as store_module
from app.config.env import require
from app.valkey_store import (
    CHUNK_SIZE,
    DEFAULT_NAMESPACE,
    FAILURE_COOLDOWN_SECONDS,
    OPERATION_TIMEOUT_SECONDS,
    ValkeyEntry,
    ValkeyStore,
    get_valkey,
    use_valkey,
)
from tests.valkey_fakes import (
    ANSWER,
    LATE,
    NOT_A_REPLY,
    OUT_OF_MEMORY,
    READ_ONLY,
    STALL,
    STILL_LOADING,
    TRICKLE,
    fake_valkey_server,
)

# A bound far above what a timed-out call takes (the operation timeout), and far below the cooldown
# and the seconds a stalled server would hold a call for, so a slow runner cannot fail the test
_CALL_TIME_LIMIT_SECONDS = 2.0

_ONE_HOUR = timedelta(hours=1)


@pytest.fixture
def clock(monkeypatch):
    """Move the store's clock forward on demand, returning the function that does it"""
    offset = [0.0]
    monkeypatch.setattr(store_module, "monotonic", lambda: time.monotonic() + offset[0])

    def advance(seconds: float) -> None:
        offset[0] += seconds

    return advance


async def _timed(call) -> tuple[object, float]:
    """Await a call, returning its result and how long it took"""
    started_at = time.monotonic()
    result = await call
    return result, time.monotonic() - started_at


async def test_values_round_trip_under_their_keys(valkey_store):
    """Each stored value comes back under its key, and a key never stored is left out

    How long ValKey holds each entry is checked through the exchange rate cache's lifetime table
    """
    await valkey_store.set_many(
        [
            ValkeyEntry("short", b"1.25", timedelta(minutes=5)),
            ValkeyEntry("long", b"missing", timedelta(days=180)),
        ]
    )

    found = await valkey_store.get_many(["short", "long", "absent"])

    assert found == {"short": b"1.25", "long": b"missing"}


async def test_keep_existing_leaves_a_stored_value_and_a_plain_set_replaces_it(valkey_store):
    """A value written to keep what is there never overwrites it, while an ordinary write does"""
    await valkey_store.set_many([ValkeyEntry("rate", b"1.25", _ONE_HOUR)])

    await valkey_store.set_many([ValkeyEntry("rate", b"missing", _ONE_HOUR), ValkeyEntry("new", b"missing", _ONE_HOUR)], keep_existing=True)
    assert await valkey_store.get_many(["rate", "new"]) == {"rate": b"1.25", "new": b"missing"}

    await valkey_store.set_many([ValkeyEntry("rate", b"1.5", _ONE_HOUR)])
    assert await valkey_store.get_many(["rate"]) == {"rate": b"1.5"}


async def test_namespaces_keep_one_store_from_reading_anothers_keys(valkey_store):
    """Two stores on one ValKey with different namespaces do not see each other's entries"""
    other = ValkeyStore(valkey_store.client, namespace=valkey_store.namespace + "other:")
    await valkey_store.set_many([ValkeyEntry("rate", b"1.25", _ONE_HOUR)])

    assert await other.get_many(["rate"]) == {}


async def test_more_keys_than_one_chunk_all_round_trip(valkey_store):
    """A range longer than a chunk is read and written in several commands without losing a key"""
    keys = [f"day-{index}" for index in range(CHUNK_SIZE * 2 + 1)]
    await valkey_store.set_many([ValkeyEntry(key, key.encode(), _ONE_HOUR) for key in keys])

    found = await valkey_store.get_many(keys)

    assert found == {key: key.encode() for key in keys}


@pytest.mark.parametrize("runtime", ["server", "lambda"])
async def test_the_app_lifespan_publishes_the_configured_store_only_while_the_app_runs(monkeypatch, runtime):
    """Every runtime the app starts in gets the cache, and none keeps it once the app stops

    The startup checks and the pruning timer are replaced, since they need the app's own database
    rather than the test one
    """

    async def do_nothing(*_args) -> None:
        return None

    @asynccontextmanager
    async def nothing_open():
        yield None

    async def wait_forever() -> None:
        await asyncio.Event().wait()

    monkeypatch.setattr(main, "RUNTIME", runtime)
    monkeypatch.setattr(main, "verify_app_role_is_unprivileged", do_nothing)
    monkeypatch.setattr(main, "engine", SimpleNamespace(connect=nothing_open))
    monkeypatch.setattr(main, "verify_key_matches_data", do_nothing)
    monkeypatch.setattr(main, "verify_key_matches_hashes", do_nothing)
    monkeypatch.setattr(main, "async_session", nothing_open)
    monkeypatch.setattr(main, "sync_oidc_providers", do_nothing)
    monkeypatch.setattr(main, "prune_expired_records_on_schedule", wait_forever)
    monkeypatch.setattr(store_module, "VALKEY_URL", require("TEST_VALKEY_URL"))

    async with main._lifespan(main.app):
        assert isinstance(get_valkey(), ValkeyStore)

    assert get_valkey() is None


async def test_a_pool_that_cannot_be_built_logs_a_warning_and_runs_without_the_cache(monkeypatch, caplog):
    """The server starts when the client rejects the address, with no cache and a warning that omits it"""
    calls = []

    def refuse(url, namespace=DEFAULT_NAMESPACE):
        calls.append(url)
        raise ValueError("the client did not like this")

    monkeypatch.setattr(store_module, "VALKEY_URL", "valkey://:hunter2@cache.example.test:6379")
    monkeypatch.setattr(ValkeyStore, "from_url", refuse)

    with caplog.at_level(logging.WARNING, logger="app.valkey_store"):
        async with use_valkey() as published:
            assert published is None
            assert get_valkey() is None

    assert len(calls) == 1
    assert "ValueError" in caplog.text
    assert "hunter2" not in caplog.text


async def test_no_configured_address_publishes_no_store(monkeypatch):
    """Without VALKEY_URL nothing connects and the app asks the provider on every read"""
    monkeypatch.setattr(store_module, "VALKEY_URL", None)

    async with use_valkey() as published:
        assert published is None
        assert get_valkey() is None


async def test_a_stalled_server_is_a_miss_then_skipped_until_the_cooldown_ends(clock):
    """A server that never answers costs one timeout, then no connection until the cooldown ends

    After it, a server that answers is read again and gives the right value for the key asked
    """
    async with fake_valkey_server(STALL, ANSWER) as server:
        store = ValkeyStore.from_url(server.url, namespace="t:")
        try:
            found, read_seconds = await _timed(store.get_many(["a"]))
            assert found == {}
            assert OPERATION_TIMEOUT_SECONDS <= read_seconds < _CALL_TIME_LIMIT_SECONDS
            assert server.connections == 1

            _, write_seconds = await _timed(store.set_many([ValkeyEntry("a", b"1.25", _ONE_HOUR)]))
            found, skipped_seconds = await _timed(store.get_many(["a"]))
            assert write_seconds < OPERATION_TIMEOUT_SECONDS
            assert found == {}
            assert skipped_seconds < OPERATION_TIMEOUT_SECONDS
            assert server.connections == 1

            clock(FAILURE_COOLDOWN_SECONDS + 1)
            assert await store.get_many(["b"]) == {"b": b"t:b"}
            assert server.connections == 2
        finally:
            await store.aclose()


async def test_a_timed_out_call_never_hands_its_late_reply_to_the_next_call(clock):
    """With one connection in the pool, a reply that arrives after its call gave up is not read as the next answer

    The first connection answers 'a' only after the client has given up. A pool that kept that
    connection would read the late reply for 'a' as the answer to 'b'
    """
    async with fake_valkey_server(LATE, ANSWER) as server:
        store = ValkeyStore.from_url(server.url, namespace="t:")
        store.client.connection_pool.max_connections = 1
        try:
            assert await store.get_many(["a"]) == {}

            clock(FAILURE_COOLDOWN_SECONDS + 1)
            assert await store.get_many(["b"]) == {"b": b"t:b"}
            assert server.connections == 2
        finally:
            await store.aclose()


async def test_a_reply_trickling_in_a_byte_at_a_time_is_a_miss_within_the_time_limit():
    """A server that sends each byte in time but takes too long overall cannot hold a call past the limit"""
    async with fake_valkey_server(TRICKLE) as server:
        store = ValkeyStore.from_url(server.url, namespace="t:")
        try:
            found, seconds = await _timed(store.get_many(["a-key-long-enough-to-trickle-past-the-limit"]))
        finally:
            await store.aclose()

    assert found == {}
    assert OPERATION_TIMEOUT_SECONDS <= seconds < _CALL_TIME_LIMIT_SECONDS


@pytest.mark.parametrize("reply", [OUT_OF_MEMORY, STILL_LOADING, READ_ONLY, NOT_A_REPLY], ids=["oom", "loading", "readonly", "garbage"])
async def test_an_error_reply_is_a_miss_and_a_skipped_write_and_starts_the_cooldown(reply):
    """A server that answers with an error, or with bytes that are no reply, never raises into the request"""
    async with fake_valkey_server(reply) as server:
        store = ValkeyStore.from_url(server.url, namespace="t:")
        try:
            assert await store.get_many(["a"]) == {}
            await store.set_many([ValkeyEntry("a", b"1.25", _ONE_HOUR)])
            assert await store.get_many(["a"]) == {}
            commands_sent = len(server.data_commands)
            connections = server.connections
        finally:
            await store.aclose()

    # Some replies fail the client's setup on connecting, before any read is sent. Either way the
    # cooldown held the later calls back, so the server saw one connection and at most the first read
    assert commands_sent <= 1
    assert connections == 1


async def test_an_error_that_is_not_the_clients_own_is_still_a_miss_and_a_skipped_write_and_starts_the_cooldown():
    """Whatever a client call raises, not only the client's own errors, stays inside the best-effort boundary

    The real client passes through errors from its socket, TLS and reply parser. This one raises a
    RuntimeError from mget and from the pipeline's execute, which no error-reply test reaches
    """
    calls: list[str] = []

    class BrokenPipeline:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc_info):
            return False

        def set(self, *args, **kwargs):
            pass

        async def execute(self):
            calls.append("execute")
            raise RuntimeError("not a ValKey error")

    class BrokenClient:
        async def mget(self, keys):
            calls.append("mget")
            raise RuntimeError("not a ValKey error")

        def pipeline(self, transaction):
            return BrokenPipeline()

    reading = ValkeyStore(BrokenClient(), namespace="t:")
    assert await reading.get_many(["a"]) == {}
    assert await reading.get_many(["a"]) == {}
    assert calls == ["mget"]

    calls.clear()
    writing = ValkeyStore(BrokenClient(), namespace="t:")
    await writing.set_many([ValkeyEntry("a", b"1.25", _ONE_HOUR)])
    await writing.set_many([ValkeyEntry("a", b"1.25", _ONE_HOUR)])
    assert calls == ["execute"]


async def test_a_server_that_is_not_there_is_a_miss_and_a_skipped_write():
    """Nothing listening on the address is the same as an empty cache"""
    async with fake_valkey_server(ANSWER) as server:
        url = server.url

    store = ValkeyStore.from_url(url, namespace="t:")
    try:
        found, read_seconds = await _timed(store.get_many(["a"]))
        await store.set_many([ValkeyEntry("a", b"1.25", _ONE_HOUR)])
    finally:
        await store.aclose()

    assert found == {}
    assert read_seconds < _CALL_TIME_LIMIT_SECONDS
