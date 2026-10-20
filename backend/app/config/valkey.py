"""ValKey cache connection settings"""

import os
from urllib.parse import urlsplit

# The schemes the client's URL parser accepts. redis and rediss are its names for the same
# protocol, so an operator moving from another cache can keep the address they already have
_NETWORK_SCHEMES = ("valkey", "valkeys", "redis", "rediss")
_SOCKET_SCHEME = "unix"

_HIGHEST_PORT = 65535


def _is_valid_valkey_url(url: str) -> bool:
    """Return whether a URL names a ValKey server the client can connect to

    A query string is refused because the client would let it override the timeouts the store
    sets, and a fragment because the client ignores it, so neither does what the operator meant

    Args:
        url: The stripped, non-blank setting

    Returns:
        Whether the scheme, address, port, database number and shape are all acceptable
    """
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return False

    if parts.query or parts.fragment:
        return False
    if parts.scheme == _SOCKET_SCHEME:
        return bool(parts.path)
    if parts.scheme not in _NETWORK_SCHEMES or not parts.hostname:
        return False
    if port is not None and not 1 <= port <= _HIGHEST_PORT:
        return False

    # The path, when present, is the database number
    database = parts.path.removeprefix("/")
    return database == "" or database.isdecimal()


def _read_valkey_url() -> str | None:
    """Return the configured ValKey address, or None when the cache is off

    Raises:
        RuntimeError: The value is set but not a usable address. The message leaves the value
            out, since a URL can carry the server's password
    """
    value = os.getenv("VALKEY_URL", "").strip()
    if not value:
        return None
    if not _is_valid_valkey_url(value):
        raise RuntimeError(
            "Invalid VALKEY_URL. Use valkey://host:port, valkeys://host:port for TLS or unix:///path, "
            "or leave it blank to run without the cache"
        )
    return value


# None runs the server without a cache, asking the exchange rate provider on every read
VALKEY_URL = _read_valkey_url()
