"""Recording the SELECT statements a request runs, for lists held to a fixed number of queries"""

from sqlalchemy import event

from tests.conftest import scoped_engine


async def _get_with_selects(client, path: str, headers, **params) -> tuple[list | dict, list[str]]:
    """Read a path through the route, returning its body with the SELECT statements the request ran"""
    selects: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        """Keep each SELECT's text, leaving its parameters and result alone"""
        if statement.lstrip().upper().startswith("SELECT"):
            selects.append(statement)

    event.listen(scoped_engine.sync_engine, "before_cursor_execute", record)
    try:
        response = await client.get(path, params=params, headers=headers)
    finally:
        event.remove(scoped_engine.sync_engine, "before_cursor_execute", record)
    assert response.status_code == 200, response.text
    return response.json(), selects
