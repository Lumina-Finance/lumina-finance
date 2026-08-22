"""Application encryption helper tests"""

import pytest

from app import encryption
from app.encryption import decrypt, encrypt, generate_encryption_key, key_fingerprint, resolve_encryption_key


@pytest.fixture
def key_file(tmp_path, monkeypatch):
    """Point the key file and its directory at a temporary path

    Both are patched, since generating a key creates the directory and the real one is
    /data/secrets, which the test host neither has nor should gain
    """
    monkeypatch.setattr(encryption, "_SECRETS_DIR", tmp_path)
    monkeypatch.setattr(encryption, "KEY_FILE", tmp_path / "app_encryption_key")
    return encryption.KEY_FILE


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


def test_key_fingerprint_identifies_a_key_without_disclosing_it():
    """The digest is stable for one key, differs between keys, and is not the key"""
    key = generate_encryption_key()
    other_key = generate_encryption_key()

    assert key_fingerprint(key) == key_fingerprint(key)
    assert key_fingerprint(key) != key_fingerprint(other_key)
    assert key not in key_fingerprint(key)


def test_resolve_raises_when_configured_and_persisted_keys_conflict(key_file, monkeypatch):
    """A configured key that differs from the persisted key aborts instead of silently winning"""
    key_file.write_text(generate_encryption_key())
    monkeypatch.setenv("APP_ENCRYPTION_KEY", generate_encryption_key())

    with pytest.raises(RuntimeError, match="does not match"):
        resolve_encryption_key(generate=False)


def test_conflict_message_does_not_advise_removing_either_key(key_file, monkeypatch):
    """Removing the live key of the two loses the stored secrets, so it is never the advice"""
    key_file.write_text(generate_encryption_key())
    monkeypatch.setenv("APP_ENCRYPTION_KEY", generate_encryption_key())

    with pytest.raises(RuntimeError) as raised:
        resolve_encryption_key(generate=False)

    assert "Remove" not in str(raised.value)


def test_resolve_returns_the_key_when_configured_and_persisted_keys_match(key_file, monkeypatch):
    """Supplying the same key through both sources is not a conflict"""
    key = generate_encryption_key()
    key_file.write_text(key)
    monkeypatch.setenv("APP_ENCRYPTION_KEY", key)

    assert resolve_encryption_key(generate=False) == key


def test_resolve_strips_whitespace_around_a_configured_key(key_file, monkeypatch):
    """An env file or a mounted secret adds a trailing newline, which must not change the key

    The newline decodes to the same 32 bytes, so every stored secret still reads, but the
    key would compare unequal to itself and fail the fingerprint check
    """
    key = generate_encryption_key()
    monkeypatch.setenv("APP_ENCRYPTION_KEY", f"{key}\n")

    assert resolve_encryption_key(generate=False) == key


def test_a_configured_key_with_whitespace_is_not_a_conflict(key_file, monkeypatch):
    """The same key through both sources stays one key when one copy carries a newline"""
    key = generate_encryption_key()
    key_file.write_text(key)
    monkeypatch.setenv("APP_ENCRYPTION_KEY", f"  {key}\n")

    assert resolve_encryption_key(generate=False) == key


def test_resolve_returns_the_persisted_key_without_a_configured_key(key_file, monkeypatch):
    """The persisted key resolves on its own when the environment variable is absent"""
    key = generate_encryption_key()
    key_file.write_text(key)
    monkeypatch.delenv("APP_ENCRYPTION_KEY", raising=False)

    assert resolve_encryption_key(generate=False) == key
