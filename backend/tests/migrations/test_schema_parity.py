"""Alembic schema parity tests"""

import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Enum as SqlaEnum
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from sqlalchemy.pool import NullPool

from app.bank_transaction_key import key_fingerprint, resolve_key
from app.config.database import APP_DB_USER, MIGRATOR_DB_USER
from app.db.bank_transaction_key import FINGERPRINT_TABLE as BANK_TRANSACTION_KEY_FINGERPRINT_TABLE
from app.db.credentials import resolve_role_password
from app.db.key_fingerprint import read_fingerprint
from app.models.base import Base
from app.models.types import find_encrypted_columns
from app.services.auth.login_email_hash import seal_login_email
from app.services.merchants.defaults import (
    SELF_MERCHANT_NAME,
    SYSTEM_MERCHANT_NAMES,
    UNKNOWN_MERCHANT_NAME,
)
from tests.conftest import (
    DB_HOST,
    DB_PASSWORD,
    DB_PORT,
    DB_USER,
    WORKER_DB_NAME,
)

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_TEST_DB_NAME = f"{WORKER_DB_NAME}_alembic_schema"
_ALEMBIC_ENUM_DB_NAME = f"{WORKER_DB_NAME}_alembic_enums"
_ALEMBIC_AUTH_RESET_DB_NAME = f"{WORKER_DB_NAME}_alembic_auth_reset"
_AUTH_SESSIONS_REVISION = "a4f8d1c2e7b3"
_ALEMBIC_SYSTEM_MERCHANT_DB_NAME = f"{WORKER_DB_NAME}_alembic_system_merchant"
_BEFORE_SYSTEM_MERCHANTS_REVISION = "cbf7ada87de3"
_ALEMBIC_UNKNOWN_MERCHANT_DB_NAME = f"{WORKER_DB_NAME}_alembic_unknown_merchant"
_BEFORE_UNKNOWN_MERCHANT_REVISION = "93e7aa96d2ae"
_ALEMBIC_RESET_REQUEST_DB_NAME = f"{WORKER_DB_NAME}_alembic_reset_request"
_BEFORE_RESET_REQUEST_REVISION = "b3e7a15c9d42"
_ALEMBIC_ENCRYPTED_DB_NAME = f"{WORKER_DB_NAME}_alembic_encrypted_columns"
_ALEMBIC_FOLDED_CATEGORY_DB_NAME = f"{WORKER_DB_NAME}_alembic_folded_categories"
_ALEMBIC_FOLDED_MERCHANT_DB_NAME = f"{WORKER_DB_NAME}_alembic_folded_merchants"
_BEFORE_FOLDED_NAMES_REVISION = "6a1f132b9da2"
_ALEMBIC_ACCOUNT_DATE_INDEX_DB_NAME = f"{WORKER_DB_NAME}_alembic_account_date_index"
_BEFORE_ACCOUNT_DATE_INDEX_REVISION = "51c17506619a"
_ACCOUNT_DATE_INDEX_REVISION = "0b8d6e2c9a41"
_ACCOUNT_DATE_INDEX_NAME = "ix_transactions_account_id_dt"
_ALEMBIC_DATE_FORMAT_DB_NAME = f"{WORKER_DB_NAME}_alembic_date_format"
_BEFORE_DATE_FORMAT_REVISION = "b3e7a15c9d42"
_DATE_FORMAT_REVISION = "c5d2a8f1b7e3"
_DATE_FORMAT_OWNER_ID = "99999999-9999-4999-8999-999999999999"
_ALEMBIC_OFX_SOURCE_DB_NAME = f"{WORKER_DB_NAME}_alembic_ofx_source"
_BEFORE_OFX_SOURCE_REVISION = "c4e8a2f6b913"
_OFX_SOURCE_REVISION = "b8d4f1a6c203"
_OFX_OWNER_ID = "77777777-7777-4777-8777-777777777777"
_CSV_RUN_ID = "88888888-8888-4888-8888-888888888888"
_OFX_RUN_ID = "99999999-9999-4999-8999-999999999999"
_ALEMBIC_BANK_TRANSACTION_DB_NAME = f"{WORKER_DB_NAME}_alembic_bank_transaction"
_ALEMBIC_BANK_HASH_DB_NAME = f"{WORKER_DB_NAME}_alembic_bank_hash"
_BEFORE_BANK_HASH_REVISION = "f3a9c1d7b265"
_BANK_HASH_REVISION = "7c2e9a4d1f58"
_BANK_HASH_ACCOUNT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
_BANK_HASH_CATEGORY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
_UNSAVED_OFX_RUN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
_UNSAVED_CSV_RUN_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
_SAVINGS_ACCOUNT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
_CHEQUING_KEY = "bank:123000456:000123456789"
_ALEMBIC_RUN_SOURCES_DB_NAME = f"{WORKER_DB_NAME}_alembic_run_sources"
_RUN_SOURCES_REVISION = "9e1b5c3a7d24"
_ALEMBIC_EMAIL_FOLD_DB_NAME = f"{WORKER_DB_NAME}_alembic_email_fold"
_BEFORE_EMAIL_FOLD_REVISION = "c4d8e2f6a1b3"
_EMAIL_FOLD_REVISION = "b7d3f1a9c5e2"
_EMAIL_FOLD_SECRET_HASH = "secret-password-hash-that-must-not-be-printed"

# What the server keeps for the account key above and the bank ID "A1" under the test key: HMAC-SHA256
# of the SHA-256 digest of the key, a zero byte and "A1". The digest, from
# `printf 'bank:123000456:000123456789\0A1' | shasum -a 256`, is
# 7d404905c477742532f9d2abc554de3c7f8089848d5e927aa19725a9b5d931ed
_CHEQUING_A1_STORED_HASH = "7947133547ae51015c6ef7299aa59548c51f7bae848b3428f73186db52f1cfee"


async def test_account_date_index_migration_preserves_rows_and_existing_indexes() -> None:
    """Verify upgrade, downgrade and reupgrade preserve duplicate account/date rows and other indexes"""
    database_name = _ALEMBIC_ACCOUNT_DATE_INDEX_DB_NAME
    await _recreate_database(database_name)
    engine = _create_engine_for_database(database_name)
    try:
        _run_alembic_upgrade(database_name, revision=_BEFORE_ACCOUNT_DATE_INDEX_REVISION)
        async with engine.begin() as conn:
            # Supply the currency required by the synthetic owner and ledger rows
            await conn.execute(
                text(
                    "INSERT INTO currencies (id, name, symbol, minor_unit_exponent)"
                    " VALUES ('CAD', 'Canadian Dollar', '$', 2) ON CONFLICT (id) DO NOTHING",
                )
            )

            # Keep the fixture owner independent of existing profile data
            await conn.execute(
                text(
                    "INSERT INTO users (id, email, first_name, tz, base_currency)"
                    " VALUES ('11111111-1111-4111-8111-111111111111', 'index-migration@example.com', 'Index', 'UTC', 'CAD')",
                )
            )

            # Put both ledger rows in one active account to exercise duplicate account dates
            await conn.execute(
                text(
                    "INSERT INTO accounts (id, owner_id, name, currency, account_kind, account_type, is_archived)"
                    " VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111',"
                    " 'Index account', 'CAD', 'ASSET', 'CHECKING', false)",
                )
            )

            # Give the ledger rows a valid classification without application seeding
            await conn.execute(
                text(
                    "INSERT INTO categories (id, name, kind, is_system)"
                    " VALUES ('33333333-3333-4333-8333-333333333333', 'Index category', 'EXPENSE', true)",
                )
            )

            # Give both rows a shared merchant so existing merchant index coverage remains relevant
            await conn.execute(
                text(
                    "INSERT INTO merchants (id, name, is_system) VALUES ('44444444-4444-4444-8444-444444444444', 'Index merchant', true)",
                )
            )
            for identifier, amount, notes in (
                ("55555555-5555-4555-8555-555555555555", -12345, "Purchase"),
                ("66666666-6666-4666-8666-666666666666", 250, "Refund"),
            ):
                # Preserve distinct financial values while proving that duplicate dates remain valid
                await conn.execute(
                    text(
                        "INSERT INTO transactions (id, created_by_user_id, account_id, dt, merchant_id, category_id, amount, currency, notes)"
                        " VALUES (:id, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',"
                        " '2026-03-15', '44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333',"
                        " :amount, 'CAD', :notes)",
                    ),
                    {"id": UUID(identifier), "amount": amount, "notes": notes},
                )
        async with engine.connect() as conn:
            original_rows, original_indexes = await _read_account_index_migration_state(conn)
        assert len(original_rows) == 2
        assert _ACCOUNT_DATE_INDEX_NAME not in original_indexes
        assert {"transactions_pkey", "ix_transactions_merchant_id_dt", "ix_transactions_counterparty_account_id"} <= original_indexes.keys()
        metadata_index = next(index for index in Base.metadata.tables["transactions"].indexes if index.name == _ACCOUNT_DATE_INDEX_NAME)
        assert [column.name for column in metadata_index.columns] == ["account_id", "dt"]
        assert not metadata_index.unique

        for reupgrade in (False, True):
            _run_alembic_upgrade(database_name, revision=_ACCOUNT_DATE_INDEX_REVISION)
            async with engine.connect() as conn:
                rows, indexes = await _read_account_index_migration_state(conn)

                # Verify the physical index independently of the migration and metadata declarations
                catalog = (
                    await conn.execute(
                        text(
                            "SELECT i.indisvalid, i.indisunique, i.indnkeyatts,"
                            " pg_get_indexdef(i.indexrelid, 1, true), pg_get_indexdef(i.indexrelid, 2, true)"
                            " FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = :name",
                        ),
                        {"name": _ACCOUNT_DATE_INDEX_NAME},
                    )
                ).one()
            assert tuple(catalog) == (True, False, 2, "account_id", "dt")
            assert rows == original_rows
            assert {name: definition for name, definition in indexes.items() if name != _ACCOUNT_DATE_INDEX_NAME} == original_indexes
            if not reupgrade:
                _run_account_index_downgrade(database_name)
                async with engine.connect() as conn:
                    rows, indexes = await _read_account_index_migration_state(conn)
                assert rows == original_rows
                assert indexes == original_indexes
    finally:
        await engine.dispose()
        await _drop_database(database_name)


async def test_ofx_import_source_migration_keeps_other_runs_and_drops_ofx_runs_on_downgrade() -> None:
    """Verify upgrade, downgrade and reupgrade of the OFX source check keep CSV runs and refuse OFX ones when narrowed"""
    database_name = _ALEMBIC_OFX_SOURCE_DB_NAME
    await _recreate_database(database_name)
    engine = _create_engine_for_database(database_name)
    try:
        _run_alembic_upgrade(database_name, revision=_BEFORE_OFX_SOURCE_REVISION)
        async with engine.begin() as conn:
            # Supply the currency required by the synthetic owner
            await conn.execute(
                text(
                    "INSERT INTO currencies (id, name, symbol, minor_unit_exponent)"
                    " VALUES ('CAD', 'Canadian Dollar', '$', 2) ON CONFLICT (id) DO NOTHING",
                )
            )
            await conn.execute(
                text(
                    "INSERT INTO users (id, email, first_name, tz, base_currency)"
                    " VALUES (:id, 'ofx-migration@example.com', 'Ofx', 'UTC', 'CAD')",
                ),
                {"id": UUID(_OFX_OWNER_ID)},
            )
            await _insert_import_run(conn, _CSV_RUN_ID, "generic")

        # Before the revision the check names no OFX source, so such a run is refused
        async with engine.begin() as conn:
            with pytest.raises(IntegrityError):
                await _insert_import_run(conn, _OFX_RUN_ID, "ofx")

        for reupgrade in (False, True):
            _run_alembic_upgrade(database_name, revision=_OFX_SOURCE_REVISION)
            async with engine.begin() as conn:
                await _insert_import_run(conn, _OFX_RUN_ID, "ofx")
            async with engine.connect() as conn:
                assert await _read_import_run_sources(conn) == {_CSV_RUN_ID: "generic", _OFX_RUN_ID: "ofx"}
            if not reupgrade:
                _run_alembic_downgrade(database_name, _BEFORE_OFX_SOURCE_REVISION)

                # Narrowing deletes the OFX run it could no longer hold, and the CSV run stays as it was
                async with engine.connect() as conn:
                    assert await _read_import_run_sources(conn) == {_CSV_RUN_ID: "generic"}
                async with engine.begin() as conn:
                    with pytest.raises(IntegrityError):
                        await _insert_import_run(conn, _OFX_RUN_ID, "ofx")
    finally:
        await engine.dispose()
        await _drop_database(database_name)


async def test_date_format_migration_keeps_existing_users_on_month_day_year_and_refuses_other_values() -> None:
    """Verify upgrade, downgrade and reupgrade of the date format start a user from before it on month-day-year"""
    database_name = _ALEMBIC_DATE_FORMAT_DB_NAME
    await _recreate_database(database_name)
    engine = _create_engine_for_database(database_name)
    try:
        _run_alembic_upgrade(database_name, revision=_BEFORE_DATE_FORMAT_REVISION)
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO currencies (id, name, symbol, minor_unit_exponent)"
                    " VALUES ('CAD', 'Canadian Dollar', '$', 2) ON CONFLICT (id) DO NOTHING",
                )
            )
            await conn.execute(
                text(
                    "INSERT INTO users (id, email, first_name, tz, base_currency)"
                    " VALUES (:id, 'date-format-migration@example.com', 'Date', 'UTC', 'CAD')",
                ),
                {"id": UUID(_DATE_FORMAT_OWNER_ID)},
            )

        for reupgrade in (False, True):
            _run_alembic_upgrade(database_name, revision=_DATE_FORMAT_REVISION)
            async with engine.connect() as conn:
                saved = await conn.scalar(text("SELECT date_format FROM users"))
            assert saved == "month-day-year"

            async with engine.begin() as conn:
                with pytest.raises(IntegrityError):
                    await conn.execute(text("UPDATE users SET date_format = 'match-language'"))
            if not reupgrade:
                async with engine.begin() as conn:
                    await conn.execute(text("UPDATE users SET date_format = 'iso'"))
                _run_alembic_downgrade(database_name, _BEFORE_DATE_FORMAT_REVISION)

                async with engine.connect() as conn:
                    columns = await conn.scalars(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'"))
                    assert "date_format" not in columns.all()
    finally:
        await engine.dispose()
        await _drop_database(database_name)


async def test_bank_transaction_hash_migration_hashes_saved_bank_ids_as_the_import_page_does() -> None:
    """Verify upgrade, downgrade and reupgrade of the bank ID hash leave no account number behind

    The expected hash is the literal the server kept for the same account key and bank ID before it
    hashed them itself, so a migration hashing any other way would let a statement imported again
    bring back every transaction an earlier OFX import saved
    """
    database_name = _ALEMBIC_BANK_HASH_DB_NAME
    await _recreate_database(database_name)
    engine = _create_engine_for_database(database_name)
    try:
        _run_alembic_upgrade(database_name, revision=_BEFORE_BANK_HASH_REVISION)
        async with engine.begin() as conn:
            await _seed_bank_id_ledger(conn)

        for reupgrade in (False, True):
            _run_alembic_upgrade(database_name, revision=_BANK_HASH_REVISION)
            async with engine.connect() as conn:
                hashes = dict((await conn.execute(text("SELECT notes, bank_transaction_hash FROM transactions"))).all())
                columns = set(
                    (
                        await conn.execute(
                            text(
                                "SELECT column_name FROM information_schema.columns WHERE table_name = 'transactions'",
                            )
                        )
                    ).scalars()
                )

            # A downgrade loses the bank IDs for good, so the second upgrade has nothing to hash
            assert hashes == {
                "Statement": None if reupgrade else _CHEQUING_A1_STORED_HASH,
                "Typed": None,
            }
            assert {"bank_account_key", "bank_transaction_id"}.isdisjoint(columns)

            # Recorded with the hashes, so the app refuses to start under any other key from here on
            async with engine.connect() as conn:
                recorded = await conn.scalar(text("SELECT fingerprint FROM bank_transaction_key_fingerprint"))
            assert recorded == key_fingerprint(resolve_key(generate=False))

            # The app reads the record as the app role at every start, so the migration must grant it
            app_engine = _create_app_role_engine(database_name)
            try:
                async with app_engine.connect() as conn:
                    assert await read_fingerprint(conn, BANK_TRANSACTION_KEY_FINGERPRINT_TABLE) == recorded
            finally:
                await app_engine.dispose()
            if not reupgrade:
                async with engine.connect() as conn:
                    assert await _read_import_run_sources(conn) == {
                        _CSV_RUN_ID: "generic",
                        _OFX_RUN_ID: "ofx",
                        _UNSAVED_CSV_RUN_ID: "generic",
                    }

                    # The unsaved CSV run can still be saved, so its rows lose only the fields rows no longer take
                    staged = (await conn.execute(text("SELECT import_run_id, payload FROM import_staged_rows"))).all()
                    assert [(str(run_id), payload) for run_id, payload in staged] == [
                        (_UNSAVED_CSV_RUN_ID, {"account_source": "Chequing", "amount": "-12.50"}),
                    ]
                _run_alembic_downgrade(database_name, _BEFORE_BANK_HASH_REVISION)
                async with engine.connect() as conn:
                    restored = (
                        await conn.execute(
                            text(
                                "SELECT count(*), count(bank_account_key), count(bank_transaction_id) FROM transactions",
                            )
                        )
                    ).one()
                assert tuple(restored) == (2, 0, 0)
    finally:
        await engine.dispose()
        await _drop_database(database_name)


async def test_saved_ofx_runs_forget_the_account_numbers_their_statements_were_named_by() -> None:
    """Verify upgrade, downgrade and reupgrade leave a saved OFX run no account number and keep its accounts

    A repeated save is answered from the summary, whose accounts the page counts, so renaming must
    keep every account id while a CSV run, whose sources are the user's own column values, is left alone
    """
    database_name = _ALEMBIC_RUN_SOURCES_DB_NAME
    await _recreate_database(database_name)
    engine = _create_engine_for_database(database_name)
    # Two statements of one bank account answered with one account, as a file split over two date
    # ranges is, and a credit card answered with another
    ofx_targets = {
        _CHEQUING_KEY: _BANK_HASH_ACCOUNT_ID,
        f"{_CHEQUING_KEY}#2": _BANK_HASH_ACCOUNT_ID,
        "creditCard:4111111111111111": _SAVINGS_ACCOUNT_ID,
    }
    ofx_mappings = {key: {"source": key, "account_id": account_id} for key, account_id in ofx_targets.items()}
    csv_mappings = {"Chequing": {"source": "Chequing", "account_id": _BANK_HASH_ACCOUNT_ID}}
    try:
        _run_alembic_upgrade(database_name, revision=_BANK_HASH_REVISION)
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO currencies (id, name, symbol, minor_unit_exponent)"
                    " VALUES ('CAD', 'Canadian Dollar', '$', 2) ON CONFLICT (id) DO NOTHING",
                )
            )
            await conn.execute(
                text(
                    "INSERT INTO users (id, email, first_name, tz, base_currency)"
                    " VALUES (:id, 'run-sources-migration@example.com', 'Runs', 'UTC', 'CAD')",
                ),
                {"id": UUID(_OFX_OWNER_ID)},
            )
            for run_id, source, mappings in ((_OFX_RUN_ID, "ofx", ofx_mappings), (_CSV_RUN_ID, "generic", csv_mappings)):
                source_ids = {key: mapping["account_id"] for key, mapping in mappings.items()}
                summary = {"transactions_created": 3, "account_source_ids": source_ids}
                await conn.execute(
                    text(
                        "INSERT INTO import_runs (id, owner_id, source, expected_transaction_count, account_mappings,"
                        " category_mappings, committed_at, summary)"
                        " VALUES (:id, :owner_id, :source, 3, :mappings, '{}', now(), :summary)",
                    ),
                    {
                        "id": UUID(run_id),
                        "owner_id": UUID(_OFX_OWNER_ID),
                        "source": source,
                        "mappings": json.dumps(mappings),
                        "summary": json.dumps(summary),
                    },
                )

        for reupgrade in (False, True):
            _run_alembic_upgrade(database_name, revision=_RUN_SOURCES_REVISION)
            async with engine.connect() as conn:
                runs = {
                    str(run_id): (mappings, summary)
                    for run_id, mappings, summary in await conn.execute(
                        text("SELECT id, account_mappings, summary FROM import_runs"),
                    )
                }
            ofx_answers, ofx_summary = runs.pop(_OFX_RUN_ID)
            ofx_source_ids = ofx_summary.pop("account_source_ids")
            assert (ofx_answers, ofx_summary) == ({}, {"transactions_created": 3})

            # Named in the order Postgres keeps the keys, so only the names and the accounts are fixed
            assert set(ofx_source_ids) == {"statement-1", "statement-2", "statement-3"}
            assert sorted(ofx_source_ids.values()) == sorted(ofx_targets.values())
            assert runs == {
                _CSV_RUN_ID: (csv_mappings, {"transactions_created": 3, "account_source_ids": {"Chequing": _BANK_HASH_ACCOUNT_ID}}),
            }
            if not reupgrade:
                _run_alembic_downgrade(database_name, _BANK_HASH_REVISION)
    finally:
        await engine.dispose()
        await _drop_database(database_name)


async def _seed_bank_id_ledger(conn: AsyncConnection) -> None:
    """Seed one transaction an OFX import saved with its bank ID, one typed in, and four import runs

    The runs are a saved CSV run, a saved OFX run, an unsaved OFX run, whose staged row holds the
    numbers the upgrade drops, and an unsaved CSV run, whose staged row the previous version wrote
    with both bank fields empty
    """
    await conn.execute(
        text(
            "INSERT INTO currencies (id, name, symbol, minor_unit_exponent)"
            " VALUES ('CAD', 'Canadian Dollar', '$', 2) ON CONFLICT (id) DO NOTHING",
        )
    )
    await conn.execute(
        text(
            "INSERT INTO users (id, email, first_name, tz, base_currency)"
            " VALUES (:id, 'bank-hash-migration@example.com', 'Hash', 'UTC', 'CAD')",
        ),
        {"id": UUID(_OFX_OWNER_ID)},
    )
    await conn.execute(
        text(
            "INSERT INTO accounts (id, owner_id, name, currency, account_kind, account_type, is_archived)"
            " VALUES (:account_id, :owner_id, 'Chequing ending 6789', 'CAD', 'ASSET', 'CHECKING', false)",
        ),
        {"account_id": UUID(_BANK_HASH_ACCOUNT_ID), "owner_id": UUID(_OFX_OWNER_ID)},
    )
    await conn.execute(
        text(
            "INSERT INTO categories (id, name, kind, is_system) VALUES (:id, 'Hash category', 'EXPENSE', true)",
        ),
        {"id": UUID(_BANK_HASH_CATEGORY_ID)},
    )
    for notes, account_key, bank_id in (("Statement", _CHEQUING_KEY, "A1"), ("Typed", None, None)):
        await conn.execute(
            text(
                "INSERT INTO transactions (id, created_by_user_id, account_id, dt, category_id, amount, currency, notes,"
                " bank_account_key, bank_transaction_id)"
                " VALUES (gen_random_uuid(), :owner_id, :account_id, '2026-03-15', :category_id, -1250, 'CAD', :notes,"
                " :account_key, :bank_id)",
            ),
            {
                "owner_id": UUID(_OFX_OWNER_ID),
                "account_id": UUID(_BANK_HASH_ACCOUNT_ID),
                "category_id": UUID(_BANK_HASH_CATEGORY_ID),
                "notes": notes,
                "account_key": account_key,
                "bank_id": bank_id,
            },
        )

    await _insert_import_run(conn, _CSV_RUN_ID, "generic")
    await _insert_import_run(conn, _OFX_RUN_ID, "ofx")
    await conn.execute(text("UPDATE import_runs SET committed_at = now()"))
    await _insert_import_run(conn, _UNSAVED_OFX_RUN_ID, "ofx")
    await _insert_import_run(conn, _UNSAVED_CSV_RUN_ID, "generic")
    staged_payloads = (
        (_UNSAVED_OFX_RUN_ID, {"account_source": _CHEQUING_KEY, "bank_account_key": _CHEQUING_KEY, "bank_transaction_id": "A2"}),
        (
            _UNSAVED_CSV_RUN_ID,
            {"account_source": "Chequing", "amount": "-12.50", "bank_account_key": None, "bank_transaction_id": None},
        ),
    )
    for run_id, payload in staged_payloads:
        await conn.execute(
            text(
                "INSERT INTO import_staged_rows (id, import_run_id, owner_id, row_index, payload)"
                " VALUES (gen_random_uuid(), :run_id, :owner_id, 0, :payload)",
            ),
            {"run_id": UUID(run_id), "owner_id": UUID(_OFX_OWNER_ID), "payload": json.dumps(payload)},
        )


async def _insert_import_run(conn: AsyncConnection, run_id: str, source: str) -> None:
    """Insert one import run of the given source for the fixture owner"""
    await conn.execute(
        text(
            "INSERT INTO import_runs (id, owner_id, source, expected_transaction_count, account_mappings, category_mappings)"
            " VALUES (:id, :owner_id, :source, 1, '{}', '{}')",
        ),
        {"id": UUID(run_id), "owner_id": UUID(_OFX_OWNER_ID), "source": source},
    )


async def _read_import_run_sources(conn: AsyncConnection) -> dict[str, str]:
    """Read the source of every import run, keyed by its id"""
    rows = (await conn.execute(text("SELECT id, source FROM import_runs"))).all()
    return {str(run_id): source for run_id, source in rows}


def _run_alembic_downgrade(database_name: str, revision: str) -> None:
    """Run Alembic downgrade against a generated migration database"""
    environment = os.environ.copy()
    environment.update(
        {
            "DB_HOST": DB_HOST,
            "DB_PORT": DB_PORT,
            "DB_NAME": database_name,
            "DB_USER": DB_USER,
            "DB_PASSWORD": DB_PASSWORD,
        }
    )

    # Fixed revisions and executable keep this migration subprocess independent of application imports
    completed = subprocess.run(  # noqa: S603
        [sys.executable, "-m", "alembic", "downgrade", revision],
        cwd=_BACKEND_DIR,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr


async def _read_account_index_migration_state(conn: AsyncConnection) -> tuple[list[tuple], dict[str, str]]:
    """Read every ledger field and index definition to detect changes beyond the new index"""
    rows = [tuple(row) for row in (await conn.execute(text("SELECT * FROM transactions ORDER BY id"))).all()]

    # Preserve all existing index definitions across both migration directions
    indexes = dict(
        (
            await conn.execute(
                text(
                    "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'transactions' ORDER BY indexname",
                )
            )
        ).all()
    )
    return rows, indexes


def _run_account_index_downgrade(database_name: str) -> None:
    """Downgrade only the account index revision in a generated migration database"""
    environment = os.environ.copy()
    environment.update(
        {
            "DB_HOST": DB_HOST,
            "DB_PORT": DB_PORT,
            "DB_NAME": database_name,
            "DB_USER": DB_USER,
            "DB_PASSWORD": DB_PASSWORD,
        }
    )

    # Fixed revision and executable keep this migration subprocess independent of application imports
    completed = subprocess.run(  # noqa: S603
        [sys.executable, "-m", "alembic", "downgrade", _BEFORE_ACCOUNT_DATE_INDEX_REVISION],
        cwd=_BACKEND_DIR,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr


async def test_alembic_schema_columns_match_model_metadata() -> None:
    """Verify Alembic creates the same table columns expected by the models"""
    await _recreate_database(_ALEMBIC_TEST_DB_NAME)
    try:
        _run_alembic_upgrade(_ALEMBIC_TEST_DB_NAME)
        actual_columns = await _get_database_columns(_ALEMBIC_TEST_DB_NAME)
        expected_columns = _get_model_columns()
        assert actual_columns == expected_columns
    finally:
        await _drop_database(_ALEMBIC_TEST_DB_NAME)


async def test_alembic_column_types_and_defaults_match_model_metadata() -> None:
    """Verify Alembic builds every column with the type and default the models declare

    The column comparison above reads names only, so a column whose migration and model
    disagree on its type or its default passes there while the two schemas diverge. An
    integer primary key is the usual way in: it builds as a sequence unless something
    suppresses that, and a client-side default suppresses it on one side only

    The encrypted columns are asserted by name as well, since EncryptedText decorating
    Text is what lets an existing column be labelled with no migration at all
    """
    encrypted_columns = find_encrypted_columns(Base.metadata)
    assert encrypted_columns, "No encrypted columns found, so this test would prove nothing"

    await _recreate_database(_ALEMBIC_ENCRYPTED_DB_NAME)
    try:
        _run_alembic_upgrade(_ALEMBIC_ENCRYPTED_DB_NAME)
        from_alembic = await _get_column_definitions(_ALEMBIC_ENCRYPTED_DB_NAME)
        from_metadata = await _get_column_definitions(WORKER_DB_NAME)

        assert from_alembic == from_metadata
        assert {column: from_alembic[column][0] for column in encrypted_columns} == dict.fromkeys(encrypted_columns, "text")
    finally:
        await _drop_database(_ALEMBIC_ENCRYPTED_DB_NAME)


async def test_alembic_enum_labels_match_model_metadata() -> None:
    """Verify Alembic builds the same enum labels the models declare

    The route tests build the schema from model metadata, so a model enum that gains a value with no
    migration to add it still passes there yet breaks a migration-built database. Comparing the two
    directly catches that drift, such as a new auth provider added to the type without a migration
    """
    await _recreate_database(_ALEMBIC_ENUM_DB_NAME)
    try:
        _run_alembic_upgrade(_ALEMBIC_ENUM_DB_NAME)
        actual_enums = await _get_database_enums(_ALEMBIC_ENUM_DB_NAME)
        expected_enums = _get_model_enums()
        assert actual_enums == expected_enums
    finally:
        await _drop_database(_ALEMBIC_ENUM_DB_NAME)


async def test_alembic_bank_transaction_rules_match_model_metadata() -> None:
    """Verify Alembic builds the bank transaction index as the models declare it

    The route tests build the schema from model metadata, so a migration that built the index on
    the hash alone, or left out its condition, would pass them while refusing real imports
    """
    rules_query = text("SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_transactions_account_bank_transaction'")
    await _recreate_database(_ALEMBIC_BANK_TRANSACTION_DB_NAME)
    try:
        _run_alembic_upgrade(_ALEMBIC_BANK_TRANSACTION_DB_NAME)
        built = {}
        for database_name in (_ALEMBIC_BANK_TRANSACTION_DB_NAME, WORKER_DB_NAME):
            engine = _create_engine_for_database(database_name)
            try:
                async with engine.connect() as conn:
                    built[database_name] = sorted((await conn.execute(rules_query)).scalars())
            finally:
                await engine.dispose()

        assert len(built[WORKER_DB_NAME]) == 1
        assert built[_ALEMBIC_BANK_TRANSACTION_DB_NAME] == built[WORKER_DB_NAME]
    finally:
        await _drop_database(_ALEMBIC_BANK_TRANSACTION_DB_NAME)


async def test_auth_session_overhaul_clears_legacy_auth_state() -> None:
    """Verify the auth-token migration does not carry old sessions forward"""
    await _recreate_database(_ALEMBIC_AUTH_RESET_DB_NAME)
    try:
        _run_alembic_upgrade(_ALEMBIC_AUTH_RESET_DB_NAME, revision=_AUTH_SESSIONS_REVISION)
        await _seed_legacy_auth_state(_ALEMBIC_AUTH_RESET_DB_NAME)

        _run_alembic_upgrade(_ALEMBIC_AUTH_RESET_DB_NAME)

        session_count, token_count, active_tokens_exists = await _get_auth_storage_state(
            _ALEMBIC_AUTH_RESET_DB_NAME,
        )
        assert session_count == 0
        assert token_count == 0
        assert not active_tokens_exists
    finally:
        await _drop_database(_ALEMBIC_AUTH_RESET_DB_NAME)


_ALEMBIC_LOGIN_LOCKOUT_DB_NAME = f"{WORKER_DB_NAME}_alembic_login_lockout"
_BEFORE_LOGIN_LOCKOUT_REVISION = "9d2f6b4e7a31"
_LOGIN_LOCKOUT_REVISION = "4e8b2d6a9c15"
_LOCKED_USER_ID = "12121212-1212-4121-8121-121212121212"
_COUNTING_USER_ID = "34343434-3434-4343-8343-343434343434"
_CLEAN_USER_ID = "56565656-5656-4565-8565-565656565656"


async def test_login_lockout_migration_carries_counts_and_locks_both_ways() -> None:
    """Verify upgrade, downgrade and reupgrade keep every count and lock, under the hash the login uses

    A lock moved under any other name would no longer match the email at sign-in, so the account would
    unlock, and a clean credential must not leave a row behind
    """
    database_name = _ALEMBIC_LOGIN_LOCKOUT_DB_NAME
    await _recreate_database(database_name)
    engine = _create_engine_for_database(database_name)
    users = {
        _LOCKED_USER_ID: ("locked@example.com", 5, True),
        _COUNTING_USER_ID: ("counting@example.com", 2, False),
        _CLEAN_USER_ID: ("clean@example.com", 0, False),
    }
    try:
        _run_alembic_upgrade(database_name, revision=_BEFORE_LOGIN_LOCKOUT_REVISION)
        async with engine.begin() as conn:
            await conn.execute(text("INSERT INTO currencies (id, name, symbol, minor_unit_exponent) VALUES ('CAD', 'Canadian Dollar', '$', 2)"))
            for user_id, (email, count, locked) in users.items():
                await conn.execute(
                    text(
                        "INSERT INTO users (id, email, first_name, tz, base_currency)"
                        " VALUES (:id, :email, 'Migration', 'America/Toronto', 'CAD')"
                    ),
                    {"id": user_id, "email": email},
                )
                await conn.execute(
                    text(
                        "INSERT INTO password_credentials"
                        " (user_id, password_hash, password_algo, failed_attempt_count, locked_until)"
                        " VALUES (:id, 'unused-hash', 'argon2id', :count,"
                        " CASE WHEN :locked THEN now() + interval '20 minutes' END)"
                    ),
                    {"id": user_id, "count": count, "locked": locked},
                )

        expected = {
            seal_login_email(users[_LOCKED_USER_ID][0]): (5, True),
            seal_login_email(users[_COUNTING_USER_ID][0]): (2, False),
        }
        for reupgrade in (False, True):
            _run_alembic_upgrade(database_name, revision=_LOGIN_LOCKOUT_REVISION)
            async with engine.connect() as conn:
                rows = (await conn.execute(text("SELECT email_hash, failed_attempt_count, locked_until IS NOT NULL FROM login_lockouts"))).all()
                credential_columns = set(
                    (
                        await conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'password_credentials'"))
                    ).scalars()
                )
            assert {row[0]: (row[1], row[2]) for row in rows} == expected, f"reupgrade={reupgrade}"
            assert {"failed_attempt_count", "locked_until"}.isdisjoint(credential_columns)

            # The login reads and writes the table as the app role, so the migration must grant it
            app_engine = _create_app_role_engine(database_name)
            try:
                async with app_engine.begin() as conn:
                    assert await conn.scalar(text("SELECT count(*) FROM login_lockouts")) == len(expected)
            finally:
                await app_engine.dispose()

            if not reupgrade:
                _run_alembic_downgrade(database_name, _BEFORE_LOGIN_LOCKOUT_REVISION)
                async with engine.connect() as conn:
                    restored = {
                        str(user_id): (count, locked)
                        for user_id, count, locked in (
                            await conn.execute(text("SELECT user_id, failed_attempt_count, locked_until IS NOT NULL FROM password_credentials"))
                        )
                    }
                    table_left = await conn.scalar(text("SELECT to_regclass('public.login_lockouts')"))
                assert restored == {user_id: (count, locked) for user_id, (_, count, locked) in users.items()}
                assert table_left is None
    finally:
        await engine.dispose()
        await _drop_database(database_name)


async def _read_email_fold_state(conn: AsyncConnection) -> tuple[str, bool, bool]:
    """Return the schema revision, whether the exact-match constraint exists and whether the folded index does"""
    revision = await conn.scalar(text("SELECT version_num FROM alembic_version"))
    constraint = await conn.scalar(text("SELECT count(*) FROM pg_constraint WHERE conname = 'users_email_key'"))
    index = await conn.scalar(text("SELECT count(*) FROM pg_indexes WHERE indexname = 'uq_users_email_lower'"))
    return revision, constraint == 1, index == 1


async def test_email_fold_migration_refuses_case_variant_accounts_and_upgrades_once_they_are_resolved() -> None:
    """Verify the upgrade stops on accounts differing only in capitals, names them, changes nothing, and runs once resolved

    The refusal is the only protection for an instance holding such pairs: merging them could give one
    person another's finances, and an index that failed to build would leave the host with a raw database error
    """
    database_name = _ALEMBIC_EMAIL_FOLD_DB_NAME
    await _recreate_database(database_name)
    engine = _create_engine_for_database(database_name)
    emails = [
        "Alice@example.com",
        "alice@example.com",
        "carol@example.com",
        "BOB@example.com",
        "bob@example.com",
        "Bob@example.com",
        "Émile@example.com",
        "émile@example.com",
    ]
    user_ids = {email: str(uuid4()) for email in emails}
    try:
        _run_alembic_upgrade(database_name, revision=_BEFORE_EMAIL_FOLD_REVISION)
        async with engine.begin() as conn:
            await conn.execute(text("INSERT INTO currencies (id, name, symbol, minor_unit_exponent) VALUES ('CAD', 'Canadian Dollar', '$', 2)"))
            for email, user_id in user_ids.items():
                await conn.execute(
                    text(
                        "INSERT INTO users (id, email, first_name, tz, base_currency)"
                        " VALUES (:id, :email, 'Migration', 'America/Toronto', 'CAD')"
                    ),
                    {"id": user_id, "email": email},
                )
            await conn.execute(
                text("INSERT INTO password_credentials (user_id, password_hash, password_algo) VALUES (:id, :hash, 'argon2id')"),
                {"id": user_ids["Alice@example.com"], "hash": _EMAIL_FOLD_SECRET_HASH},
            )

        refused = _start_alembic_upgrade(database_name, "head")
        output = refused.stdout + refused.stderr

        assert refused.returncode != 0
        assert "  Alice@example.com, alice@example.com\n" in output
        assert "  BOB@example.com, Bob@example.com, bob@example.com\n" in output
        assert "carol@example.com" not in output
        assert "mile@example.com" not in output
        assert "docker compose stop app" in output
        assert "Traceback" not in output

        # Only the addresses are named, never the stored secrets or the account ids
        assert _EMAIL_FOLD_SECRET_HASH not in output
        assert not any(user_id in output for user_id in user_ids.values())

        # The refusal changes nothing, so a run after the host resolves the pairs starts from the same state
        async with engine.connect() as conn:
            assert await _read_email_fold_state(conn) == (_BEFORE_EMAIL_FOLD_REVISION, True, False)
            assert await conn.scalar(text("SELECT count(*) FROM users")) == len(emails)

        async with engine.begin() as conn:
            for number, email in enumerate(("alice@example.com", "bob@example.com", "Bob@example.com")):
                await conn.execute(
                    text("UPDATE users SET email = :new WHERE id = :id"), {"new": f"renamed-{number}@example.com", "id": user_ids[email]}
                )

        for reupgrade in (False, True):
            _run_alembic_upgrade(database_name, revision=_EMAIL_FOLD_REVISION)
            async with engine.connect() as conn:
                assert await _read_email_fold_state(conn) == (_EMAIL_FOLD_REVISION, False, True), f"reupgrade={reupgrade}"
                assert await conn.scalar(text("SELECT count(*) FROM users")) == len(emails)

            # The database itself refuses a second account in other capitals
            with pytest.raises(IntegrityError):
                async with engine.begin() as conn:
                    await conn.execute(
                        text(
                            "INSERT INTO users (id, email, first_name, tz, base_currency)"
                            " VALUES (:id, 'CAROL@example.com', 'Second', 'America/Toronto', 'CAD')"
                        ),
                        {"id": str(uuid4())},
                    )

            if not reupgrade:
                find_account_count = text("SELECT count(*) FROM pg_proc WHERE proname = 'find_login_account'")
                async with engine.connect() as conn:
                    assert await conn.scalar(find_account_count) == 1
                _run_alembic_downgrade(database_name, _BEFORE_EMAIL_FOLD_REVISION)
                async with engine.connect() as conn:
                    assert await _read_email_fold_state(conn) == (_BEFORE_EMAIL_FOLD_REVISION, True, False)
                    assert await conn.scalar(find_account_count) == 0
    finally:
        await engine.dispose()
        await _drop_database(database_name)


async def _recreate_database(database_name: str) -> None:
    """Drop and recreate the database used for Alembic schema parity"""
    maintenance_engine = _create_engine_for_database("postgres", isolation_level="AUTOCOMMIT")
    try:
        async with maintenance_engine.connect() as conn:
            await _terminate_database_connections(conn, database_name)

            # Drop any stale parity database left by an interrupted test run
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{database_name}"'))

            # Create a clean database owned by the migrator, since Alembic runs as
            # the migrator and must own the schema it builds from the base revision
            await conn.execute(text(f'CREATE DATABASE "{database_name}" OWNER "{MIGRATOR_DB_USER}"'))
    finally:
        await maintenance_engine.dispose()


async def _drop_database(database_name: str) -> None:
    """Drop the database used for Alembic schema parity"""
    maintenance_engine = _create_engine_for_database("postgres", isolation_level="AUTOCOMMIT")
    try:
        async with maintenance_engine.connect() as conn:
            await _terminate_database_connections(conn, database_name)

            # Drop the parity database so repeated test runs start clean
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{database_name}"'))
    finally:
        await maintenance_engine.dispose()


async def _terminate_database_connections(conn: AsyncConnection, database_name: str) -> None:
    """Terminate open connections to a generated parity database"""
    # Close active connections so PostgreSQL can drop the generated database. Only client connections:
    # an autovacuum worker may be cleaning the new database, it runs as a superuser this role may not
    # terminate, and the drop stops it by itself
    await conn.execute(
        text(
            """
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = :database_name
              AND pid <> pg_backend_pid()
              AND backend_type = 'client backend'
            """,
        ),
        {"database_name": database_name},
    )


def _run_alembic_upgrade(database_name: str, *, revision: str = "head") -> None:
    """Run Alembic upgrade against a generated parity database"""
    completed = _start_alembic_upgrade(database_name, revision)
    assert completed.returncode == 0, completed.stdout + completed.stderr


def _start_alembic_upgrade(database_name: str, revision: str) -> subprocess.CompletedProcess[str]:
    """Run Alembic upgrade against a generated parity database and return the finished process, whatever its outcome"""
    environment = os.environ.copy()
    environment.update(
        {
            "DB_HOST": DB_HOST,
            "DB_PORT": DB_PORT,
            "DB_NAME": database_name,
            "DB_USER": DB_USER,
            "DB_PASSWORD": DB_PASSWORD,
        },
    )

    # Alembic revisions are fixed test constants, and subprocess keeps migration imports isolated
    completed = subprocess.run(  # noqa: S603
        [sys.executable, "-m", "alembic", "upgrade", revision],
        cwd=_BACKEND_DIR,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )
    return completed


async def _seed_legacy_auth_state(database_name: str) -> None:
    """Insert old auth rows that the overhaul migration should discard"""
    user_id = UUID("11111111-1111-4111-8111-111111111111")
    session_id = UUID("22222222-2222-4222-8222-222222222222")
    token_id = UUID("33333333-3333-4333-8333-333333333333")

    engine = _create_engine_for_database(database_name)
    try:
        async with engine.begin() as conn:
            # Seed the user dependency needed by legacy auth rows
            await conn.execute(
                text(
                    """
                    INSERT INTO currencies (id, name, symbol, minor_unit_exponent)
                    VALUES ('CAD', 'Canadian Dollar', '$', 2)
                    """,
                ),
            )

            # Seed a user so legacy auth rows are valid before the migration runs
            await conn.execute(
                text(
                    """
                    INSERT INTO users (id, email, first_name, tz, base_currency)
                    VALUES (:user_id, 'migration-auth-reset@example.com', 'Migration', 'America/Toronto', 'CAD')
                    """,
                ),
                {"user_id": user_id},
            )

            # Seed the old session row that should force the user to log in again
            await conn.execute(
                text(
                    """
                    INSERT INTO auth_sessions (id, user_id, expires_at)
                    VALUES (:session_id, :user_id, now() + interval '1 day')
                    """,
                ),
                {"session_id": session_id, "user_id": user_id},
            )

            # Seed the old token row that should be removed with the legacy table
            await conn.execute(
                text(
                    """
                    INSERT INTO active_tokens (jti, user_id, session_id, expires_at)
                    VALUES (:token_id, :user_id, :session_id, now() + interval '1 day')
                    """,
                ),
                {"token_id": token_id, "user_id": user_id, "session_id": session_id},
            )
    finally:
        await engine.dispose()


async def _get_auth_storage_state(database_name: str) -> tuple[int, int, bool]:
    """Return auth storage row counts after the overhaul migration"""
    engine = _create_engine_for_database(database_name)
    try:
        async with engine.connect() as conn:
            # Count remaining sessions to verify pre-overhaul login state was discarded
            session_count = await conn.scalar(text("SELECT count(*) FROM auth_sessions"))

            # Count token allowlist rows to verify no token rows exist after upgrade
            token_count = await conn.scalar(text("SELECT count(*) FROM auth_tokens"))

            # Check the legacy table is gone so old active token rows cannot survive
            active_tokens_exists = await conn.scalar(
                text("SELECT to_regclass('public.active_tokens') IS NOT NULL"),
            )
            return int(session_count or 0), int(token_count or 0), bool(active_tokens_exists)
    finally:
        await engine.dispose()


async def _get_database_columns(database_name: str) -> dict[str, set[str]]:
    """Return public table columns from a generated parity database"""
    engine = _create_engine_for_database(database_name)
    try:
        async with engine.connect() as conn:
            # Fetch public schema columns created by Alembic for comparison with model metadata
            result = await conn.execute(
                text(
                    """
                    SELECT table_name, column_name
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name <> 'alembic_version'
                    ORDER BY table_name, ordinal_position
                    """,
                ),
            )
            columns_by_table: dict[str, set[str]] = {}
            for row in result:
                columns_by_table.setdefault(row.table_name, set()).add(row.column_name)
            return columns_by_table
    finally:
        await engine.dispose()


async def _get_column_definitions(database_name: str) -> dict[tuple[str, str], tuple[str, str | None]]:
    """Return the built type and default of every public column in a database

    Args:
        database_name: Database to read, either a parity database or the worker's own

    Returns:
        The data type and column default of each column, keyed by table and column name
    """
    engine = _create_engine_for_database(database_name)
    try:
        async with engine.connect() as conn:
            # Fetch what the database actually built, rather than what either side declared
            result = await conn.execute(
                text(
                    """
                    SELECT table_name, column_name, data_type, column_default
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name <> 'alembic_version'
                    """,
                ),
            )
            return {(row.table_name, row.column_name): (row.data_type, row.column_default) for row in result}
    finally:
        await engine.dispose()


def _get_model_columns() -> dict[str, set[str]]:
    """Return SQLAlchemy model columns keyed by table name"""
    columns_by_table = {table.name: {column.name for column in table.columns} for table in Base.metadata.sorted_tables}
    return columns_by_table


async def _get_database_enums(database_name: str) -> dict[str, set[str]]:
    """Return enum type labels from a generated parity database, keyed by type name"""
    engine = _create_engine_for_database(database_name)
    try:
        async with engine.connect() as conn:
            # Fetch every public enum type and its labels created by Alembic
            result = await conn.execute(
                text(
                    """
                    SELECT t.typname AS type_name, e.enumlabel AS label
                    FROM pg_type t
                    JOIN pg_enum e ON e.enumtypid = t.oid
                    JOIN pg_namespace n ON n.oid = t.typnamespace
                    WHERE n.nspname = 'public'
                    """,
                ),
            )
            labels_by_type: dict[str, set[str]] = {}
            for row in result:
                labels_by_type.setdefault(row.type_name, set()).add(row.label)
            return labels_by_type
    finally:
        await engine.dispose()


def _get_model_enums() -> dict[str, set[str]]:
    """Return SQLAlchemy model enum labels keyed by type name, deduped across columns"""
    labels_by_type: dict[str, set[str]] = {}
    for table in Base.metadata.sorted_tables:
        for column in table.columns:
            if isinstance(column.type, SqlaEnum):
                labels_by_type[column.type.name] = set(column.type.enums)
    return labels_by_type


def _create_engine_for_database(database_name: str, *, isolation_level: str | None = None):
    """Create an async engine for a test database"""
    database_url = f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{database_name}"
    engine = create_async_engine(database_url, poolclass=NullPool, isolation_level=isolation_level)
    return engine


def _create_app_role_engine(database_name: str):
    """Create an async engine for a test database connecting as the runtime app role"""
    password = resolve_role_password("app", generate=False)
    database_url = f"postgresql+asyncpg://{APP_DB_USER}:{password}@{DB_HOST}:{DB_PORT}/{database_name}"
    return create_async_engine(database_url, poolclass=NullPool)


async def test_system_merchant_migration_folds_everyones_own_myself() -> None:
    """Verify the fold keeps transactions and removes the duplicates, whatever their capitalisation"""
    await _recreate_database(_ALEMBIC_SYSTEM_MERCHANT_DB_NAME)
    try:
        _run_alembic_upgrade(_ALEMBIC_SYSTEM_MERCHANT_DB_NAME, revision=_BEFORE_SYSTEM_MERCHANTS_REVISION)
        transaction_id = await _seed_own_myself_merchant(_ALEMBIC_SYSTEM_MERCHANT_DB_NAME)

        _run_alembic_upgrade(_ALEMBIC_SYSTEM_MERCHANT_DB_NAME)

        engine = _create_engine_for_database(_ALEMBIC_SYSTEM_MERCHANT_DB_NAME)
        try:
            async with engine.connect() as conn:
                system_merchants = (
                    await conn.execute(
                        text(
                            "SELECT id, name FROM merchants WHERE is_system = true",
                        )
                    )
                ).all()
                remaining_own = (
                    await conn.execute(
                        text(
                            "SELECT count(*) FROM merchants WHERE is_system = false",
                        )
                    )
                ).scalar_one()
                merchant_on_transaction = (
                    await conn.execute(
                        text("SELECT merchant_id FROM transactions WHERE id = :id"),
                        {"id": transaction_id},
                    )
                ).scalar_one()
        finally:
            await engine.dispose()

        # Compared as a set, since the query states no order and the app ships more than one
        merchant_ids_by_name = {name: merchant_id for merchant_id, name in system_merchants}
        assert set(merchant_ids_by_name) == set(SYSTEM_MERCHANT_NAMES)
        assert remaining_own == 0
        assert merchant_on_transaction == merchant_ids_by_name[SELF_MERCHANT_NAME]
    finally:
        await _drop_database(_ALEMBIC_SYSTEM_MERCHANT_DB_NAME)


async def test_unknown_merchant_migration_folds_a_personal_one_and_spares_a_group_one() -> None:
    """Verify the fold takes a user's own Unknown and leaves a group's alone"""
    await _recreate_database(_ALEMBIC_UNKNOWN_MERCHANT_DB_NAME)
    try:
        _run_alembic_upgrade(_ALEMBIC_UNKNOWN_MERCHANT_DB_NAME, revision=_BEFORE_UNKNOWN_MERCHANT_REVISION)
        seeded = await _seed_own_unknown_merchants(_ALEMBIC_UNKNOWN_MERCHANT_DB_NAME)

        _run_alembic_upgrade(_ALEMBIC_UNKNOWN_MERCHANT_DB_NAME)

        engine = _create_engine_for_database(_ALEMBIC_UNKNOWN_MERCHANT_DB_NAME)
        try:
            async with engine.connect() as conn:
                system_merchant_id = (
                    await conn.execute(
                        text("SELECT id FROM merchants WHERE is_system = true AND name = :name"),
                        {"name": UNKNOWN_MERCHANT_NAME},
                    )
                ).scalar_one()
                merchant_on_transaction = (
                    await conn.execute(
                        text("SELECT merchant_id FROM transactions WHERE id = :id"),
                        {"id": seeded["transaction_id"]},
                    )
                ).scalar_one()
                personal_remaining = (
                    await conn.execute(
                        text("SELECT count(*) FROM merchants WHERE id = :id"),
                        {"id": seeded["personal_merchant_id"]},
                    )
                ).scalar_one()
                group_remaining = (
                    await conn.execute(
                        text("SELECT count(*) FROM merchants WHERE id = :id"),
                        {"id": seeded["group_merchant_id"]},
                    )
                ).scalar_one()
        finally:
            await engine.dispose()

        # The transaction that pointed at the user's own spelling now points at the shared merchant,
        # and their own row is gone
        assert merchant_on_transaction == system_merchant_id
        assert personal_remaining == 0

        # A group's merchant is left alone, since taking one from a group is a decision nobody has
        # made and folding it could not be undone
        assert group_remaining == 1
    finally:
        await _drop_database(_ALEMBIC_UNKNOWN_MERCHANT_DB_NAME)


async def _seed_own_unknown_merchants(database_name: str) -> dict[str, UUID]:
    """Insert a personal merchant spelled UNKNOWN carrying a transaction, and a group-owned one

    Returns:
        The identifiers the fold is judged against
    """
    user_id = UUID("11111111-2222-4333-8444-555555555555")
    group_id = UUID("22222222-3333-4444-8555-666666666666")
    account_id = UUID("33333333-4444-4555-8666-777777777777")
    category_id = UUID("44444444-5555-4666-8777-888888888888")
    personal_merchant_id = UUID("55555555-6666-4777-8888-999999999999")
    group_merchant_id = UUID("66666666-7777-4888-8999-aaaaaaaaaaaa")
    transaction_id = UUID("77777777-8888-4999-8aaa-bbbbbbbbbbbb")

    engine = _create_engine_for_database(database_name)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO currencies (id, name, symbol, minor_unit_exponent) VALUES ('CAD', 'Canadian Dollar', '$', 2)",
                )
            )
            await conn.execute(
                text(
                    "INSERT INTO users (id, email, first_name, tz, base_currency)"
                    " VALUES (:user_id, 'migration-unknown@example.com', 'Migration', 'America/Toronto', 'CAD')",
                ),
                {"user_id": user_id},
            )
            await conn.execute(
                text("INSERT INTO groups (id, owner_id, name) VALUES (:group_id, :user_id, 'Household')"),
                {"group_id": group_id, "user_id": user_id},
            )
            await conn.execute(
                text(
                    "INSERT INTO accounts"
                    " (id, owner_id, account_kind, account_type, name, currency, is_archived)"
                    " VALUES (:account_id, :user_id, 'ASSET', 'CHECKING', 'Chequing', 'CAD', false)",
                ),
                {"account_id": account_id, "user_id": user_id},
            )
            await conn.execute(
                text(
                    "INSERT INTO categories (id, owner_id, name, kind, is_system)"
                    " VALUES (:category_id, :user_id, 'Shopping', 'EXPENSE', false)",
                ),
                {"category_id": category_id, "user_id": user_id},
            )

            # Spelled in capitals, which the fold has to catch as the same intent
            await conn.execute(
                text("INSERT INTO merchants (id, owner_id, name) VALUES (:merchant_id, :user_id, 'UNKNOWN')"),
                {"merchant_id": personal_merchant_id, "user_id": user_id},
            )
            await conn.execute(
                text(
                    "INSERT INTO merchants (id, owner_id, group_id, name) VALUES (:merchant_id, :user_id, :group_id, :name)",
                ),
                {
                    "merchant_id": group_merchant_id,
                    "user_id": user_id,
                    "group_id": group_id,
                    "name": UNKNOWN_MERCHANT_NAME,
                },
            )
            await conn.execute(
                text(
                    "INSERT INTO transactions"
                    " (id, created_by_user_id, account_id, dt, merchant_id, category_id, amount, currency)"
                    " VALUES (:transaction_id, :user_id, :account_id, '2026-03-15', :merchant_id,"
                    " :category_id, -2500, 'CAD')",
                ),
                {
                    "transaction_id": transaction_id,
                    "user_id": user_id,
                    "account_id": account_id,
                    "merchant_id": personal_merchant_id,
                    "category_id": category_id,
                },
            )
    finally:
        await engine.dispose()

    return {
        "transaction_id": transaction_id,
        "personal_merchant_id": personal_merchant_id,
        "group_merchant_id": group_merchant_id,
    }


async def test_folded_name_migration_merges_categories_and_numbers_the_ones_recording_opposite_kinds() -> None:
    """Verify the fold merges within a kind, numbers across kinds, trims, and leaves other scopes alone

    Every case is seeded into one database and judged after a single upgrade, since each build of one
    runs alembic through a subprocess and the cases do not interfere: they use separate names
    """
    await _recreate_database(_ALEMBIC_FOLDED_CATEGORY_DB_NAME)
    try:
        _run_alembic_upgrade(_ALEMBIC_FOLDED_CATEGORY_DB_NAME, revision=_BEFORE_FOLDED_NAMES_REVISION)
        seeded = await _seed_categories_differing_only_in_capitals(_ALEMBIC_FOLDED_CATEGORY_DB_NAME)

        _run_alembic_upgrade(_ALEMBIC_FOLDED_CATEGORY_DB_NAME)

        engine = _create_engine_for_database(_ALEMBIC_FOLDED_CATEGORY_DB_NAME)
        try:
            async with engine.connect() as conn:
                grocery_ids = (
                    (
                        await conn.execute(
                            text(
                                "SELECT id FROM categories WHERE owner_id = :user_id AND group_id IS NULL AND lower(name) = 'groceries'",
                            ),
                            {"user_id": seeded["user_id"]},
                        )
                    )
                    .scalars()
                    .all()
                )
                grocery_transaction_categories = (
                    (
                        await conn.execute(
                            text("SELECT category_id FROM transactions WHERE id = ANY(:ids)"),
                            {"ids": [seeded["older_grocery_transaction_id"], seeded["newer_grocery_transaction_id"]]},
                        )
                    )
                    .scalars()
                    .all()
                )
                active_tracked_rows = (
                    await conn.execute(
                        text(
                            "SELECT base_budget_id, count(*) FROM budget_tracked_categories WHERE removed_at IS NULL GROUP BY base_budget_id",
                        ),
                    )
                ).all()
                tabbed_name = (
                    await conn.execute(
                        text("SELECT name FROM categories WHERE id = :id"),
                        {"id": seeded["tabbed_snacks_id"]},
                    )
                ).scalar_one()
                staged_category_id = (
                    await conn.execute(
                        text(
                            "SELECT category_mappings->'GROCERIES'->>'category_id' FROM import_runs WHERE id = :id",
                        ),
                        {"id": seeded["import_run_id"]},
                    )
                ).scalar_one()
                bonus_names = dict(
                    (
                        await conn.execute(
                            text("SELECT id, name FROM categories WHERE id = ANY(:ids)"),
                            {"ids": [seeded["income_bonus_id"], seeded["expense_bonus_id"]]},
                        )
                    ).all()
                )
                expense_bonus_transaction_category = (
                    await conn.execute(
                        text("SELECT category_id FROM transactions WHERE id = :id"),
                        {"id": seeded["expense_bonus_transaction_id"]},
                    )
                ).scalar_one()
                dining = (
                    await conn.execute(
                        text(
                            "SELECT id, name FROM categories WHERE owner_id = :user_id AND group_id IS NULL AND lower(name) = 'dining'",
                        ),
                        {"user_id": seeded["user_id"]},
                    )
                ).all()
                group_category_remaining = (
                    await conn.execute(
                        text("SELECT count(*) FROM categories WHERE id = :id"),
                        {"id": seeded["group_grocery_id"]},
                    )
                ).scalar_one()
                adjustment_row = (
                    await conn.execute(
                        text(
                            "SELECT category_id, counterparty_account_id, counterparty_account_scope FROM transactions WHERE id = :id",
                        ),
                        {"id": seeded["adjustment_transaction_id"]},
                    )
                ).one()
        finally:
            await engine.dispose()

        # Groceries and GROCERIES record the same kind, so the later one is merged into the older and
        # both transactions follow it
        assert grocery_ids == [seeded["older_grocery_id"]]
        assert set(grocery_transaction_categories) == {seeded["older_grocery_id"]}

        # One row each, whether the budget tracked the survivor beside its losers or the losers alone
        assert dict(active_tracked_rows) == {
            seeded["base_budget_id"]: 1,
            seeded["losers_only_budget_id"]: 1,
        }

        # Trimming takes off every kind of surrounding whitespace, not the space character alone,
        # or the routes would compare a trimmed name against one still holding a tab and never match
        assert tabbed_name == "Snacks"

        # An import staged before the upgrade now points at the category that survived, so its
        # commit still resolves rather than refusing the whole file for a category that is gone
        assert staged_category_id == str(seeded["older_grocery_id"])

        # An income Bonus and an expense bonus mean different things, so both survive and the later
        # one is numbered rather than merged, leaving its transactions where they were
        assert bonus_names == {seeded["income_bonus_id"]: "Bonus", seeded["expense_bonus_id"]: "bonus (2)"}
        assert expense_bonus_transaction_category == seeded["expense_bonus_id"]

        # Trimming happens first, so a name stored with a trailing space collides with the plain one
        # and is folded like any other pair
        assert dining == [(seeded["spaced_dining_id"], "Dining")]

        # A group's category shares no scope with a personal one, so it is untouched
        assert group_category_remaining == 1

        # Balance Adjustment records no counterparty account, so a transaction moving onto it loses
        # the account it recorded, exactly as editing one onto that category by hand does
        assert adjustment_row == (seeded["older_adjustment_id"], None, None)

        await _assert_second_category_differing_only_in_capitals_is_refused(
            _ALEMBIC_FOLDED_CATEGORY_DB_NAME,
            seeded["user_id"],
        )
    finally:
        await _drop_database(_ALEMBIC_FOLDED_CATEGORY_DB_NAME)


async def test_folded_name_migration_merges_merchants_differing_only_in_capitals() -> None:
    """Verify merchants fold onto the oldest and the index then refuses a second spelling"""
    await _recreate_database(_ALEMBIC_FOLDED_MERCHANT_DB_NAME)
    try:
        _run_alembic_upgrade(_ALEMBIC_FOLDED_MERCHANT_DB_NAME, revision=_BEFORE_FOLDED_NAMES_REVISION)
        seeded = await _seed_merchants_differing_only_in_capitals(_ALEMBIC_FOLDED_MERCHANT_DB_NAME)

        _run_alembic_upgrade(_ALEMBIC_FOLDED_MERCHANT_DB_NAME)

        engine = _create_engine_for_database(_ALEMBIC_FOLDED_MERCHANT_DB_NAME)
        try:
            async with engine.connect() as conn:
                remaining = (
                    await conn.execute(
                        text(
                            "SELECT id, name FROM merchants WHERE owner_id = :user_id AND group_id IS NULL AND lower(name) = 'amazon'",
                        ),
                        {"user_id": seeded["user_id"]},
                    )
                ).all()
                group_remaining = (
                    await conn.execute(
                        text("SELECT id, name FROM merchants WHERE group_id = :group_id"),
                        {"group_id": seeded["group_id"]},
                    )
                ).all()
                group_transaction_merchant = (
                    await conn.execute(
                        text("SELECT merchant_id FROM transactions WHERE id = :id"),
                        {"id": seeded["group_transaction_id"]},
                    )
                ).scalar_one()
                merchants_on_transactions = (
                    (
                        await conn.execute(
                            text("SELECT merchant_id FROM transactions WHERE id = ANY(:ids)"),
                            {"ids": [seeded["older_transaction_id"], seeded["newer_transaction_id"]]},
                        )
                    )
                    .scalars()
                    .all()
                )
        finally:
            await engine.dispose()

        # The later spelling is gone and both transactions point at the one that was there first
        assert remaining == [(seeded["older_merchant_id"], "Amazon")]
        assert set(merchants_on_transactions) == {seeded["older_merchant_id"]}

        # A group's merchants are unique per group whoever owns them, so two members' spellings fold
        # into one. Grouping them by owner instead would leave the pair the group index forbids and
        # the upgrade would fail building it
        assert group_remaining == [(seeded["older_group_merchant_id"], "Hardware")]
        assert group_transaction_merchant == seeded["older_group_merchant_id"]

        await _assert_second_merchant_differing_only_in_capitals_is_refused(
            _ALEMBIC_FOLDED_MERCHANT_DB_NAME,
            seeded["user_id"],
        )
    finally:
        await _drop_database(_ALEMBIC_FOLDED_MERCHANT_DB_NAME)


async def _assert_second_category_differing_only_in_capitals_is_refused(
    database_name: str,
    user_id: UUID,
) -> None:
    """Check the database itself refuses the pair, not only the routes

    Written straight to the table, since this is about what the index allows rather than what a
    route checks. Without it the migration could fold correctly and build no index at all, and every
    other assertion here would still pass
    """
    engine = _create_engine_for_database(database_name)
    try:
        with pytest.raises(IntegrityError):
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        "INSERT INTO categories (id, owner_id, name, kind, is_system)"
                        " VALUES (gen_random_uuid(), :user_id, 'GROCERIES', 'EXPENSE', false)",
                    ),
                    {"user_id": user_id},
                )
    finally:
        await engine.dispose()


async def _assert_second_merchant_differing_only_in_capitals_is_refused(
    database_name: str,
    user_id: UUID,
) -> None:
    """Check the database itself refuses the pair, not only the routes"""
    engine = _create_engine_for_database(database_name)
    try:
        with pytest.raises(IntegrityError):
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        "INSERT INTO merchants (id, owner_id, name) VALUES (gen_random_uuid(), :user_id, 'amazon')",
                    ),
                    {"user_id": user_id},
                )
    finally:
        await engine.dispose()


async def _seed_own_myself_merchant(database_name: str) -> UUID:
    """Insert a user-owned merchant spelled MYSELF, carrying one transaction

    Returns:
        Identifier of the transaction that should survive the fold
    """
    user_id = UUID("44444444-4444-4444-8444-444444444444")
    account_id = UUID("55555555-5555-4555-8555-555555555555")
    category_id = UUID("66666666-6666-4666-8666-666666666666")
    merchant_id = UUID("77777777-7777-4777-8777-777777777777")
    transaction_id = UUID("88888888-8888-4888-8888-888888888888")

    engine = _create_engine_for_database(database_name)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO currencies (id, name, symbol, minor_unit_exponent) VALUES ('CAD', 'Canadian Dollar', '$', 2)",
                )
            )
            await conn.execute(
                text(
                    "INSERT INTO users (id, email, first_name, tz, base_currency)"
                    " VALUES (:user_id, 'migration-merchant@example.com', 'Migration', 'America/Toronto', 'CAD')",
                ),
                {"user_id": user_id},
            )
            await conn.execute(
                text(
                    "INSERT INTO accounts"
                    " (id, owner_id, account_kind, account_type, name, currency, is_archived)"
                    " VALUES (:account_id, :user_id, 'ASSET', 'CHECKING', 'Chequing', 'CAD', false)",
                ),
                {"account_id": account_id, "user_id": user_id},
            )
            await conn.execute(
                text(
                    "INSERT INTO categories (id, owner_id, name, kind, is_system)"
                    " VALUES (:category_id, :user_id, 'Moving money', 'TRANSFER', false)",
                ),
                {"category_id": category_id, "user_id": user_id},
            )

            # Spelled in capitals, which the fold has to catch as the same intent
            await conn.execute(
                text(
                    "INSERT INTO merchants (id, owner_id, name) VALUES (:merchant_id, :user_id, 'MYSELF')",
                ),
                {"merchant_id": merchant_id, "user_id": user_id},
            )
            await conn.execute(
                text(
                    "INSERT INTO transactions"
                    " (id, created_by_user_id, account_id, dt, merchant_id, category_id, amount, currency)"
                    " VALUES (:transaction_id, :user_id, :account_id, '2026-03-15', :merchant_id,"
                    " :category_id, -5000, 'CAD')",
                ),
                {
                    "transaction_id": transaction_id,
                    "user_id": user_id,
                    "account_id": account_id,
                    "merchant_id": merchant_id,
                    "category_id": category_id,
                },
            )
    finally:
        await engine.dispose()
    return transaction_id


async def _seed_categories_differing_only_in_capitals(database_name: str) -> dict[str, UUID]:
    """Insert every shape of category collision the fold has to settle

    Four pairs, each a case of its own: two expense categories spelled differently, an income and an
    expense sharing a name, one stored with a trailing space beside the plain spelling, and a
    personal category beside a group's of the same name. The Balance Adjustment pair carries a
    transaction recording a counterparty account, which moving onto that category has to drop

    Returns:
        The identifiers the fold is judged against
    """
    ids = {
        "user_id": UUID("aaaaaaaa-1111-4111-8111-111111111111"),
        "group_id": UUID("aaaaaaaa-2222-4222-8222-222222222222"),
        "account_id": UUID("aaaaaaaa-3333-4333-8333-333333333333"),
        "counterparty_account_id": UUID("aaaaaaaa-4444-4444-8444-444444444444"),
        "older_grocery_id": UUID("bbbbbbbb-1111-4111-8111-111111111111"),
        "newer_grocery_id": UUID("bbbbbbbb-2222-4222-8222-222222222222"),
        "income_bonus_id": UUID("bbbbbbbb-3333-4333-8333-333333333333"),
        "expense_bonus_id": UUID("bbbbbbbb-4444-4444-8444-444444444444"),
        "spaced_dining_id": UUID("bbbbbbbb-5555-4555-8555-555555555555"),
        "third_grocery_id": UUID("bbbbbbbb-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        "tabbed_snacks_id": UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
        "plain_dining_id": UUID("bbbbbbbb-6666-4666-8666-666666666666"),
        "group_grocery_id": UUID("bbbbbbbb-7777-4777-8777-777777777777"),
        "older_adjustment_id": UUID("bbbbbbbb-8888-4888-8888-888888888888"),
        "newer_adjustment_id": UUID("bbbbbbbb-9999-4999-8999-999999999999"),
        "older_grocery_transaction_id": UUID("cccccccc-1111-4111-8111-111111111111"),
        "newer_grocery_transaction_id": UUID("cccccccc-2222-4222-8222-222222222222"),
        "income_bonus_transaction_id": UUID("cccccccc-3333-4333-8333-333333333333"),
        "expense_bonus_transaction_id": UUID("cccccccc-4444-4444-8444-444444444444"),
        "adjustment_transaction_id": UUID("cccccccc-5555-4555-8555-555555555555"),
        "base_budget_id": UUID("dddddddd-1111-4111-8111-111111111111"),
        "losers_only_budget_id": UUID("dddddddd-2222-4222-8222-222222222222"),
        "import_run_id": UUID("dddddddd-3333-4333-8333-333333333333"),
    }

    # Each pair is stamped a day apart, so which one the fold keeps is settled by the data rather
    # than by the order the rows happen to come back in
    first_day = datetime(2026, 1, 1, tzinfo=UTC)
    second_day = datetime(2026, 1, 2, tzinfo=UTC)
    third_day = datetime(2026, 1, 3, tzinfo=UTC)
    categories = [
        (ids["older_grocery_id"], ids["user_id"], None, "Groceries", "EXPENSE", first_day),
        (ids["newer_grocery_id"], ids["user_id"], None, "GROCERIES", "EXPENSE", second_day),
        (ids["third_grocery_id"], ids["user_id"], None, "groceries", "EXPENSE", third_day),
        # Stored with a tab on the end, which btrim with no character set would leave in place
        (ids["tabbed_snacks_id"], ids["user_id"], None, "Snacks\t", "EXPENSE", first_day),
        (ids["income_bonus_id"], ids["user_id"], None, "Bonus", "INCOME", first_day),
        (ids["expense_bonus_id"], ids["user_id"], None, "bonus", "EXPENSE", second_day),
        (ids["spaced_dining_id"], ids["user_id"], None, "Dining ", "EXPENSE", first_day),
        (ids["plain_dining_id"], ids["user_id"], None, "Dining", "EXPENSE", second_day),
        (ids["group_grocery_id"], None, ids["group_id"], "Groceries", "EXPENSE", first_day),
        (ids["older_adjustment_id"], ids["user_id"], None, "Balance Adjustment", "TRANSFER", first_day),
        (ids["newer_adjustment_id"], ids["user_id"], None, "BALANCE ADJUSTMENT", "TRANSFER", second_day),
    ]

    engine = _create_engine_for_database(database_name)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO currencies (id, name, symbol, minor_unit_exponent) VALUES ('CAD', 'Canadian Dollar', '$', 2)",
                )
            )
            await conn.execute(
                text(
                    "INSERT INTO users (id, email, first_name, tz, base_currency)"
                    " VALUES (:user_id, 'migration-folded@example.com', 'Migration', 'America/Toronto', 'CAD')",
                ),
                {"user_id": ids["user_id"]},
            )
            await conn.execute(
                text("INSERT INTO groups (id, owner_id, name) VALUES (:group_id, :user_id, 'Household')"),
                {"group_id": ids["group_id"], "user_id": ids["user_id"]},
            )
            for account_id, account_name in (
                (ids["account_id"], "Chequing"),
                (ids["counterparty_account_id"], "Savings"),
            ):
                await conn.execute(
                    text(
                        "INSERT INTO accounts"
                        " (id, owner_id, account_kind, account_type, name, currency, is_archived)"
                        " VALUES (:account_id, :user_id, 'ASSET', 'CHECKING', :name, 'CAD', false)",
                    ),
                    {"account_id": account_id, "user_id": ids["user_id"], "name": account_name},
                )

            for category_id, owner_id, group_id, name, kind, created_at in categories:
                await conn.execute(
                    text(
                        "INSERT INTO categories (id, owner_id, group_id, name, kind, is_system, created_at)"
                        " VALUES (:id, :owner_id, :group_id, :name, :kind, false, :created_at)",
                    ),
                    {
                        "id": category_id,
                        "owner_id": owner_id,
                        "group_id": group_id,
                        "name": name,
                        "kind": kind,
                        "created_at": created_at,
                    },
                )

            for transaction_id, category_id in (
                (ids["older_grocery_transaction_id"], ids["older_grocery_id"]),
                (ids["newer_grocery_transaction_id"], ids["newer_grocery_id"]),
                (ids["income_bonus_transaction_id"], ids["income_bonus_id"]),
                (ids["expense_bonus_transaction_id"], ids["expense_bonus_id"]),
            ):
                await conn.execute(
                    text(
                        "INSERT INTO transactions"
                        " (id, created_by_user_id, account_id, dt, category_id, amount, currency)"
                        " VALUES (:id, :user_id, :account_id, '2026-03-15', :category_id, -2500, 'CAD')",
                    ),
                    {
                        "id": transaction_id,
                        "user_id": ids["user_id"],
                        "account_id": ids["account_id"],
                        "category_id": category_id,
                    },
                )

            # Filed under the later spelling of Balance Adjustment, which does record a counterparty
            # account because its name is not the one the rule names
            await conn.execute(
                text(
                    "INSERT INTO transactions"
                    " (id, created_by_user_id, account_id, dt, category_id, amount, currency,"
                    " counterparty_account_id, counterparty_account_scope)"
                    " VALUES (:id, :user_id, :account_id, '2026-03-16', :category_id, -1000, 'CAD',"
                    " :counterparty_account_id, 'TRACKED')",
                ),
                {
                    "id": ids["adjustment_transaction_id"],
                    "user_id": ids["user_id"],
                    "account_id": ids["account_id"],
                    "category_id": ids["newer_adjustment_id"],
                    "counterparty_account_id": ids["counterparty_account_id"],
                },
            )

            for budget_id, budget_name in (
                (ids["base_budget_id"], "Monthly"),
                (ids["losers_only_budget_id"], "Groceries only"),
            ):
                await conn.execute(
                    text(
                        "INSERT INTO base_budgets"
                        " (id, owner_id, name, currency, recurrence_freq, instance_length, recurs, is_archived)"
                        " VALUES (:id, :user_id, :name, 'CAD', 'MONTHLY', 1, true, false)",
                    ),
                    {"id": budget_id, "user_id": ids["user_id"], "name": budget_name},
                )

            # One budget tracks the survivor and both losers, the other tracks the two losers alone.
            # Either way the survivor can only be tracked once, so the fold has to drop rows rather
            # than move every one of them
            tracked = [
                (ids["base_budget_id"], ids["older_grocery_id"]),
                (ids["base_budget_id"], ids["newer_grocery_id"]),
                (ids["base_budget_id"], ids["third_grocery_id"]),
                (ids["losers_only_budget_id"], ids["newer_grocery_id"]),
                (ids["losers_only_budget_id"], ids["third_grocery_id"]),
            ]
            for budget_id, category_id in tracked:
                await conn.execute(
                    text(
                        "INSERT INTO budget_tracked_categories (id, base_budget_id, category_id, added_at)"
                        " VALUES (gen_random_uuid(), :budget_id, :category_id, '2026-01-01')",
                    ),
                    {"budget_id": budget_id, "category_id": category_id},
                )

            # An import staged before the upgrade, holding the id of a category the fold removes.
            # Nothing links this to the categories table, so only the migration can keep it usable
            await conn.execute(
                text(
                    "INSERT INTO import_runs"
                    " (id, owner_id, expected_transaction_count, account_mappings, category_mappings)"
                    " VALUES (:id, :user_id, 1, '{}'::jsonb, CAST(:category_mappings AS jsonb))",
                ),
                {
                    "id": ids["import_run_id"],
                    "user_id": ids["user_id"],
                    "category_mappings": ('{"GROCERIES": {"source": "GROCERIES", "category_id": "' + str(ids["newer_grocery_id"]) + '"}}'),
                },
            )
    finally:
        await engine.dispose()

    return ids


async def _seed_merchants_differing_only_in_capitals(database_name: str) -> dict[str, UUID]:
    """Insert two personal merchants spelled differently, each carrying a transaction

    Returns:
        The identifiers the fold is judged against
    """
    ids = {
        "user_id": UUID("eeeeeeee-1111-4111-8111-111111111111"),
        "other_user_id": UUID("eeeeeeee-5555-4555-8555-555555555555"),
        "group_id": UUID("eeeeeeee-6666-4666-8666-666666666666"),
        "account_id": UUID("eeeeeeee-2222-4222-8222-222222222222"),
        "category_id": UUID("eeeeeeee-3333-4333-8333-333333333333"),
        "older_merchant_id": UUID("ffffffff-1111-4111-8111-111111111111"),
        "newer_merchant_id": UUID("ffffffff-2222-4222-8222-222222222222"),
        "older_transaction_id": UUID("ffffffff-3333-4333-8333-333333333333"),
        "newer_transaction_id": UUID("ffffffff-4444-4444-8444-444444444444"),
        "older_group_merchant_id": UUID("ffffffff-5555-4555-8555-555555555555"),
        "newer_group_merchant_id": UUID("ffffffff-6666-4666-8666-666666666666"),
        "group_transaction_id": UUID("ffffffff-7777-4777-8777-777777777777"),
    }

    engine = _create_engine_for_database(database_name)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO currencies (id, name, symbol, minor_unit_exponent) VALUES ('CAD', 'Canadian Dollar', '$', 2)",
                )
            )
            await conn.execute(
                text(
                    "INSERT INTO users (id, email, first_name, tz, base_currency)"
                    " VALUES (:user_id, 'migration-folded-merchant@example.com', 'Migration',"
                    " 'America/Toronto', 'CAD')",
                ),
                {"user_id": ids["user_id"]},
            )
            await conn.execute(
                text(
                    "INSERT INTO accounts"
                    " (id, owner_id, account_kind, account_type, name, currency, is_archived)"
                    " VALUES (:account_id, :user_id, 'ASSET', 'CHECKING', 'Chequing', 'CAD', false)",
                ),
                {"account_id": ids["account_id"], "user_id": ids["user_id"]},
            )
            await conn.execute(
                text(
                    "INSERT INTO categories (id, owner_id, name, kind, is_system)"
                    " VALUES (:category_id, :user_id, 'Shopping', 'EXPENSE', false)",
                ),
                {"category_id": ids["category_id"], "user_id": ids["user_id"]},
            )

            # A day apart, so the older spelling is the one the fold keeps rather than whichever row
            # the database returns first
            for merchant_id, name, created_at in (
                (ids["older_merchant_id"], "Amazon", datetime(2026, 1, 1, tzinfo=UTC)),
                (ids["newer_merchant_id"], "AMAZON", datetime(2026, 1, 2, tzinfo=UTC)),
            ):
                await conn.execute(
                    text(
                        "INSERT INTO merchants (id, owner_id, name, created_at) VALUES (:id, :user_id, :name, :created_at)",
                    ),
                    {"id": merchant_id, "user_id": ids["user_id"], "name": name, "created_at": created_at},
                )

            # A second member of the same group, since a group's merchant carries an owner as well
            # as its group and the two members' merchants are what the group index measures together
            await conn.execute(
                text(
                    "INSERT INTO users (id, email, first_name, tz, base_currency)"
                    " VALUES (:user_id, 'migration-folded-member@example.com', 'Member',"
                    " 'America/Toronto', 'CAD')",
                ),
                {"user_id": ids["other_user_id"]},
            )
            await conn.execute(
                text("INSERT INTO groups (id, owner_id, name) VALUES (:group_id, :user_id, 'Household')"),
                {"group_id": ids["group_id"], "user_id": ids["user_id"]},
            )
            for merchant_id, owner_id, name, created_at in (
                (ids["older_group_merchant_id"], ids["user_id"], "Hardware", datetime(2026, 1, 1, tzinfo=UTC)),
                (ids["newer_group_merchant_id"], ids["other_user_id"], "HARDWARE", datetime(2026, 1, 2, tzinfo=UTC)),
            ):
                await conn.execute(
                    text(
                        "INSERT INTO merchants (id, owner_id, group_id, name, created_at)"
                        " VALUES (:id, :owner_id, :group_id, :name, :created_at)",
                    ),
                    {
                        "id": merchant_id,
                        "owner_id": owner_id,
                        "group_id": ids["group_id"],
                        "name": name,
                        "created_at": created_at,
                    },
                )

            for transaction_id, merchant_id in (
                (ids["older_transaction_id"], ids["older_merchant_id"]),
                (ids["newer_transaction_id"], ids["newer_merchant_id"]),
                (ids["group_transaction_id"], ids["newer_group_merchant_id"]),
            ):
                await conn.execute(
                    text(
                        "INSERT INTO transactions"
                        " (id, created_by_user_id, account_id, dt, merchant_id, category_id, amount, currency)"
                        " VALUES (:id, :user_id, :account_id, '2026-03-15', :merchant_id, :category_id,"
                        " -2500, 'CAD')",
                    ),
                    {
                        "id": transaction_id,
                        "user_id": ids["user_id"],
                        "account_id": ids["account_id"],
                        "merchant_id": merchant_id,
                        "category_id": ids["category_id"],
                    },
                )
    finally:
        await engine.dispose()

    return ids


async def test_reset_request_migration_keeps_named_rows_through_downgrade_and_upgrade() -> None:
    """Verify rows naming a user survive a round trip, and rows naming nobody go on the downgrade"""
    await _recreate_database(_ALEMBIC_RESET_REQUEST_DB_NAME)
    user_id = "11111111-1111-4111-8111-111111111111"
    named_id = "33333333-3333-4333-8333-333333333333"
    userless_id = "44444444-4444-4444-8444-444444444444"
    insert_row = text(
        "INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (:id, :user_id, :token_hash, now() + interval '1 hour')"
    )
    try:
        _run_alembic_upgrade(_ALEMBIC_RESET_REQUEST_DB_NAME, revision=_BEFORE_RESET_REQUEST_REVISION)
        engine = _create_engine_for_database(_ALEMBIC_RESET_REQUEST_DB_NAME)
        try:
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        "INSERT INTO currencies (id, name, symbol, minor_unit_exponent)"
                        " VALUES ('CAD', 'Canadian Dollar', '$', 2) ON CONFLICT (id) DO NOTHING",
                    )
                )
                await conn.execute(
                    text(
                        "INSERT INTO users (id, email, first_name, tz, base_currency)"
                        " VALUES (:id, 'reset-migration@example.com', 'Reset', 'UTC', 'CAD')",
                    ),
                    {"id": user_id},
                )
                await conn.execute(insert_row, {"id": named_id, "user_id": user_id, "token_hash": "named"})

            # Upgrading leaves the existing row counting, and lets a request that sent nothing name nobody
            _run_alembic_upgrade(_ALEMBIC_RESET_REQUEST_DB_NAME)
            async with engine.begin() as conn:
                await conn.execute(insert_row, {"id": userless_id, "user_id": None, "token_hash": "userless"})
            async with engine.connect() as conn:
                assert await _read_reset_token_ids(conn) == {named_id, userless_id}

            # Downgrading deletes only the rows that name nobody, then requires a user again
            _run_alembic_downgrade(_ALEMBIC_RESET_REQUEST_DB_NAME, _BEFORE_RESET_REQUEST_REVISION)
            async with engine.connect() as conn:
                assert await _read_reset_token_ids(conn) == {named_id}
                assert await _reset_token_user_is_nullable(conn) is False

            _run_alembic_upgrade(_ALEMBIC_RESET_REQUEST_DB_NAME)
            async with engine.connect() as conn:
                assert await _read_reset_token_ids(conn) == {named_id}
                assert await _reset_token_user_is_nullable(conn) is True
                created_at_index = (
                    await conn.execute(text("SELECT count(*) FROM pg_indexes WHERE indexname = 'ix_password_reset_tokens_created_at'"))
                ).scalar_one()
                assert created_at_index == 1
        finally:
            await engine.dispose()
    finally:
        await _drop_database(_ALEMBIC_RESET_REQUEST_DB_NAME)


async def _read_reset_token_ids(conn: AsyncConnection) -> set[str]:
    """Return the ids of every stored reset token"""
    return {str(row[0]) for row in await conn.execute(text("SELECT id FROM password_reset_tokens"))}


async def _reset_token_user_is_nullable(conn: AsyncConnection) -> bool:
    """Return whether a reset token may name no user"""
    nullable = (
        await conn.execute(
            text("SELECT is_nullable FROM information_schema.columns WHERE table_name = 'password_reset_tokens' AND column_name = 'user_id'")
        )
    ).scalar_one()
    return nullable == "YES"
