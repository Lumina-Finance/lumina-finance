"""Bank sync settings"""

import os

import httpx

from app.config.env import optional_csv_env

# SimpleFIN Bridge's two servers. An operator who sets the list replaces these, so a hosted
# deployment can keep exactly these and a self-hosted one can add its own SimpleFIN servers
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


# Origins SimpleFIN requests may reach, always over HTTPS and only at public addresses
BANK_SYNC_SIMPLEFIN_ORIGINS = [
    _read_origin("BANK_SYNC_SIMPLEFIN_ORIGINS", origin, schemes=("https",))
    for origin in optional_csv_env("BANK_SYNC_SIMPLEFIN_ORIGINS") or _SIMPLEFIN_BRIDGE_ORIGINS
]

# Testing only: one origin exempt from the HTTPS and public address checks, so development
# instances and browser tests can reach a fake SimpleFIN Bridge on a private network. Unset by
# default and kept out of the self-hosting docs, and the app warns at start while it is set
_test_origin = os.getenv("BANK_SYNC_SIMPLEFIN_TEST_ORIGIN", "").strip()
BANK_SYNC_SIMPLEFIN_TEST_ORIGIN = (
    _read_origin("BANK_SYNC_SIMPLEFIN_TEST_ORIGIN", _test_origin, schemes=("http", "https")) if _test_origin else None
)
