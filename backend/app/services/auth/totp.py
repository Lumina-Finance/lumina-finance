"""TOTP secret generation and code verification"""

import pyotp

# Authenticator apps assume these defaults and many ignore other values, so they are fixed
_TOTP_DIGITS = 6
_TOTP_PERIOD_SECONDS = 30
_TOTP_ISSUER = "Lumina Finance"

# Accept the adjacent 30-second step on each side to absorb typing lag and clock skew
_TOTP_VALID_WINDOW = 1


def generate_totp_secret() -> str:
    """Return a new base32 TOTP secret"""
    return pyotp.random_base32()


def build_totp_provisioning_uri(secret: str, account_name: str) -> str:
    """Return the otpauth URI an authenticator app encodes as a QR code

    Args:
        secret: Base32 TOTP secret
        account_name: Label shown in the authenticator app, the user's email

    Returns:
        otpauth provisioning URI
    """
    totp = pyotp.TOTP(secret, digits=_TOTP_DIGITS, interval=_TOTP_PERIOD_SECONDS)
    return totp.provisioning_uri(name=account_name, issuer_name=_TOTP_ISSUER)


def is_totp_code_valid(secret: str, code: str) -> bool:
    """Return whether a submitted code matches the secret within the accepted time window

    Args:
        secret: Base32 TOTP secret
        code: Submitted code from the authenticator app

    Returns:
        Whether the code is valid for the current or an adjacent time step
    """
    totp = pyotp.TOTP(secret, digits=_TOTP_DIGITS, interval=_TOTP_PERIOD_SECONDS)
    return totp.verify(code, valid_window=_TOTP_VALID_WINDOW)
