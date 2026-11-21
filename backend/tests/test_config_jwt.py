"""Token signing keys: each is read once, a bad one stops start-up naming it, and no data folder is needed

Settings are read at import, so the cases that need a whole start-up run in a clean interpreter
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa

from app.config.jwt import load_signing_key
from app.db.credentials import resolve_role_password
from tests.conftest import WORKER_DB_NAME

_BACKEND_DIR = Path(__file__).resolve().parents[1]

_ACCESS_VARIABLE = "JWT_ACCESS_PRIVATE_KEY_PATH"
_REFRESH_VARIABLE = "JWT_REFRESH_PRIVATE_KEY_PATH"


def _pem(private_key, password: bytes | None = None) -> bytes:
    """Return the key as an unencrypted PEM, or encrypted under the password"""
    encryption = serialization.BestAvailableEncryption(password) if password else serialization.NoEncryption()
    return private_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, encryption)


def _rsa_pem() -> bytes:
    """Return a new RSA key, small since the tests only need it to parse"""
    return _pem(rsa.generate_private_key(public_exponent=65537, key_size=2048))


# Text the refusals must never repeat, planted in a file that looks like a key
_FILE_MARKER = "MARKER-FROM-THE-FILE"

# The wording each kind of refusal carries
_NOT_PEM = "is not an unencrypted PEM private key"
_NOT_RSA = "is not an RSA private key"

# Each file a key path can point at that the app must refuse, built when its case runs, with how the refusal begins
_REFUSED_FILES = {
    "empty": (lambda: b"", _NOT_PEM),
    "not a key": (lambda: b"not a key\n", _NOT_PEM),
    "a key-shaped file": (lambda: f"-----BEGIN PRIVATE KEY-----\n{_FILE_MARKER}\n-----END PRIVATE KEY-----\n".encode(), _NOT_PEM),
    "an encrypted key": (lambda: _pem(rsa.generate_private_key(public_exponent=65537, key_size=2048), b"secret"), _NOT_PEM),
    "an elliptic curve key": (lambda: _pem(ec.generate_private_key(ec.SECP256R1())), _NOT_RSA),
}


def test_a_valid_key_is_read_from_the_path_the_setting_names(tmp_path, monkeypatch):
    """The path setting wins over the default, and the key is parsed"""
    key_file = tmp_path / "access.pem"
    key_file.write_bytes(_rsa_pem())
    monkeypatch.setenv(_ACCESS_VARIABLE, str(key_file))

    key = load_signing_key("access", _ACCESS_VARIABLE, tmp_path / "unused.pem")

    assert key.key_size == 2048


def test_a_missing_key_file_is_refused_naming_the_key_and_its_setting(tmp_path, monkeypatch):
    """An environment that never filled the path must be told which key and which setting"""
    monkeypatch.setenv(_REFRESH_VARIABLE, str(tmp_path / "absent.pem"))

    with pytest.raises(RuntimeError) as refused:
        load_signing_key("refresh", _REFRESH_VARIABLE, tmp_path / "unused.pem")

    assert "refresh token signing key was not found" in str(refused.value)
    assert _REFRESH_VARIABLE in str(refused.value)


def test_an_unset_setting_falls_back_to_the_default_path(tmp_path, monkeypatch):
    """The packaged image keeps its keys at the default location, with no setting"""
    default_path = tmp_path / "access_private.pem"
    default_path.write_bytes(_rsa_pem())
    monkeypatch.delenv(_ACCESS_VARIABLE, raising=False)

    assert load_signing_key("access", _ACCESS_VARIABLE, default_path).key_size == 2048


def test_a_blank_setting_falls_back_to_the_default_path(tmp_path, monkeypatch):
    """A Compose file that passes the variable on empty must not point the app at the current folder"""
    default_path = tmp_path / "access_private.pem"
    default_path.write_bytes(_rsa_pem())
    monkeypatch.setenv(_ACCESS_VARIABLE, "")

    assert load_signing_key("access", _ACCESS_VARIABLE, default_path).key_size == 2048


def test_a_path_that_cannot_be_read_is_refused_naming_the_key_and_its_setting(tmp_path, monkeypatch):
    """A folder where the file should be, or a file nobody may read, still names the key"""
    monkeypatch.setenv(_ACCESS_VARIABLE, str(tmp_path))

    with pytest.raises(RuntimeError, match=r"access token signing key at .* could not be read") as refused:
        load_signing_key("access", _ACCESS_VARIABLE, tmp_path / "unused.pem")

    assert _ACCESS_VARIABLE in str(refused.value)


@pytest.mark.parametrize(("build", "wording"), _REFUSED_FILES.values(), ids=_REFUSED_FILES.keys())
def test_a_file_that_is_not_an_unencrypted_rsa_key_is_refused_naming_the_key(tmp_path, monkeypatch, build, wording):
    """Signing needs a plain RSA key, and the refusal repeats nothing of what the file held

    The library's own error is dropped as well, so a start-up traceback never shows part of the file
    """
    key_file = tmp_path / "access.pem"
    key_file.write_bytes(build())
    monkeypatch.setenv(_ACCESS_VARIABLE, str(key_file))

    with pytest.raises(RuntimeError) as refused:
        load_signing_key("access", _ACCESS_VARIABLE, tmp_path / "unused.pem")

    assert f"The access token signing key at {key_file} {wording}" in str(refused.value)
    assert _ACCESS_VARIABLE in str(refused.value)
    assert _FILE_MARKER not in str(refused.value)
    assert refused.value.__cause__ is None
    assert refused.value.__context__ is None or refused.value.__suppress_context__


def test_a_key_type_the_library_cannot_load_is_refused_naming_the_key(tmp_path, monkeypatch):
    """The library refuses a key type its OpenSSL lacks with its own error type, which must not escape unnamed"""

    def refuse(*_args, **_kwargs):
        raise UnsupportedAlgorithm("unsupported key type")

    key_file = tmp_path / "access.pem"
    key_file.write_bytes(_rsa_pem())
    monkeypatch.setenv(_ACCESS_VARIABLE, str(key_file))
    monkeypatch.setattr("app.config.jwt.load_pem_private_key", refuse)

    with pytest.raises(RuntimeError, match=r"access token signing key at .* is not an unencrypted PEM private key"):
        load_signing_key("access", _ACCESS_VARIABLE, tmp_path / "unused.pem")


def _run(script: str, settings: dict[str, str]) -> subprocess.CompletedProcess[str]:
    """Run the script in a clean interpreter with the settings on top of the test environment"""
    return subprocess.run(  # noqa: S603
        [sys.executable, "-c", script],
        cwd=_BACKEND_DIR,
        env={**os.environ, **settings},
        check=False,
        capture_output=True,
        text=True,
    )


@pytest.mark.parametrize(
    ("broken", "intact", "name"), [(_ACCESS_VARIABLE, _REFRESH_VARIABLE, "access"), (_REFRESH_VARIABLE, _ACCESS_VARIABLE, "refresh")]
)
def test_start_up_stops_naming_whichever_key_is_bad(tmp_path, broken, intact, name):
    """A good key never hides the bad one, and each key is reported as its own"""
    good = tmp_path / "good.pem"
    good.write_bytes(_rsa_pem())

    completed = _run("import app.config.jwt", {broken: str(tmp_path / "absent.pem"), intact: str(good)})

    assert completed.returncode != 0
    assert f"The {name} token signing key was not found" in completed.stderr


# Counts the private keys parsed while the whole app loads, runs the app's own start-up, its database checks
# included, asks the running app for its health and its public keys, then reads the other secrets.
# Absence of the data folder is simulated so the answer does not depend on the machine
_START_SCRIPT = """
import json
import pathlib

original_exists = pathlib.Path.exists
pathlib.Path.exists = lambda self, **kwargs: False if str(self).startswith("/data") else original_exists(self, **kwargs)

from cryptography.hazmat.primitives import serialization

parsed = []
original_load = serialization.load_pem_private_key
serialization.load_pem_private_key = lambda *args, **kwargs: parsed.append(1) or original_load(*args, **kwargs)

from fastapi.testclient import TestClient
from app.bank_transaction_key import resolve_key
from app.encryption import resolve_encryption_key
from app.main import app

with TestClient(app) as client:
    health = client.get("/health").status_code
    public_keys = client.get("/auth/.well-known/jwks.json").status_code
print(json.dumps({
    "parsed": len(parsed),
    "encryption_key": resolve_encryption_key(generate=False),
    "hash_key": resolve_key(generate=False).hex(),
    "health": health,
    "public_keys": public_keys,
}))
"""


def test_the_app_starts_and_serves_with_every_secret_supplied_and_no_data_folder(tmp_path):
    """Keys at a path the environment filled and the other secrets as content are all a start-up needs

    The start-up runs against this worker's own test database as the app role. Each of the two private
    keys is parsed once, however many modules sign or verify with it
    """
    for name in ("access", "refresh"):
        (tmp_path / f"{name}.pem").write_bytes(_rsa_pem())
    encryption_key = Fernet.generate_key().decode()
    hash_key = "ab" * 32

    completed = _run(
        _START_SCRIPT,
        {
            _ACCESS_VARIABLE: str(tmp_path / "access.pem"),
            _REFRESH_VARIABLE: str(tmp_path / "refresh.pem"),
            "APP_ENCRYPTION_KEY": encryption_key,
            "BANK_TRANSACTION_HASH_KEY": hash_key,
            "APP_DB_PASSWORD": resolve_role_password("app", generate=False),
            "DB_NAME": WORKER_DB_NAME,
        },
    )

    assert completed.returncode == 0, completed.stderr
    started = json.loads(completed.stdout)
    assert started == {"parsed": 2, "encryption_key": encryption_key, "hash_key": hash_key, "health": 200, "public_keys": 200}
