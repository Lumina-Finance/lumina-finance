"""Bank transaction hash key resolution tests"""

import pytest

from app import bank_transaction_key
from app.bank_transaction_key import KEY_ENV_VAR, generate_key, resolve_key


@pytest.fixture
def key_file(tmp_path, monkeypatch):
    """Point the key file and its directory at a temporary path, since the real one is /data/secrets"""
    monkeypatch.setattr(bank_transaction_key, "_SECRETS_DIR", tmp_path)
    monkeypatch.setattr(bank_transaction_key, "KEY_FILE", tmp_path / "bank_transaction_hash_key")
    return bank_transaction_key.KEY_FILE


def test_a_server_with_no_key_refuses_to_start_naming_the_variable(key_file, monkeypatch):
    """Without a key no OFX import can be staged, so the start must fail and say what to set"""
    monkeypatch.delenv(KEY_ENV_VAR, raising=False)

    with pytest.raises(RuntimeError, match=f"Missing {KEY_ENV_VAR}"):
        resolve_key(generate=False)


def test_a_configured_key_differing_from_the_persisted_one_is_refused(key_file, monkeypatch):
    """Only one of them made the saved hashes, and picking the other would quietly import duplicates"""
    key_file.write_text(generate_key())
    monkeypatch.setenv(KEY_ENV_VAR, generate_key())

    with pytest.raises(RuntimeError, match="does not match the key persisted"):
        resolve_key(generate=False)


def test_ensuring_a_key_keeps_the_one_persisted(key_file, monkeypatch):
    """A container restart must not replace the key its saved hashes were made with"""
    monkeypatch.delenv(KEY_ENV_VAR, raising=False)

    generated = resolve_key(generate=True)

    assert resolve_key(generate=True) == generated
    assert key_file.read_text() == generated.hex()
