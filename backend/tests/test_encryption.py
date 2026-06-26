"""Application encryption helper tests"""

from app.encryption import decrypt, encrypt


def test_encrypt_round_trips_to_the_original_plaintext():
    """A secret survives encrypt then decrypt unchanged and is never stored in the clear"""
    secret = "JBSWY3DPEHPK3PXP"
    token = encrypt(secret)

    assert token != secret
    assert decrypt(token) == secret


def test_encrypt_is_non_deterministic():
    """Fernet adds a random nonce, so the same plaintext encrypts to different tokens"""
    secret = "JBSWY3DPEHPK3PXP"

    assert encrypt(secret) != encrypt(secret)
