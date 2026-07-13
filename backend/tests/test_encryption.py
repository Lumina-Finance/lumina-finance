"""Application encryption helper tests"""

import pytest

from app import encryption
from app.encryption import decrypt, encrypt, generate_encryption_key, resolve_encryption_key


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


def test_resolve_raises_when_configured_and_persisted_keys_conflict(tmp_path, monkeypatch):
    """A configured key that differs from the persisted key aborts instead of silently winning"""
    key_file = tmp_path / "app_encryption_key"
    key_file.write_text(generate_encryption_key())
    monkeypatch.setattr(encryption, "_KEY_FILE", key_file)
    monkeypatch.setenv("APP_ENCRYPTION_KEY", generate_encryption_key())

    with pytest.raises(RuntimeError, match="does not match"):
        resolve_encryption_key(generate=False)


def test_resolve_returns_the_key_when_configured_and_persisted_keys_match(tmp_path, monkeypatch):
    """Supplying the same key through both sources is not a conflict"""
    key = generate_encryption_key()
    key_file = tmp_path / "app_encryption_key"
    key_file.write_text(key)
    monkeypatch.setattr(encryption, "_KEY_FILE", key_file)
    monkeypatch.setenv("APP_ENCRYPTION_KEY", key)

    assert resolve_encryption_key(generate=False) == key


def test_resolve_returns_the_persisted_key_without_a_configured_key(tmp_path, monkeypatch):
    """The persisted key resolves on its own when the environment variable is absent"""
    key = generate_encryption_key()
    key_file = tmp_path / "app_encryption_key"
    key_file.write_text(key)
    monkeypatch.setattr(encryption, "_KEY_FILE", key_file)
    monkeypatch.delenv("APP_ENCRYPTION_KEY", raising=False)

    assert resolve_encryption_key(generate=False) == key
