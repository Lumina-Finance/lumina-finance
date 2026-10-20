"""Bank transaction hash key provisioning tests"""

import pytest
from sqlalchemy import text

from app import bank_transaction_key
from app.config import imports as import_config
from app.db.bank_transaction_key import ensure_key
from tests.conftest import engine


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


async def test_ensure_key_generates_one_where_no_hash_depends_on_it(key_file):
    """A first install, or an upgrade before any hash is saved, gets a key without being asked"""
    async with engine.begin() as connection:
        await ensure_key(connection)

    assert key_file.exists()


async def test_ensure_key_refuses_to_replace_a_lost_key_the_saved_hashes_were_made_with(key_file):
    """A restore without the key would otherwise bring back every statement's transactions on re-import"""
    async with engine.begin() as connection:
        await _save_hashed_transaction(connection)

        with pytest.raises(RuntimeError, match="Restore that key"):
            await ensure_key(connection)

    assert not key_file.exists()
