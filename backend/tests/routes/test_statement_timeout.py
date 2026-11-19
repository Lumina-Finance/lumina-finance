"""A request whose statement runs past the statement timeout is answered with a reason"""

import logging
import uuid

import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import DBAPIError

from app.statement_timeout import STATEMENT_TIMEOUT_DETAIL
from tests.conftest import TestSession, scoped_engine
from tests.routes.support.auth_helpers import _create_user, _get_auth_header

# Short enough to keep the test quick, and long enough that the sign-in checks before the read finish first
_REQUEST_WAIT_LIMIT = "1s"

# What PostgreSQL reports when a statement gives up waiting for a lock, a database error other than a timeout
_LOCK_NOT_AVAILABLE_SQLSTATE = "55P03"


def _limit_request_statements(connection) -> None:
    """Give each request transaction a short statement timeout, standing in for the app role's own"""
    connection.exec_driver_sql(f"SET LOCAL statement_timeout = '{_REQUEST_WAIT_LIMIT}'")


def _limit_request_lock_waits(connection) -> None:
    """Make each request transaction give up waiting for a lock, failing it with another database error"""
    connection.exec_driver_sql(f"SET LOCAL lock_timeout = '{_REQUEST_WAIT_LIMIT}'")


async def test_a_statement_past_the_timeout_answers_503_and_releases_the_request(client, caplog):
    """The cancelled request says the server took too long, and the next one succeeds once nothing holds it up"""
    headers = _get_auth_header(await _create_user(client))

    # An id in the path, so the log can be seen to name the route without it
    account_id = uuid.uuid4()

    # A transaction holding the accounts table makes the request's read wait past its timeout
    async with TestSession() as holder:
        await holder.execute(text("LOCK TABLE accounts IN ACCESS EXCLUSIVE MODE"))
        event.listen(scoped_engine.sync_engine, "begin", _limit_request_statements)
        try:
            with caplog.at_level(logging.WARNING):
                cancelled = await client.get(f"/accounts/{account_id}", headers=headers)
        finally:
            event.remove(scoped_engine.sync_engine, "begin", _limit_request_statements)
        await holder.rollback()

    assert cancelled.status_code == 503
    assert cancelled.json() == {"detail": STATEMENT_TIMEOUT_DETAIL}
    assert "GET /accounts/{account_id} ran past the statement timeout" in caplog.text
    assert str(account_id) not in caplog.text, "no value from the path reaches the log"
    assert "FROM accounts" in caplog.text, "the log names the statement that ran too long"

    answered = await client.get("/accounts", headers=headers)
    assert answered.status_code == 200


async def test_any_other_database_error_stays_a_server_fault(client, caplog):
    """Only a statement the timeout cancelled reads as the server taking too long"""
    headers = _get_auth_header(await _create_user(client))

    async with TestSession() as holder:
        await holder.execute(text("LOCK TABLE accounts IN ACCESS EXCLUSIVE MODE"))
        event.listen(scoped_engine.sync_engine, "begin", _limit_request_lock_waits)
        try:
            with caplog.at_level(logging.WARNING), pytest.raises(DBAPIError) as raised:
                await client.get("/accounts", headers=headers)
        finally:
            event.remove(scoped_engine.sync_engine, "begin", _limit_request_lock_waits)
        await holder.rollback()

    assert raised.value.orig.sqlstate == _LOCK_NOT_AVAILABLE_SQLSTATE
    assert "ran past the statement timeout" not in caplog.text
