"""Bank sync settings"""

import os

import httpx

from app.config.env import optional_csv_env

# SimpleFIN Bridge's two servers, always allowed. A self-hosted operator adds their own SimpleFIN
# servers beside them, so connections already made through the Bridge keep working
_SIMPLEFIN_BRIDGE_ORIGINS = ["https://beta-bridge.simplefin.org", "https://bridge.simplefin.org"]


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


# Origins SimpleFIN requests may reach, always over HTTPS and only at public addresses
BANK_SYNC_SIMPLEFIN_ORIGINS = read_simplefin_origins()

# Testing only: one origin exempt from the HTTPS and public address checks, so development
# instances and browser tests can reach a fake SimpleFIN Bridge on a private network. Unset by
# default and kept out of the self-hosting docs, and the app warns at start while it is set
BANK_SYNC_SIMPLEFIN_TEST_ORIGIN = read_simplefin_test_origin()
