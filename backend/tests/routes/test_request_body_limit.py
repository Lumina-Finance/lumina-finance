from collections.abc import AsyncIterator

from app.config.runtime import ALLOWED_ORIGINS
from app.request_security import MAX_REQUEST_BODY_BYTES

# Any authenticated route works, since the body is counted before routing decides anything
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
    """A chunked body with no declared length is counted and refused once it passes the cap"""
    response = await client.post(_TARGET_PATH, content=_stream_oversized_payload())

    assert response.status_code == 413


async def test_body_under_the_cap_reaches_the_route(client):
    """A body within the cap is passed through, so the route decides the outcome

    Unauthenticated here, so the route answers 401 rather than 413, which is what shows the
    middleware handed the request on rather than rejecting it
    """
    response = await client.post(_TARGET_PATH, json={"rows": []})

    assert response.status_code != 413


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
