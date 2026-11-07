"""Bank sync settings, and the readers each bank provider reads its own settings through"""

import os
from dataclasses import dataclass

import httpx

from app.config.env import optional_bool_env, optional_csv_env

# Jobs the worker runs at once unless the environment sets another number, so one slow bank
# doesn't hold up every other connection's sync
_DEFAULT_WORKER_CONCURRENCY = 2


@dataclass(frozen=True)
class ProviderSettings:
    """A bank provider's deployment switches"""

    # Whether the provider is available at all
    enabled: bool

    # Whether new connections may be made with it. Withdrawing the offer leaves existing
    # connections syncing, linking, reconnecting and disconnecting as before
    offered: bool


def provider_setting_key(provider_id: str, name: str) -> str:
    """Return the environment variable holding one of a provider's settings, such as BANK_SYNC_<ID>_ENABLED"""
    return f"BANK_SYNC_{provider_id.upper()}_{name}"


def read_provider_settings(provider_id: str) -> ProviderSettings:
    """Return a provider's switches, each on unless the environment turns it off

    Raises:
        RuntimeError: A switch is set to something other than true or false
    """
    return ProviderSettings(
        enabled=optional_bool_env(provider_setting_key(provider_id, "ENABLED"), True),
        offered=optional_bool_env(provider_setting_key(provider_id, "OFFERED"), True),
    )


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


def read_origin_list_setting(key: str) -> list[str]:
    """Return the HTTPS origins a comma-separated setting lists, empty when it is unset

    Raises:
        RuntimeError: An entry is not an HTTPS origin
    """
    return [_read_origin(key, origin, schemes=("https",)) for origin in optional_csv_env(key)]


def read_test_origin_setting(key: str) -> str | None:
    """Return a testing-only origin, or None when it is unset. The origin may use plain HTTP

    Raises:
        RuntimeError: The value is not an HTTP or HTTPS origin
    """
    value = os.getenv(key, "").strip()
    return _read_origin(key, value, schemes=("http", "https")) if value else None


def read_count_setting(key: str, default: int, *, maximum: int | None = None) -> int:
    """Return a setting that counts something, such as months, requests or jobs. It must be at least 1

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


# How many jobs the worker runs at once, each on a different connection
BANK_SYNC_WORKER_CONCURRENCY = read_count_setting("BANK_SYNC_WORKER_CONCURRENCY", _DEFAULT_WORKER_CONCURRENCY)
