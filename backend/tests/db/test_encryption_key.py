"""Encryption key provisioning and data binding tests"""

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import text

from app import encryption
from app.db.encryption_key import (
    ensure_key,
    read_fingerprint,
    read_stored_secret,
    record_fingerprint,
    verify_fingerprint,
    verify_key_matches_data,
)
from app.encryption import generate_encryption_key, key_fingerprint
from tests.conftest import engine

_TOTP_SECRET = "JBSWY3DPEHPK3PXP"


@pytest.fixture
def key_file(tmp_path, monkeypatch):
    """Point the key file and its directory at a temporary path"""
    monkeypatch.setattr(encryption, "_SECRETS_DIR", tmp_path)
    monkeypatch.setattr(encryption, "KEY_FILE", tmp_path / "app_encryption_key")
    return encryption.KEY_FILE


@pytest.fixture
def configured_key(key_file, monkeypatch):
    """Configure a key through the environment and return it"""
    key = generate_encryption_key()
    monkeypatch.setenv(encryption.KEY_ENV_VAR, key)
    return key


@pytest.fixture
async def built_schema():
    """Add and then remove the table whose presence marks an already-built schema

    Alembic creates this table outside the model metadata, so the suite's truncate
    fixture never clears it and leaving it behind would make every later test in this
    worker look like a deployment that has already been migrated
    """
    async with engine.begin() as connection:
        await connection.execute(text("CREATE TABLE IF NOT EXISTS alembic_version (version_num varchar(32))"))
    yield
    async with engine.begin() as connection:
        await connection.execute(text("DROP TABLE IF EXISTS alembic_version"))


async def _store_totp_secret(connection, key: str) -> None:
    """Write one TOTP credential encrypted under a given key"""
    # The suite truncates reference data between tests, so the user's currency is inserted here
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
        {"user_id": user_id, "secret": Fernet(key.encode()).encrypt(_TOTP_SECRET.encode()).decode()},
    )


async def test_read_stored_secret_returns_none_when_nothing_is_encrypted():
    """An empty database has no secret to check a key against"""
    async with engine.begin() as connection:
        assert await read_stored_secret(connection) is None


async def test_read_stored_secret_finds_a_token_in_any_encrypted_column():
    """A stored token is found through the column label rather than a hard-coded table"""
    key = generate_encryption_key()
    async with engine.begin() as connection:
        await _store_totp_secret(connection, key)

        stored = await read_stored_secret(connection)
        assert stored is not None
        assert Fernet(key.encode()).decrypt(stored.encode()).decode() == _TOTP_SECRET


async def test_ensure_key_generates_a_key_on_a_first_install(key_file, monkeypatch):
    """With no schema and no key anywhere, provisioning mints and persists one"""
    monkeypatch.delenv(encryption.KEY_ENV_VAR, raising=False)

    async with engine.begin() as connection:
        await ensure_key(connection)

    assert key_file.exists()
    assert key_file.read_text().strip()


async def test_ensure_key_refuses_to_mint_over_existing_secrets(key_file, monkeypatch, built_schema):
    """A removed key file on a deployment with data is refused rather than replaced"""
    monkeypatch.delenv(encryption.KEY_ENV_VAR, raising=False)

    async with engine.begin() as connection:
        await _store_totp_secret(connection, generate_encryption_key())

        with pytest.raises(RuntimeError, match="already holds secrets"):
            await ensure_key(connection)

    assert not key_file.exists()


async def test_verify_fingerprint_records_the_key_on_an_upgrading_deployment(configured_key):
    """A deployment arriving without a record gets the key it can actually read recorded"""
    async with engine.begin() as connection:
        await _store_totp_secret(connection, configured_key)

        await verify_fingerprint(connection)

        assert await read_fingerprint(connection) == key_fingerprint(configured_key)


async def test_verify_fingerprint_refuses_to_record_a_key_that_reads_nothing(configured_key):
    """A wrong key configured during an upgrade is refused rather than blessed as correct"""
    async with engine.begin() as connection:
        await _store_totp_secret(connection, generate_encryption_key())

        with pytest.raises(RuntimeError, match="does not decrypt"):
            await verify_fingerprint(connection)

        assert await read_fingerprint(connection) is None


async def test_verify_fingerprint_records_on_a_database_with_no_secrets(configured_key):
    """With nothing encrypted there is nothing to prove, so the key is recorded"""
    async with engine.begin() as connection:
        await verify_fingerprint(connection)

        assert await read_fingerprint(connection) == key_fingerprint(configured_key)


async def test_verify_key_matches_data_refuses_a_key_the_data_is_not_under(configured_key):
    """Serving under a key the secrets were not written with is refused at startup"""
    async with engine.begin() as connection:
        await record_fingerprint(connection, generate_encryption_key())

        with pytest.raises(RuntimeError, match="different key"):
            await verify_key_matches_data(connection)


async def test_verify_key_matches_data_accepts_the_recorded_key(configured_key):
    """The key the data is under passes, so a correct deployment starts"""
    async with engine.begin() as connection:
        await record_fingerprint(connection, configured_key)

        await verify_key_matches_data(connection)


async def test_verify_key_matches_data_allows_a_database_with_no_record(configured_key):
    """A deployment that has never recorded a fingerprint is not treated as a mismatch"""
    async with engine.begin() as connection:
        await verify_key_matches_data(connection)


async def test_record_fingerprint_replaces_the_previous_key(configured_key):
    """Recording after a rotation replaces the record rather than adding a second row"""
    rotated_key = generate_encryption_key()
    async with engine.begin() as connection:
        await record_fingerprint(connection, configured_key)
        await record_fingerprint(connection, rotated_key)

        assert await read_fingerprint(connection) == key_fingerprint(rotated_key)
        assert await connection.scalar(text("SELECT count(*) FROM encryption_key_fingerprint")) == 1
