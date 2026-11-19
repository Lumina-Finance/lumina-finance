"""Refuses a request that carries a NUL character before any route or database call sees it

PostgreSQL text cannot hold a NUL, so one that reaches a query fails there as a server error. A
request carries one only by mistake or on purpose, and it is the same refusal wherever it sits, so
the check runs once for every route instead of in each schema
"""

import json
from collections.abc import Iterator
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError

NULL_CHARACTER = "\x00"
NULL_CHARACTER_REFUSAL = "Must not contain a null character"

# How a JSON body spells one: the escape in a UTF-8 body, and a NUL byte in every character of a UTF-16
# or UTF-32 body, an encoding the JSON parser also reads. FastAPI has refused a UTF-8 body holding a raw
# NUL byte already. A body with neither is never parsed here, so the large bodies of an import are not
_JSON_NULL_ESCAPE = b"\\u0000"
_JSON_NULL_BYTE = b"\x00"

# Characters of a key the refusal repeats, since the key is the request's own and may be any length
_MAX_SHOWN_KEY_LENGTH = 64


def _find_in_json(value: Any, location: tuple[str | int, ...]) -> Iterator[tuple[str | int, ...]]:
    """Yield where a parsed JSON value holds a NUL, in an object's key or in a text

    Args:
        value: The parsed JSON value to search
        location: Where the value sits, as the keys and positions leading to it

    Yields:
        The location of each text holding a NUL. A key holding one gives the location of its object
    """
    if isinstance(value, str):
        if NULL_CHARACTER in value:
            yield location
    elif isinstance(value, list):
        for position, item in enumerate(value):
            yield from _find_in_json(item, (*location, position))
    elif isinstance(value, dict):
        for key, item in value.items():
            if NULL_CHARACTER in key:
                yield location
            yield from _find_in_json(item, (*location, key))


async def _find_in_body(request: Request) -> tuple[str | int, ...] | None:
    """Return where a JSON body holds a NUL, or None when it holds none

    A route that takes no body is left unread, since reading one is what a route without a body
    leaves to the server's own limits. The content type is not consulted, since FastAPI reads any
    JSON type, such as merge-patch+json in any case. A body that is not JSON fails to parse here and
    is left to the route

    Args:
        request: The request being checked

    Returns:
        The location of the first text with a NUL, relative to the body
    """
    route = request.scope.get("route")
    if getattr(route, "body_field", None) is None:
        return None
    raw = await request.body()
    if _JSON_NULL_ESCAPE not in raw and _JSON_NULL_BYTE not in raw:
        return None
    try:
        parsed = json.loads(raw)
    except ValueError, RecursionError:
        # Text that is not JSON, or nested past what the parser can follow, is left to the route
        return None
    return next(_find_in_json(parsed, ()), None)


async def refuse_null_characters(request: Request) -> None:
    """Refuse a request with a NUL character in its path, query string or JSON body

    The refusal names the field and never repeats what was sent. It runs ahead of the route's other
    dependencies, so a refused request reaches neither authentication nor the database

    Args:
        request: The request being checked

    Raises:
        RequestValidationError: A path value, a query string or a text in the body holds a NUL
    """
    for name, value in request.path_params.items():
        if NULL_CHARACTER in str(value):
            raise _refusal(("path", name))
    for name, value in request.query_params.multi_items():
        if NULL_CHARACTER in name or NULL_CHARACTER in value:
            raise _refusal(("query", name))
    in_body = await _find_in_body(request)
    if in_body is not None:
        raise _refusal(("body", *in_body))


def _refusal(location: tuple[str | int, ...]) -> RequestValidationError:
    """Build the 422 for a NUL at a location, without the value that held it

    A key the request chose names part of the location, so each is cut short. The answer then never
    repeats a key as long as the body

    Args:
        location: Where the NUL sits, as the keys and positions leading to it

    Returns:
        The validation failure to raise
    """
    shown = tuple(part[:_MAX_SHOWN_KEY_LENGTH].replace(NULL_CHARACTER, "") if isinstance(part, str) else part for part in location)
    return RequestValidationError([{"type": "value_error", "loc": shown, "msg": NULL_CHARACTER_REFUSAL}])
