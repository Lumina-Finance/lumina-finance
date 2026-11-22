"""Tells the browsers an address has signed in from apart from everyone else, for the sign-in lockout

A stranger guessing an address's password must not lock its owner out of their own browser, so a
failure counts in a bucket that depends on who sent it. A browser that has completed a sign-in to the
address carries a cookie proving it, and counts apart from every other sender. The cookie holds a
random browser id and, for each address signed in from that browser, a MAC that only the server can
make. Checking a cookie is an HMAC comparison with no account lookup, so an address nobody registered
answers and takes the same time as a registered one

The cookie carries a MAC per address because one browser is often shared, such as a household's: each
person's address stays known, and no address can be read from the cookie
"""

import functools
import hashlib
import hmac
import re
import secrets
import uuid

from app.services.auth.login_email_hash import derive_lockout_subkey, seal_login_email

# Counts failures from every sender without a known browser for the address, such as a stranger, a
# native app or a browser that was never signed in. The migration that introduced buckets inlines this
# value for the rows that existed before them
SHARED_BUCKET = ""

# Separates the known-browser MACs and bucket hashes from every other use of the lockout key
KNOWN_BROWSER_KEY_LABEL = b"known-browser"

# A shared browser keeps this many addresses known, the newest first, and a signed-in address beyond
# that forgets the oldest. The cap keeps the cookie small and the comparison cost fixed
MAX_ADDRESSES = 5

_BROWSER_ID_BYTES = 16

# A cookie that does not look exactly like one this module made is treated as absent, so a crafted
# value costs nothing more than a missing one. token_urlsafe makes 4 characters per 3 bytes, unpadded
_BROWSER_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{22}")
_MAC_PATTERN = re.compile(r"[0-9a-f]{64}")
_MAX_VALUE_LENGTH = 22 + MAX_ADDRESSES * (1 + 64)


@functools.cache
def _known_browser_key() -> bytes:
    """Return the key behind the cookie's MACs and the bucket hashes, resolved once per process"""
    return derive_lockout_subkey(KNOWN_BROWSER_KEY_LABEL)


def _mac(message: str) -> str:
    """Return the hex HMAC of a message under the known-browser key"""
    return hmac.new(_known_browser_key(), message.encode(), hashlib.sha256).hexdigest()


def _parse(value: str | None) -> tuple[str, list[str]] | None:
    """Return the browser id and MACs of a well-formed cookie value, or None for anything else"""
    if not value or len(value) > _MAX_VALUE_LENGTH:
        return None
    browser_id, *macs = value.split(".")
    if not _BROWSER_ID_PATTERN.fullmatch(browser_id) or not 1 <= len(macs) <= MAX_ADDRESSES:
        return None
    if not all(_MAC_PATTERN.fullmatch(mac) for mac in macs):
        return None
    return browser_id, macs


def _address_mac(browser_id: str, email: str) -> str:
    """Return the MAC that vouches for a browser having signed in to an address"""
    return _mac(f"address:{seal_login_email(email)}:{browser_id}")


def sign_in_bucket(cookie_value: str | None, email: str) -> str:
    """Return the bucket a sign-in attempt for an address counts in

    Args:
        cookie_value: The known-browser cookie the request carried, if any
        email: Address the sign-in names, registered or not

    Returns:
        The browser's bucket when the cookie vouches for this address, otherwise the shared bucket. A
        malformed, oversized or forged value, or one with no MAC for this address, is the same as no cookie
    """
    parsed = _parse(cookie_value)
    if parsed is None:
        return SHARED_BUCKET
    browser_id, macs = parsed

    # Every MAC is compared whatever the outcome, so the time taken shows nothing of which one matched
    expected = _address_mac(browser_id, email)
    is_known = False
    for mac in macs:
        is_known |= hmac.compare_digest(mac, expected)
    return _mac(f"browser:{browser_id}") if is_known else SHARED_BUCKET


def session_bucket(session_id: uuid.UUID) -> str:
    """Return the bucket a step-up attempt counts in, one per session

    Args:
        session_id: The session making the request

    Returns:
        A keyed hash of the session id, so the records hold nothing a stolen copy could be matched to
    """
    return _mac(f"session:{session_id}")


def remember_address(cookie_value: str | None, email: str) -> str:
    """Return the cookie value that also vouches for this address, keeping every address already there

    A well-formed incoming value keeps its browser id, so a later sign-in adds to the browser's known
    addresses instead of replacing them. Anything else starts a new browser

    Args:
        cookie_value: The known-browser cookie the request carried, if any
        email: Address that has just completed a sign-in

    Returns:
        The new cookie value, this address first and at most MAX_ADDRESSES addresses in all
    """
    parsed = _parse(cookie_value)
    browser_id, macs = parsed if parsed is not None else (secrets.token_urlsafe(_BROWSER_ID_BYTES), [])
    mac = _address_mac(browser_id, email)
    older = [known for known in macs if not hmac.compare_digest(known, mac)]
    return ".".join([browser_id, mac, *older[: MAX_ADDRESSES - 1]])
