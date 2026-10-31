"""The keyed hash that names an email in the sign-up email send log

Sign-up emails are counted per address whether or not an account has it, so the log holds addresses of
people who never registered. An address is personal data and guessable, so the server keeps only an
HMAC of it under a key held outside the database, which a copy of the database alone cannot search

The key derives from the server's bank transaction hash key, which every install already holds, so
there is no new setting. Changing that key only makes saved counts unmatched, which forgets a day's
sends at most
"""

import functools
import hashlib
import hmac

from app.bank_transaction_key import resolve_key
from app.services.auth.user_lookup import fold_email

# Separates this use of the server key from the bank transaction hashes made with the same secret
SIGNUP_EMAIL_KEY_LABEL = b"signup-email-send"


@functools.cache
def _signup_email_key() -> bytes:
    """Return the send log key derived from the server key, resolved once for the life of the process"""
    return hmac.new(resolve_key(generate=False), SIGNUP_EMAIL_KEY_LABEL, hashlib.sha256).digest()


def seal_signup_email(email: str) -> str:
    """Return what the server keeps to recognise an address in the sign-up email send log

    Args:
        email: The address as the sign-up request carries it, in any capitalisation, since mail to
            Victim@x.com and victim@x.com reaches one inbox and the cap must count them together

    Returns:
        HMAC-SHA256 of the folded address's UTF-8 bytes, as 64 lower-case hex characters
    """
    return hmac.new(_signup_email_key(), fold_email(email).encode(), hashlib.sha256).hexdigest()
