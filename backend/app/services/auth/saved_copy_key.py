"""The key a browser encrypts its saved copy of a user's data with

The key is derived, never stored. Raising the user's key number makes every copy saved under
an earlier number unreadable
"""

import base64
import uuid

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.encryption import app_key_material

# Names this use of the app's encryption key, so no other derivation from it can return the same bytes.
# Saved copies must keep decrypting across deploys, so the label and the info layout never change
_KEY_LABEL = b"lumina saved copy key v1"

# The browser encrypts the saved copy with AES-256
_KEY_BYTES = 32


def derive_saved_copy_key(user_id: uuid.UUID, key_version: int) -> str:
    """Return a user's key for the saved browser copy

    Args:
        user_id: The user the copy belongs to
        key_version: The user's current key number

    Returns:
        The 32-byte key as unpadded base64url
    """
    info = b"|".join((_KEY_LABEL, user_id.bytes, str(key_version).encode()))
    key = HKDF(algorithm=hashes.SHA256(), length=_KEY_BYTES, salt=None, info=info).derive(app_key_material())
    return base64.urlsafe_b64encode(key).rstrip(b"=").decode()
