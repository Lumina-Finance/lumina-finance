"""A shared ValKey connection for data the server can fetch again

ValKey is optional. With no address configured nothing here connects, and a ValKey that is
unreachable, slow or failing is treated as empty: a read is a miss and a write is skipped, so a
request never fails on it. Each stage of a command (a free connection, connecting, the reply) is
held to one operation timeout, so a command waits a few of them at worst, and after a failure a
request does not wait at all until the cooldown ends
"""

import logging
from collections.abc import AsyncIterator, Iterable, Sequence
from contextlib import asynccontextmanager
from datetime import timedelta
from itertools import batched
from time import monotonic  # By name, so a test can drive this clock without the event loop's
from typing import NamedTuple, Self

from valkey.asyncio import BlockingConnectionPool, Valkey

from app.config.valkey import VALKEY_URL

logger = logging.getLogger(__name__)

# In front of every key, so one ValKey can also serve other applications. A test uses a namespace
# of its own to keep its keys apart from every other test's
DEFAULT_NAMESPACE = "lumina:"

# Longest the client waits to connect, to write a command and to read the whole reply, and longest it
# waits for a free connection. A cache is only worth having while it answers faster than the source it
# stands in for, so a slow ValKey counts as a miss. The client closes a connection that times out
# or is cancelled mid-reply, so the next command never reads this one's answer
OPERATION_TIMEOUT_SECONDS = 0.25

# Connections one process keeps open. A request holds one only for the length of a command
MAX_CONNECTIONS = 16

# How long every call is answered as a miss, without trying ValKey, after one fails. A server that
# swallows packets would otherwise cost the full timeout on each of the dozens of lookups a page makes
FAILURE_COOLDOWN_SECONDS = 30.0

# Keys sent in one command. A multi-year range holds thousands of keys, and splitting it keeps each
# command's reply and time limit small
CHUNK_SIZE = 500


class ValkeyEntry(NamedTuple):
    """One value to store and how long it lives"""

    key: str
    value: bytes
    ttl: timedelta


class ValkeyStore:
    """Reads and writes keys in ValKey, treating any failure as an empty cache"""

    def __init__(self, client: Valkey, namespace: str = DEFAULT_NAMESPACE) -> None:
        """Wrap a client

        Args:
            client: Client over a pool that returns bytes
            namespace: Prefix added to every key
        """
        self.client = client
        self.namespace = namespace
        self._skip_until = 0.0

    @classmethod
    def from_url(cls, url: str, namespace: str = DEFAULT_NAMESPACE) -> Self:
        """Build a store whose pool connects when first used

        Args:
            url: ValKey address, already checked by the configuration
            namespace: Prefix added to every key

        Returns:
            A store over a new pool, which the caller closes
        """
        pool = BlockingConnectionPool.from_url(
            url,
            max_connections=MAX_CONNECTIONS,
            timeout=OPERATION_TIMEOUT_SECONDS,
            socket_connect_timeout=OPERATION_TIMEOUT_SECONDS,
            socket_timeout=OPERATION_TIMEOUT_SECONDS,
        )
        return cls(Valkey(connection_pool=pool), namespace)

    async def get_many(self, keys: Sequence[str]) -> dict[str, bytes]:
        """Return the values stored under the keys

        Args:
            keys: Keys to read, without the namespace

        Returns:
            The stored values by key, leaving out keys with none. Empty when ValKey fails, even
            if some chunks were read, so a partial answer is never mixed with a miss
        """
        if not keys or self._is_cooling_down():
            return {}

        found: dict[str, bytes] = {}
        try:
            for chunk in batched(keys, CHUNK_SIZE, strict=False):
                values = await self.client.mget([self.namespace + key for key in chunk])
                found.update({key: value for key, value in zip(chunk, values, strict=True) if value is not None})
        # Best effort: the caller can always do without a cached value. Every exception counts, since
        # beside its own errors the client passes through whatever the socket, TLS or its reply parser
        # raise, and none of them may turn a cache miss into a failed request
        except Exception as error:
            self._start_cooldown(error)
            return {}
        return found

    async def set_many(self, entries: Iterable[ValkeyEntry], *, keep_existing: bool = False) -> None:
        """Store values, each with its own lifetime

        A failure is logged and skipped, and stops the remaining chunks

        Args:
            entries: Values to store, with keys that lack the namespace
            keep_existing: Leave a key that already holds a value as it is, instead of replacing it
        """
        if self._is_cooling_down():
            return

        try:
            for chunk in batched(entries, CHUNK_SIZE, strict=False):
                async with self.client.pipeline(transaction=False) as pipeline:
                    for entry in chunk:
                        pipeline.set(self.namespace + entry.key, entry.value, px=entry.ttl // timedelta(milliseconds=1), nx=keep_existing)
                    await pipeline.execute()
        # Best effort, for the same reason as a read: the caller already has the values, so storing
        # them can wait for another request
        except Exception as error:
            self._start_cooldown(error)

    async def aclose(self) -> None:
        """Close the client and its pool"""
        await self.client.aclose(close_connection_pool=True)

    def _is_cooling_down(self) -> bool:
        """Whether a recent failure still has ValKey skipped"""
        return monotonic() < self._skip_until

    def _start_cooldown(self, error: BaseException) -> None:
        """Skip ValKey for a while and log why, without the address, which can hold a password"""
        self._skip_until = monotonic() + FAILURE_COOLDOWN_SECONDS
        logger.warning("ValKey failed with %s, so it is skipped for %d seconds", type(error).__name__, FAILURE_COOLDOWN_SECONDS)


# The store requests use, or None when the server runs without a cache
_published_store: ValkeyStore | None = None


def get_valkey() -> ValkeyStore | None:
    """Return the store to use, or None when ValKey is not configured or not open"""
    return _published_store


def _build_configured_store() -> ValkeyStore | None:
    """Return a store for the configured address, or None when there is none or it cannot be built"""
    if VALKEY_URL is None:
        logger.info("ValKey is not configured, so the server runs without it")
        return None

    # The cache is optional, and the client raises more than its own errors while reading an address,
    # a ValueError among them, so nothing it raises here may stop the server from starting
    try:
        store = ValkeyStore.from_url(VALKEY_URL)
    except Exception as error:
        logger.warning("ValKey could not be set up (%s), so the server runs without it", type(error).__name__)
        return None

    logger.info("ValKey is configured and connects when first used")
    return store


@asynccontextmanager
async def use_valkey(store: ValkeyStore | None = None) -> AsyncIterator[ValkeyStore | None]:
    """Make a store the one get_valkey returns while the block runs

    Without an argument the store comes from the configured address, and is closed when the block
    ends. A store passed in belongs to the caller, who closes it, as a test does because its client
    does not run the app's lifespan

    Args:
        store: A store to publish, or None to open the configured one

    Yields:
        The published store, or None when the server runs without one
    """
    global _published_store

    owned = store is None
    published = _build_configured_store() if owned else store
    previous = _published_store
    _published_store = published
    try:
        yield published
    finally:
        _published_store = previous
        if owned and published is not None:
            await published.aclose()
