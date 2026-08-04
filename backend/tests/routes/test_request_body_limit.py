from collections.abc import AsyncIterator

from app.config.runtime import ALLOWED_ORIGINS
from app.request_security import MAX_REQUEST_BODY_BYTES
from tests.routes.support import _create_user, _get_auth_header

# Any route works for the declared-length refusal, which happens before routing decides
# anything. The counted refusal needs one that reads a body, and an authenticated caller,
# since the route has to get far enough to read it
_TARGET_PATH = "/transactions/import"


def _oversized_payload() -> bytes:
    """Return a body one byte past the cap"""
    return b"x" * (MAX_REQUEST_BODY_BYTES + 1)


async def _stream_oversized_payload() -> AsyncIterator[bytes]:
    """Yield an oversized body in chunks, so the request carries no declared length"""
    chunk = b"x" * (1024 * 1024)
    for _ in range(MAX_REQUEST_BODY_BYTES // len(chunk) + 1):
        yield chunk


async def test_declared_oversized_body_is_refused(client):
    """A body whose Content-Length is past the cap is refused with 413"""
    response = await client.post(_TARGET_PATH, content=_oversized_payload())

    assert response.status_code == 413
    assert response.json() == {"detail": "Request body is too large"}


async def test_undeclared_oversized_body_is_refused(client):
    """A chunked body with no declared length is counted as the route reads it and refused

    Authenticated, because the count only happens once the route reaches its body, and an
    unauthenticated caller is turned away before that
    """
    headers = _get_auth_header(await _create_user(client))

    response = await client.post(_TARGET_PATH, content=_stream_oversized_payload(), headers=headers)

    assert response.status_code == 413
    assert response.json() == {"detail": "Request body is too large"}


async def test_body_under_the_cap_reaches_the_route(client):
    """A body within the cap is passed through, so the route decides the outcome

    Unauthenticated here, so the answer is the route's own rejection rather than the guard's,
    which is what shows the request was handed on. A 404 would mean the path below has been
    renamed and this stopped testing anything
    """
    response = await client.post(_TARGET_PATH, json={"rows": []})

    assert response.status_code not in (413, 404)


async def test_refusal_carries_cors_headers(client):
    """A refused body still carries CORS headers, so a browser reports the 413 rather than a CORS failure

    The middleware is installed before CORS so CORS wraps it. Reversed, the rejection would
    leave the response without the headers and the browser would report the wrong problem
    """
    # An unconfigured deployment allows every origin, in which case the header echoes
    # whichever one the request carried
    origin = "http://localhost:5173" if ALLOWED_ORIGINS[0] == "*" else ALLOWED_ORIGINS[0]

    response = await client.post(
        _TARGET_PATH,
        content=_oversized_payload(),
        headers={"Origin": origin},
    )

    assert response.status_code == 413
    assert response.headers["access-control-allow-origin"] == origin


async def test_a_refusal_does_not_inherit_an_earlier_requests_origin(client):
    """One rejection's CORS headers must not survive onto the next

    The CORS layer writes its headers into the response message it is handed, so a shared
    message would carry the first caller's origin onto every later rejection, including one
    the CORS layer never looked at
    """
    origin = "http://localhost:5173" if ALLOWED_ORIGINS[0] == "*" else ALLOWED_ORIGINS[0]
    await client.post(_TARGET_PATH, content=_oversized_payload(), headers={"Origin": origin})

    without_origin = await client.post(_TARGET_PATH, content=_oversized_payload())

    assert without_origin.status_code == 413
    assert "access-control-allow-origin" not in without_origin.headers
    assert "vary" not in without_origin.headers
