"""Bank transaction hash key resolution tests"""

import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

from app import bank_transaction_key
from app.bank_transaction_key import generate_key, resolve_key
from app.config import imports as import_config

_BACKEND_DIR = Path(__file__).resolve().parents[1]

_MALFORMED_KEYS = {
    "too short": "ab" * 31 + "a",
    "upper case": "AB" * 32,
    "not hex": "g" * 64,
}


@pytest.mark.parametrize(("value", "expected"), [("", None), ("  \n", None), (f"{'ab' * 32}\n", "ab" * 32)])
def test_the_key_setting_reads_blank_as_unset_and_drops_a_trailing_newline(value, expected):
    """An env file line left empty means no key, and a mounted secret ends in a newline that is not part of it"""
    script = "from app.config.imports import BANK_TRANSACTION_HASH_KEY as key; print(repr(key))"
    result = subprocess.run(  # noqa: S603
        [sys.executable, "-c", script],
        cwd=_BACKEND_DIR,
        env={**os.environ, "BANK_TRANSACTION_HASH_KEY": value},
        capture_output=True,
        text=True,
        check=True,
    )

    assert result.stdout.strip() == repr(expected)


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

    assert len(generated) == 32
    assert stat.S_IMODE(key_file.stat().st_mode) == 0o600
    assert key_file.read_text() == generated.hex()
    assert resolve_key(generate=True) == generated
