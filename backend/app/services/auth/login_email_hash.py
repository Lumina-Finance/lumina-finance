"""The keyed hash that names an email in the login lockout records

Failed sign-ins are counted per email whether or not an account exists, so the records hold addresses
of people who never registered. An address is personal data and guessable, so the server keeps only an
HMAC of it under a key held outside the database, which a copy of the database alone cannot search

The key derives from the server's bank transaction hash key, which every install already holds, so
there is no new setting. Changing that key only makes saved counters unmatched, which forgets
short-lived lockouts
"""

import functools
import hashlib
import hmac

from app.bank_transaction_key import resolve_key

# Separates this use of the server key from the bank transaction hashes made with the same secret.
# The migration that moved the counters here inlines this label and the construction below, so both
# must change together
LOCKOUT_KEY_LABEL = b"login-lockout"


@functools.cache
def _lockout_key() -> bytes:
    """Return the lockout key derived from the server key, resolved once for the life of the process"""
    return hmac.new(resolve_key(generate=False), LOCKOUT_KEY_LABEL, hashlib.sha256).digest()


def seal_login_email(email: str) -> str:
    """Return what the server keeps to recognise an email in the lockout records

    Args:
        email: The address exactly as the account lookup matches it

    Returns:
        HMAC-SHA256 of the address's UTF-8 bytes, as 64 lower-case hex characters
    """
    return hmac.new(_lockout_key(), email.encode(), hashlib.sha256).hexdigest()
