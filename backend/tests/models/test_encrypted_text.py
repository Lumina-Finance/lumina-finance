"""Encrypted column label and discovery tests"""

from sqlalchemy import Column, Integer, MetaData, Table, Text
from sqlalchemy.dialects import postgresql

from app.models.base import Base
from app.models.types import EncryptedText, find_encrypted_columns

# The columns holding a Fernet token today. A new one belongs here and in the model
_EXPECTED_ENCRYPTED_COLUMNS = [
    ("oidc_providers", "client_secret_encrypted"),
    ("totp_credentials", "secret_encrypted"),
]


def test_encrypted_text_renders_as_text():
    """The label changes no DDL, so applying it to an existing column needs no migration"""
    assert EncryptedText().compile(dialect=postgresql.dialect()) == "TEXT"


def test_find_encrypted_columns_returns_the_real_encrypted_columns():
    """Discovery over the application schema finds every column holding a Fernet token"""
    assert find_encrypted_columns(Base.metadata) == _EXPECTED_ENCRYPTED_COLUMNS


def test_find_encrypted_columns_ignores_the_column_name():
    """A labelled column is found whatever it is called, which a naming rule could not do"""
    # A throwaway schema rather than Base, so this probe never reaches the real metadata
    # that the row-level security and schema parity guards read
    probe = MetaData()
    Table(
        "connections",
        probe,
        Column("id", Integer, primary_key=True),
        Column("credentials", EncryptedText, nullable=False),
        Column("provider", Text, nullable=False),
    )

    assert find_encrypted_columns(probe) == [("connections", "credentials")]


def test_find_encrypted_columns_skips_plain_text_columns():
    """A plain text column is left alone, so the rotation never rewrites a non-secret"""
    probe = MetaData()
    Table("notes", probe, Column("id", Integer, primary_key=True), Column("body", Text))

    assert find_encrypted_columns(probe) == []
