"""Bank transaction hash key provisioning and binding tests"""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app import bank_transaction_key
from app.bank_transaction_key import generate_key, key_fingerprint
from app.config import imports as import_config
from app.db import bank_transaction_key as provisioning
from app.db.bank_transaction_key import ensure_key, reset_key, verify_key_matches_hashes
from tests.conftest import engine

_RESET_ADVICE = "accept that statements imported again will bring back"


@pytest.fixture
def key_file(tmp_path, monkeypatch):
    """Point the key file at a temporary path and leave the environment without a key"""
    monkeypatch.setattr(bank_transaction_key, "_SECRETS_DIR", tmp_path)
    monkeypatch.setattr(bank_transaction_key, "KEY_FILE", tmp_path / "bank_transaction_hash_key")
    monkeypatch.setattr(import_config, "BANK_TRANSACTION_HASH_KEY", None)
    return bank_transaction_key.KEY_FILE


async def _save_hashed_transaction(connection) -> None:
    """Write one transaction an OFX import saved with its bank transaction hash"""
    # The suite truncates reference data between tests, so the currency is inserted here
    await connection.execute(
        text(
            "INSERT INTO currencies (id, name, symbol, minor_unit_exponent) "
            "VALUES ('CAD', 'Canadian Dollar', '$', 2) ON CONFLICT (id) DO NOTHING"
        )
    )
    user_id = await connection.scalar(
        text(
            "INSERT INTO users (id, email, first_name, tz, base_currency) "
            "VALUES (gen_random_uuid(), 'hash-key@example.com', 'Hash', 'UTC', 'CAD') RETURNING id"
        )
    )
    account_id = await connection.scalar(
        text(
            "INSERT INTO accounts (id, owner_id, name, currency, account_kind, account_type, is_archived) "
            "VALUES (gen_random_uuid(), :owner_id, 'Chequing', 'CAD', 'ASSET', 'CHECKING', false) RETURNING id"
        ),
        {"owner_id": user_id},
    )
    category_id = await connection.scalar(
        text("INSERT INTO categories (id, name, kind, is_system) VALUES (gen_random_uuid(), 'Spending', 'EXPENSE', true) RETURNING id")
    )
    await connection.execute(
        text(
            "INSERT INTO transactions (id, created_by_user_id, account_id, dt, category_id, amount, currency, "
            "bank_transaction_hash) VALUES (gen_random_uuid(), :user_id, :account_id, '2026-03-15', "
            ":category_id, -1250, 'CAD', :hash)"
        ),
        {"user_id": user_id, "account_id": account_id, "category_id": category_id, "hash": "a" * 64},
    )


async def _record(connection, key: str) -> None:
    """Record a key's fingerprint as the migration does"""
    await connection.execute(
        text("INSERT INTO bank_transaction_key_fingerprint (id, fingerprint) VALUES (1, :fingerprint)"),
        {"fingerprint": key_fingerprint(bytes.fromhex(key))},
    )


async def test_ensure_key_generates_one_where_nothing_depends_on_a_key(key_file):
    """A first install, or an upgrade before any hash is saved, gets a key without being asked"""
    async with engine.begin() as connection:
        await ensure_key(connection)

    assert key_file.exists()


async def test_ensure_key_generates_one_before_the_hash_column_exists(key_file):
    """An upgrade from before the hash runs this ahead of the migration that needs the key"""
    async with engine.connect() as connection:
        transaction = await connection.begin()
        await connection.execute(text("ALTER TABLE transactions DROP COLUMN bank_transaction_hash"))
        await connection.execute(text("DROP TABLE bank_transaction_key_fingerprint"))

        await ensure_key(connection)

        await transaction.rollback()
    assert key_file.exists()


@pytest.mark.parametrize("depends_on", ["hashes", "fingerprint"])
async def test_ensure_key_refuses_to_replace_a_key_the_database_depends_on(key_file, depends_on):
    """A restore without the key would otherwise bring back every statement's transactions on re-import"""
    async with engine.begin() as connection:
        if depends_on == "hashes":
            await _save_hashed_transaction(connection)
        else:
            await _record(connection, generate_key())

        with pytest.raises(RuntimeError, match=f"Restore that key.*{_RESET_ADVICE}"):
            await ensure_key(connection)

    assert not key_file.exists()


async def test_ensure_key_refuses_when_the_database_cannot_be_checked(key_file, monkeypatch):
    """Minting a key is what would break saved hashes, so a check that fails must not count as none"""

    async def refuse_the_read(_connection):
        raise OperationalError("SELECT", {}, Exception("permission denied"))

    monkeypatch.setattr(provisioning, "holds_bank_transaction_hashes", refuse_the_read)

    async with engine.begin() as connection:
        with pytest.raises(RuntimeError, match="could not be checked"):
            await ensure_key(connection)

    assert not key_file.exists()


@pytest.mark.parametrize("source", ["environment", "file"])
async def test_a_restart_keeps_the_key_already_in_place(key_file, monkeypatch, source):
    """A key that is set or persisted is the one the hashes were made with, and must be left as it is"""
    key = generate_key()
    if source == "environment":
        monkeypatch.setattr(import_config, "BANK_TRANSACTION_HASH_KEY", key)
    else:
        key_file.write_text(key)

    async with engine.begin() as connection:
        await _save_hashed_transaction(connection)
        await _record(connection, key)
        await ensure_key(connection)
        await verify_key_matches_hashes(connection)

    assert bank_transaction_key.resolve_key(generate=False) == bytes.fromhex(key)
    assert key_file.exists() == (source == "file")


async def test_a_start_under_another_key_than_the_hashes_were_made_with_is_refused(key_file, monkeypatch):
    """A volume that generated its own key before the database was restored would duplicate every re-import"""
    monkeypatch.setattr(import_config, "BANK_TRANSACTION_HASH_KEY", generate_key())

    async with engine.begin() as connection:
        await _record(connection, generate_key())

        with pytest.raises(RuntimeError, match=f"different key.*{_RESET_ADVICE}"):
            await verify_key_matches_hashes(connection)


async def test_a_start_with_a_key_and_no_record_yet_passes(key_file, monkeypatch):
    """A schema built from the models, as the test and demo databases are, has no record to check against"""
    monkeypatch.setattr(import_config, "BANK_TRANSACTION_HASH_KEY", generate_key())

    async with engine.begin() as connection:
        await verify_key_matches_hashes(connection)


async def test_resetting_binds_the_database_to_a_new_key_so_it_starts(key_file):
    """Someone who lost the key must have a way forward, taken on purpose rather than by accident"""
    async with engine.begin() as connection:
        await _save_hashed_transaction(connection)
        await _record(connection, generate_key())

        await reset_key(connection)

        await verify_key_matches_hashes(connection)
        recorded = await connection.scalar(text("SELECT fingerprint FROM bank_transaction_key_fingerprint"))
    assert recorded == key_fingerprint(bytes.fromhex(key_file.read_text()))
