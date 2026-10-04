"""Bank sync settings"""

import os

import httpx

from app.config.env import optional_bool_env, optional_csv_env

# SimpleFIN Bridge's two servers, always allowed. A self-hosted operator adds their own SimpleFIN
# servers beside them, so connections already made through the Bridge keep working
_SIMPLEFIN_BRIDGE_ORIGINS = ["https://beta-bridge.simplefin.org", "https://bridge.simplefin.org"]

# Jobs the self-hosted worker runs at once unless the operator sets another number, so one slow
# bank doesn't hold up every other connection's sync
_DEFAULT_WORKER_CONCURRENCY = 2


def _read_origin(key: str, value: str, *, schemes: tuple[str, ...]) -> str:
    """Return a configured origin after refusing anything beyond a scheme, host and port

    Parsed with httpx, the same parser the requests go out through, so the check and the
    request can't read one value two ways

    Args:
        key: Environment variable the value came from, named in the refusal
        value: The configured origin
        schemes: Schemes the origin may use

    Returns:
        The origin as configured

    Raises:
        RuntimeError: The value is not an origin using one of the schemes
    """
    try:
        url = httpx.URL(value)
    except httpx.InvalidURL:
        url = None

    is_origin = (
        url is not None
        and url.scheme in schemes
        and bool(url.host)
        and not url.userinfo
        and url.path in ("", "/")
        and not url.query
        and not url.fragment
    )
    if not is_origin:
        raise RuntimeError(f"Invalid {key} entry {value!r}. Each must be {' or '.join(schemes)}://host, with an optional port")
    return value


def read_simplefin_origins() -> list[str]:
    """Return the origins SimpleFIN requests may reach: SimpleFIN Bridge's, then any the operator adds

    Raises:
        RuntimeError: An added entry is not an HTTPS origin
    """
    added = [
        _read_origin("BANK_SYNC_SIMPLEFIN_ORIGINS", origin, schemes=("https",)) for origin in optional_csv_env("BANK_SYNC_SIMPLEFIN_ORIGINS")
    ]
    return [*_SIMPLEFIN_BRIDGE_ORIGINS, *added]


def read_simplefin_test_origin() -> str | None:
    """Return the testing-only origin, or None when it is unset

    Raises:
        RuntimeError: The value is not an HTTP or HTTPS origin
    """
    value = os.getenv("BANK_SYNC_SIMPLEFIN_TEST_ORIGIN", "").strip()
    return _read_origin("BANK_SYNC_SIMPLEFIN_TEST_ORIGIN", value, schemes=("http", "https")) if value else None


def read_worker_concurrency() -> int:
    """Return how many jobs the self-hosted worker runs at once, 2 unless the operator sets it

    Raises:
        RuntimeError: The value is not a whole number of at least 1
    """
    value = os.getenv("BANK_SYNC_WORKER_CONCURRENCY", "").strip()
    if not value:
        return _DEFAULT_WORKER_CONCURRENCY
    if not value.isdecimal() or int(value) < 1:
        raise RuntimeError(f"Invalid BANK_SYNC_WORKER_CONCURRENCY {value!r}. It must be a whole number of at least 1")
    return int(value)


# Origins SimpleFIN requests may reach, always over HTTPS and only at public addresses
BANK_SYNC_SIMPLEFIN_ORIGINS = read_simplefin_origins()

# Testing only: one origin exempt from the HTTPS and public address checks, so development
# instances and browser tests can reach a fake SimpleFIN Bridge on a private network. Unset by
# default and kept out of the self-hosting docs, and the app warns at start while it is set
BANK_SYNC_SIMPLEFIN_TEST_ORIGIN = read_simplefin_test_origin()

# How many jobs the self-hosted worker runs at once, each on a different connection
BANK_SYNC_WORKER_CONCURRENCY = read_worker_concurrency()

# Whether SimpleFIN is available at all. Self-hosted deployments enable every provider by default
BANK_SYNC_SIMPLEFIN_ENABLED = optional_bool_env("BANK_SYNC_SIMPLEFIN_ENABLED", True)

# Whether new SimpleFIN connections may be made. Withdrawing the offer leaves existing connections
# syncing, linking, reconnecting and disconnecting as before
BANK_SYNC_SIMPLEFIN_OFFERED = optional_bool_env("BANK_SYNC_SIMPLEFIN_OFFERED", True)

# How many calendar months back a SimpleFIN import may start. A change applies only to start
# dates chosen afterwards
BANK_SYNC_SIMPLEFIN_HISTORY_MONTHS = int(os.getenv("BANK_SYNC_SIMPLEFIN_HISTORY_MONTHS", "12"))

# Requests each SimpleFIN connection may send in a rolling 24 hours, below the 24 a day SimpleFIN
# Bridge expects, so setup and retries never earn a warning that could get the token disabled
BANK_SYNC_SIMPLEFIN_DAILY_REQUESTS = int(os.getenv("BANK_SYNC_SIMPLEFIN_DAILY_REQUESTS", "20"))
