"""Web addresses a user may store for everyone's screens to load"""

from typing import Annotated

from pydantic import AfterValidator, Field

# The longest address browsers and servers reliably handle
MAX_WEB_ADDRESS_LENGTH = 2048

_HTTPS_PREFIX = "https://"


def _require_https(value: str) -> str:
    """Refuse an address a browser would load over anything but https

    Args:
        value: Address from the request

    Returns:
        The address unchanged

    Raises:
        ValueError: The address does not start with https://, in any capitals
    """
    if not value.lower().startswith(_HTTPS_PREFIX):
        msg = "Address must start with https://"
        raise ValueError(msg)
    return value


# Checked in this order, so an address too long is refused for its length before its scheme is read
HttpsAddress = Annotated[str, Field(min_length=1, max_length=MAX_WEB_ADDRESS_LENGTH), AfterValidator(_require_https)]
