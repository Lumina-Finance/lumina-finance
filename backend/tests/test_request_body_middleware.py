"""Request body size guard tests driving the middleware as a plain ASGI app

The route-level tests cover the wiring inside the application. These drive the middleware
directly with a small cap, which is what makes the boundary and the counting cheap enough
to assert exactly
"""

import pytest
from fastapi import HTTPException

from app.request_security import RequestBodySizeLimitMiddleware

_CAP_BYTES = 64


async def _reading_app(scope, receive, send) -> None:
    """Minimal ASGI app answering with whatever body it reads"""
    body = bytearray()
    more_body = True
    while more_body:
        message = await receive()
        if message["type"] != "http.request":
            break
        body += message.get("body", b"")
        more_body = message.get("more_body", False)

    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": bytes(body)})


def _scope(headers: list[tuple[bytes, bytes]]) -> dict:
    """Return an HTTP connection scope carrying the given headers"""
    return {"type": "http", "method": "POST", "path": "/", "headers": headers}


def _delivery(body: bytes, *, chunked: bool):
    """Return the request messages and headers for delivering a body

    Args:
        body: Request body to deliver
        chunked: Deliver in pieces with no declared length, as a chunked request does

    Returns:
        The headers paired with the messages the server would send
    """
    if chunked:
        headers = [(b"transfer-encoding", b"chunked")]
        pieces = [body[index:index + 16] for index in range(0, len(body), 16)] or [b""]
    else:
        headers = [(b"content-length", str(len(body)).encode())]
        pieces = [body]

    messages = [
        {"type": "http.request", "body": piece, "more_body": index < len(pieces) - 1}
        for index, piece in enumerate(pieces)
    ]
    return headers, messages


async def _send_body(body: bytes, *, chunked: bool = False) -> tuple[int, bytes]:
    """Run the guarded app over a request body and return its answer

    Args:
        body: Request body to deliver
        chunked: Deliver in pieces with no declared length

    Returns:
        The response status paired with the body the app answered with
    """
    headers, messages = _delivery(body, chunked=chunked)
    answered: list[dict] = []

    async def receive():
        """Deliver the next request message, then report the client as gone"""
        return messages.pop(0) if messages else {"type": "http.disconnect"}

    async def send(message):
        """Record one response message"""
        answered.append(message)

    middleware = RequestBodySizeLimitMiddleware(_reading_app, max_body_bytes=_CAP_BYTES)
    await middleware(_scope(headers), receive, send)

    return answered[0]["status"], answered[1]["body"]


async def test_body_at_the_cap_reaches_the_app_unchanged():
    """A body the size of the cap is accepted and arrives byte for byte"""
    payload = bytes(range(64))

    status, echoed = await _send_body(payload)

    assert status == 200
    assert echoed == payload


async def test_declared_body_over_the_cap_is_refused_before_the_app_runs():
    """A declared length past the cap is answered directly, with the app never reached"""
    reached: list[str] = []

    async def app(scope, receive, send):
        """Record that the app ran, which it should not"""
        reached.append(scope["path"])

    answered: list[dict] = []

    async def receive():
        """Never called, since an oversized declared length is refused unread"""
        raise AssertionError("an oversized declared length must not be read")

    async def send(message):
        """Record one response message"""
        answered.append(message)

    middleware = RequestBodySizeLimitMiddleware(app, max_body_bytes=_CAP_BYTES)
    await middleware(_scope([(b"content-length", str(_CAP_BYTES + 1).encode())]), receive, send)

    assert answered[0]["status"] == 413
    assert reached == []


async def test_chunked_body_at_the_cap_reaches_the_app_unchanged():
    """A chunked body within the cap is reassembled in order and passed on whole"""
    payload = bytes(range(64))

    status, echoed = await _send_body(payload, chunked=True)

    assert status == 200
    assert echoed == payload


async def test_chunked_body_over_the_cap_is_refused_as_it_arrives():
    """A body with no declared length is counted while the route reads it and cut off at the cap"""
    with pytest.raises(HTTPException) as refusal:
        await _send_body(b"x" * (_CAP_BYTES + 1), chunked=True)

    assert refusal.value.status_code == 413


async def test_a_lying_declared_length_is_still_caught():
    """A body larger than the length it declares is refused on the running count"""
    headers = [(b"content-length", b"1")]
    messages = [{"type": "http.request", "body": b"x" * (_CAP_BYTES + 1), "more_body": False}]

    async def receive():
        """Deliver the oversized body the header understated"""
        return messages.pop(0)

    async def send(message):
        """Ignore the response"""

    middleware = RequestBodySizeLimitMiddleware(_reading_app, max_body_bytes=_CAP_BYTES)

    with pytest.raises(HTTPException) as refusal:
        await middleware(_scope(headers), receive, send)

    assert refusal.value.status_code == 413


async def test_a_route_that_ignores_its_body_is_never_counted():
    """Nothing is read on the guard's own initiative, which is what keeps a connection cheap

    An unread body is bounded by the server pausing the socket once nothing consumes it, so
    counting here would cost memory rather than save it
    """
    async def app(scope, receive, send):
        """Answer without ever reading the body, as a cookie-only route does"""
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    answered: list[dict] = []

    async def receive():
        """Never called, since neither the guard nor the app above reads"""
        raise AssertionError("the guard must not read a body the route ignores")

    async def send(message):
        """Record one response message"""
        answered.append(message)

    middleware = RequestBodySizeLimitMiddleware(app, max_body_bytes=_CAP_BYTES)
    await middleware(_scope([(b"transfer-encoding", b"chunked")]), receive, send)

    assert answered[0]["status"] == 204


@pytest.mark.parametrize("scope_type", ["lifespan", "websocket"])
async def test_non_http_traffic_is_untouched(scope_type):
    """Startup and websocket connections carry no body and go straight to the app"""
    seen: list[str] = []

    async def app(scope, receive, send):
        """Record the scope it was reached with"""
        seen.append(scope["type"])

    async def receive():
        """Never called"""
        raise AssertionError("the guard must not read a non-HTTP connection")

    async def send(message):
        """Never called"""

    middleware = RequestBodySizeLimitMiddleware(app, max_body_bytes=_CAP_BYTES)
    await middleware({"type": scope_type}, receive, send)

    assert seen == [scope_type]
