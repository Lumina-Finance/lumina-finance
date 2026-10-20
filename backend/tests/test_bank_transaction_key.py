"""Bank transaction hash key resolution tests"""

import stat

import pytest

from app import bank_transaction_key
from app.bank_transaction_key import generate_key, resolve_key
from app.config import imports as import_config

_MALFORMED_KEYS = {
    "too short": generate_key()[:63],
    "upper case": generate_key().upper(),
    "not hex": "g" * 64,
}


@pytest.fixture
def key_file(tmp_path, monkeypatch):
    """Point the key file and its directory at a temporary path, since the real one is /data/secrets"""
    monkeypatch.setattr(bank_transaction_key, "_SECRETS_DIR", tmp_path)
    monkeypatch.setattr(bank_transaction_key, "KEY_FILE", tmp_path / "bank_transaction_hash_key")
    return bank_transaction_key.KEY_FILE


def _configure(monkeypatch, key):
    """Set the key as the environment would, or leave it unset for None"""
    monkeypatch.setattr(import_config, "BANK_TRANSACTION_HASH_KEY", key)


def test_a_server_with_no_key_refuses_to_start_naming_the_variable(key_file, monkeypatch):
    """Without a key no OFX import can be staged, so the start must fail and say what to set"""
    _configure(monkeypatch, None)

    with pytest.raises(RuntimeError, match="Missing BANK_TRANSACTION_HASH_KEY"):
        resolve_key(generate=False)


def test_a_configured_key_differing_from_the_persisted_one_is_refused(key_file, monkeypatch):
    """Only one of them made the saved hashes, and picking the other would quietly import duplicates"""
    key_file.write_text(generate_key())
    _configure(monkeypatch, generate_key())

    with pytest.raises(RuntimeError, match="does not match the key persisted"):
        resolve_key(generate=False)


def test_a_configured_key_matching_the_persisted_one_resolves(key_file, monkeypatch):
    """An operator who copies the generated key into the environment must still start"""
    key = generate_key()
    key_file.write_text(f"{key}\n")
    _configure(monkeypatch, key)

    assert resolve_key(generate=False) == bytes.fromhex(key)


@pytest.mark.parametrize("source", ["environment", "file"])
@pytest.mark.parametrize("malformed", _MALFORMED_KEYS.values(), ids=_MALFORMED_KEYS.keys())
def test_a_malformed_key_is_refused_saying_what_a_key_is(key_file, monkeypatch, source, malformed):
    """A key HMAC would take as some other bytes makes hashes nothing else can reproduce"""
    _configure(monkeypatch, malformed if source == "environment" else None)
    if source == "file":
        key_file.write_text(malformed)

    with pytest.raises(RuntimeError, match="must be 64 lower-case hex characters"):
        resolve_key(generate=False)


def test_a_generated_key_is_kept_owner_only_and_not_replaced(key_file, monkeypatch):
    """Anyone who can read the key can reverse the hashes, and a restart must not replace it"""
    _configure(monkeypatch, None)

    generated = resolve_key(generate=True)

    assert stat.S_IMODE(key_file.stat().st_mode) == 0o600
    assert key_file.read_text() == generated.hex()
    assert resolve_key(generate=True) == generated
