"""Role provisioning tests"""

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import make_url

from app.db import provision


class RecordingConnection:
    """Stand-in connection that records the statements sent to the driver

    The real engine is replaced because the test database login cannot create roles. Statements
    built with ``text()`` still go through SQLAlchemy's own bind parameter check, as they would
    on a real connection
    """

    def __init__(self) -> None:
        """Start with nothing recorded"""
        self.statements: list[str] = []

    async def execute(self, statement) -> None:
        """Record a ``text()`` statement after requiring that it has no unbound parameters"""
        compiled = statement.compile(dialect=postgresql.asyncpg.dialect())
        compiled.construct_params()
        self.statements.append(str(statement))

    async def exec_driver_sql(self, statement: str) -> None:
        """Record a statement sent to the driver untouched"""
        self.statements.append(statement)


class RecordingEngine:
    """Stand-in engine handing out one recording connection"""

    def __init__(self, connection: RecordingConnection) -> None:
        """Hold the connection every ``connect`` call returns"""
        self.connection = connection

    def connect(self):
        """Return an async context manager yielding the recording connection"""
        return self

    async def __aenter__(self) -> RecordingConnection:
        """Yield the recording connection"""
        return self.connection

    async def __aexit__(self, *exc_info) -> None:
        """Leave the recording connection as it is"""

    async def dispose(self) -> None:
        """Release nothing"""


@pytest.mark.parametrize("password", ["ab/:cd", "pw :1", "it's 50%41off"])
async def test_ensure_roles_sends_a_password_with_reserved_characters_unchanged(monkeypatch, password):
    """A colon is never read as a bind parameter, and every password reaches the database as written"""
    connection = RecordingConnection()
    engine_urls: list[str] = []

    def create_recording_engine(url: str, **kwargs) -> RecordingEngine:
        """Keep the URL the engine is asked to connect with"""
        engine_urls.append(url)
        return RecordingEngine(connection)

    monkeypatch.setattr(provision, "create_async_engine", create_recording_engine)
    monkeypatch.setenv("DB_PASSWORD", "p@ss/w:rd")
    monkeypatch.setenv("MIGRATOR_DB_PASSWORD", password)
    monkeypatch.setenv("APP_DB_PASSWORD", password)

    await provision.ensure_roles()

    assert [make_url(url).password for url in engine_urls] == ["p@ss/w:rd"]

    quoted = "'" + password.replace("'", "''") + "'"
    assert sum(f"PASSWORD {quoted}" in statement for statement in connection.statements) == 2
