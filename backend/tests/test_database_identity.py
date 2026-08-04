"""Row-level security identity stamping tests"""

import uuid

import pytest

from app.database import current_user_id_ctx, stamp_request_identity


class RecordingConnection:
    """Stand-in for a database connection that records what it was asked to run"""

    def __init__(self) -> None:
        """Start with nothing recorded"""
        self.statements: list[tuple[str, tuple]] = []

    def exec_driver_sql(self, statement: str, parameters: tuple) -> None:
        """Record one driver-level statement and the parameters bound to it"""
        self.statements.append((statement, parameters))


def _stamp_with(value) -> RecordingConnection:
    """Stamp a connection with the given context value and return the connection

    Args:
        value: Value placed on the request identity context variable

    Returns:
        The connection the stamp was applied to
    """
    connection = RecordingConnection()
    token = current_user_id_ctx.set(value)
    try:
        stamp_request_identity(connection)
    finally:
        current_user_id_ctx.reset(token)
    return connection


def test_stamp_binds_the_identity_rather_than_inlining_it():
    """The user id is bound as a parameter, so it never becomes part of the statement"""
    user_id = uuid.uuid4()

    connection = _stamp_with(user_id)

    statement, parameters = connection.statements[0]
    assert parameters == (str(user_id),)
    assert str(user_id) not in statement


def test_stamp_accepts_a_uuid_string():
    """A well-formed string identity stamps its canonical form"""
    user_id = uuid.uuid4()

    connection = _stamp_with(str(user_id).upper())

    assert connection.statements[0][1] == (str(user_id),)


def test_stamp_is_empty_without_an_identity():
    """No identity stamps empty, which is what makes the policies match no rows"""
    connection = _stamp_with(None)

    assert connection.statements[0][1] == ("",)


def test_stamp_rejects_a_value_that_is_not_a_uuid():
    """A non-UUID identity raises at the stamp instead of reaching the database"""
    connection = RecordingConnection()
    token = current_user_id_ctx.set("' OR true --")
    try:
        with pytest.raises(ValueError):
            stamp_request_identity(connection)
    finally:
        current_user_id_ctx.reset(token)

    assert connection.statements == []
