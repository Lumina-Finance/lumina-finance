"""Bank sync settings"""

import logging
import os

import httpx

from app.config.env import optional_bool_env, optional_csv_env

logger = logging.getLogger(__name__)

# SimpleFIN Bridge's two servers, always allowed. Servers set in the environment are added beside
# them, so connections already made through the Bridge keep working
_SIMPLEFIN_BRIDGE_ORIGINS = ["https://beta-bridge.simplefin.org", "https://bridge.simplefin.org"]

# Jobs the worker runs at once unless the environment sets another number, so one slow bank
# doesn't hold up every other connection's sync
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


def read_count_setting(key: str, default: int, *, maximum: int | None = None) -> int:
    """Return a setting that counts something, such as months, requests or jobs, which must be at least 1

    Args:
        key: Environment variable holding the count
        default: The count when the variable is unset or blank
        maximum: The most the count may be, or None for no limit

    Raises:
        RuntimeError: The value is not a whole number of at least 1, or is over the maximum
    """
    value = os.getenv(key, "").strip()
    if not value:
        return default
    if not value.isdecimal() or int(value) < 1 or (maximum is not None and int(value) > maximum):
        limits = "at least 1" if maximum is None else f"from 1 to {maximum}"
        raise RuntimeError(f"Invalid {key} {value!r}. It must be a whole number {limits}")
    return int(value)


def read_simplefin_origins() -> list[str]:
    """Return the origins SimpleFIN requests may reach: SimpleFIN Bridge's, then any the environment adds

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


def warn_if_test_origin_set() -> None:
    """Warn while the testing-only origin is set, which the app and the bank sync worker each do as they start"""
    if BANK_SYNC_SIMPLEFIN_TEST_ORIGIN:
        logger.warning(
            "BANK_SYNC_SIMPLEFIN_TEST_ORIGIN sends SimpleFIN requests only to %s, without HTTPS or the public address check, "
            "and refuses every other origin, SimpleFIN Bridge's included. It is for testing only",
            BANK_SYNC_SIMPLEFIN_TEST_ORIGIN,
        )


# Origins SimpleFIN requests may reach while no test origin is set, always over HTTPS and only at
# public addresses
BANK_SYNC_SIMPLEFIN_ORIGINS = read_simplefin_origins()

# Testing only: while set, the one origin SimpleFIN requests may reach, exempt from the HTTPS and
# public address checks, so development instances and browser tests reach a fake SimpleFIN Bridge on
# a private network and nothing else, not even a real connection restored from production. Unset by
# default and kept out of the environment variable docs, and the app and the bank sync worker each
# warn as they start while it is set
BANK_SYNC_SIMPLEFIN_TEST_ORIGIN = read_simplefin_test_origin()

# How many jobs the worker runs at once, each on a different connection
BANK_SYNC_WORKER_CONCURRENCY = read_count_setting("BANK_SYNC_WORKER_CONCURRENCY", _DEFAULT_WORKER_CONCURRENCY)

# Whether SimpleFIN is available at all. Every provider is enabled unless the environment turns it off
BANK_SYNC_SIMPLEFIN_ENABLED = optional_bool_env("BANK_SYNC_SIMPLEFIN_ENABLED", True)

# Whether new SimpleFIN connections may be made. Withdrawing the offer leaves existing connections
# syncing, linking, reconnecting and disconnecting as before
BANK_SYNC_SIMPLEFIN_OFFERED = optional_bool_env("BANK_SYNC_SIMPLEFIN_OFFERED", True)

# How many calendar months back a SimpleFIN import may start. A change applies only to start
# dates chosen afterwards
BANK_SYNC_SIMPLEFIN_HISTORY_MONTHS = read_count_setting("BANK_SYNC_SIMPLEFIN_HISTORY_MONTHS", 12)

# Requests each SimpleFIN connection may send in a rolling 24 hours, below the 24 a day SimpleFIN
# Bridge expects, so setup and retries never earn a warning that could get the token disabled. A higher value than
# the 24 is refused at start
BANK_SYNC_SIMPLEFIN_DAILY_REQUESTS = read_count_setting("BANK_SYNC_SIMPLEFIN_DAILY_REQUESTS", 20, maximum=24)
