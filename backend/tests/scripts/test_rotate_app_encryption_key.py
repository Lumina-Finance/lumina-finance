"""Encryption key rotation tests"""

import pytest
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import text

from app import encryption
from app.config.database import APP_DB_USER
from app.db.encryption_key import read_fingerprint, record_fingerprint
from app.encryption import generate_encryption_key, key_fingerprint
from scripts.rotate_app_encryption_key import RotationError, rotate_encryption_key
from tests.conftest import ScopedSession, engine

_TOTP_SECRET = "JBSWY3DPEHPK3PXP"
_OIDC_SECRET = "oidc-secret-1"


@pytest.fixture
def key_file(tmp_path, monkeypatch):
    """Point the key file and its directory at a temporary path"""
    monkeypatch.setattr(encryption, "_SECRETS_DIR", tmp_path)
    monkeypatch.setattr(encryption, "KEY_FILE", tmp_path / "app_encryption_key")
    return encryption.KEY_FILE


@pytest.fixture
def current_key(key_file, monkeypatch):
    """Persist a key to the key file and clear the environment, returning that key

    The rotation resolves the key the app would, so the file standing alone is the default
    deployment: a key generated on first start with no environment variable set
    """
    key = generate_encryption_key()
    key_file.write_text(key)
    monkeypatch.delenv(encryption.KEY_ENV_VAR, raising=False)

    # The cached Fernet outlives a single test, so clear it whenever the key moves
    encryption._fernet.cache_clear()
    yield key
    encryption._fernet.cache_clear()


async def _store_secrets(key: str) -> None:
    """Write one TOTP secret and one OIDC client secret encrypted under a key"""
    fernet = Fernet(key.encode())
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "INSERT INTO currencies (id, name, symbol, minor_unit_exponent) "
                "VALUES ('CAD', 'Canadian Dollar', '$', 2) ON CONFLICT (id) DO NOTHING"
            )
        )
        user_id = await connection.scalar(
            text(
                "INSERT INTO users (id, email, first_name, tz, base_currency) "
                "VALUES (gen_random_uuid(), 'rotation@example.com', 'Rotation', 'America/Toronto', 'CAD') "
                "RETURNING id"
            )
        )
        await connection.execute(
            text("INSERT INTO totp_credentials (user_id, secret_encrypted) VALUES (:user_id, :secret)"),
            {"user_id": user_id, "secret": fernet.encrypt(_TOTP_SECRET.encode()).decode()},
        )
        await connection.execute(
            text(
                "INSERT INTO oidc_providers "
                "(id, slug, display_name, issuer, client_id, client_secret_encrypted, scopes, enabled) "
                "VALUES (gen_random_uuid(), 'generic', 'OIDC', 'https://issuer.example', "
                "'client-1', :secret, 'openid email', true)"
            ),
            {"secret": fernet.encrypt(_OIDC_SECRET.encode()).decode()},
        )


async def _read_stored(table: str, column: str) -> str:
    """Return the single stored token from a column"""
    async with engine.begin() as connection:
        return await connection.scalar(text(f"SELECT {column} FROM {table} LIMIT 1"))


async def test_rotation_re_encrypts_every_labelled_column(current_key):
    """Both stored secrets read under the new key afterwards and neither under the old one"""
    await _store_secrets(current_key)
    new_key = generate_encryption_key()

    rewritten = await rotate_encryption_key(engine, new_key)

    assert rewritten == {
        ("oidc_providers", "client_secret_encrypted"): 1,
        ("totp_credentials", "secret_encrypted"): 1,
    }
    for table, column, expected in (
        ("totp_credentials", "secret_encrypted", _TOTP_SECRET),
        ("oidc_providers", "client_secret_encrypted", _OIDC_SECRET),
    ):
        stored = await _read_stored(table, column)
        assert Fernet(new_key.encode()).decrypt(stored.encode()).decode() == expected
        with pytest.raises(InvalidToken):
            Fernet(current_key.encode()).decrypt(stored.encode())


async def test_rotation_moves_the_recorded_fingerprint(current_key):
    """The record follows the data, so the app knows which key to expect afterwards"""
    await _store_secrets(current_key)
    new_key = generate_encryption_key()

    await rotate_encryption_key(engine, new_key)

    async with engine.begin() as connection:
        assert await read_fingerprint(connection) == key_fingerprint(new_key)


async def test_rotation_removes_the_stale_key_file(current_key, key_file):
    """The old key is cleared from the volume, leaving the environment as the only source"""
    await _store_secrets(current_key)

    await rotate_encryption_key(engine, generate_encryption_key())

    assert not key_file.exists()


async def test_rotation_refuses_a_key_equal_to_the_current_one(current_key):
    """Rotating onto the same key would report success while changing nothing"""
    await _store_secrets(current_key)

    with pytest.raises(RotationError, match="already in use"):
        await rotate_encryption_key(engine, current_key)


async def test_rotation_refuses_a_malformed_key(current_key):
    """A truncated or mistyped key fails before anything is written"""
    await _store_secrets(current_key)
    stored_before = await _read_stored("totp_credentials", "secret_encrypted")

    with pytest.raises(RotationError, match="not a valid Fernet key"):
        await rotate_encryption_key(engine, "not-a-key")

    assert await _read_stored("totp_credentials", "secret_encrypted") == stored_before


async def test_rotation_refuses_when_the_current_key_reads_nothing(key_file, monkeypatch):
    """A deployment whose resolved key is not the one the data is under fails up front"""
    data_key = generate_encryption_key()
    await _store_secrets(data_key)

    # Resolve a third key, which is neither the one the data is under nor the target
    key_file.write_text(generate_encryption_key())
    monkeypatch.delenv(encryption.KEY_ENV_VAR, raising=False)
    encryption._fernet.cache_clear()
    stored_before = await _read_stored("totp_credentials", "secret_encrypted")

    with pytest.raises(RotationError, match="does not decrypt the stored secrets"):
        await rotate_encryption_key(engine, generate_encryption_key())

    assert await _read_stored("totp_credentials", "secret_encrypted") == stored_before
    encryption._fernet.cache_clear()


async def test_rotation_refuses_while_the_app_role_is_connected(current_key):
    """A serving app would write secrets under the old key mid-rotation, so this refuses"""
    await _store_secrets(current_key)
    stored_before = await _read_stored("totp_credentials", "secret_encrypted")

    # An open session as the app role is what a running app looks like from the database
    async with ScopedSession() as app_session:
        await app_session.execute(text("SELECT 1"))

        with pytest.raises(RotationError, match=f"open as {APP_DB_USER}"):
            await rotate_encryption_key(engine, generate_encryption_key())

    assert await _read_stored("totp_credentials", "secret_encrypted") == stored_before


async def test_rotation_finishes_an_interrupted_run(current_key, key_file):
    """Re-running after a crash between the commit and the file removal clears the file

    The data and the record are already under the new key, so there is nothing to rewrite
    and the stale key file is all that is left of the interrupted run
    """
    new_key = generate_encryption_key()
    await _store_secrets(new_key)
    async with engine.begin() as connection:
        await record_fingerprint(connection, new_key)
    stored_before = await _read_stored("totp_credentials", "secret_encrypted")

    rewritten = await rotate_encryption_key(engine, new_key)

    assert rewritten == {}
    assert not key_file.exists()
    assert await _read_stored("totp_credentials", "secret_encrypted") == stored_before


async def test_rotation_rewrites_nothing_on_an_empty_database(current_key):
    """A deployment with no secrets yet rotates to a zero count rather than failing"""
    rewritten = await rotate_encryption_key(engine, generate_encryption_key())

    assert rewritten == {
        ("oidc_providers", "client_secret_encrypted"): 0,
        ("totp_credentials", "secret_encrypted"): 0,
    }
