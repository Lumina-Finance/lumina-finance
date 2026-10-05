"""Recording the statements a request runs, for lists held to a fixed number of queries and writes that mark the cache last"""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import event

from tests.conftest import scoped_engine

_WRITES = ("INSERT", "UPDATE", "DELETE")


@contextmanager
def _recorded_statements() -> Iterator[list[str]]:
    """Record the text of every statement the routes run while the block does, leaving parameters and results alone"""
    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        """Keep each statement's text"""
        statements.append(statement.lstrip())

    event.listen(scoped_engine.sync_engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(scoped_engine.sync_engine, "before_cursor_execute", record)


def _writes(statements: list[str]) -> list[str]:
    """Return the statements that insert, update or delete rows, in the order they ran"""
    return [statement for statement in statements if statement.upper().startswith(_WRITES)]


async def _get_with_selects(client, path: str, headers, **params) -> tuple[list | dict, list[str]]:
    """Read a path through the route, returning its body with the SELECT statements the request ran"""
    with _recorded_statements() as statements:
        response = await client.get(path, params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json(), [statement for statement in statements if statement.upper().startswith("SELECT")]
