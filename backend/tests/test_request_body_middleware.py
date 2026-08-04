"""Request body size guard tests driving the middleware as a plain ASGI app

The route-level tests cover the wiring inside the application. These drive the middleware
directly with a small cap, which is what makes the boundary and the replayed body cheap
enough to assert exactly
"""

import pytest

from app.request_security import RequestBodySizeLimitMiddleware

_CAP_BYTES = 64


async def _echo_app(scope, receive, send) -> None:
    """Minimal ASGI app answering with whatever body it was handed"""
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


async def _send_body(body: bytes, *, chunked: bool = False) -> tuple[int, bytes]:
    """Run the guarded echo app over a request body and return its answer

    Args:
        body: Request body to deliver
        chunked: Deliver in chunks with no declared length, as a chunked request does

    Returns:
        The response status paired with the body the app answered with
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
    answered: list[dict] = []

    async def receive():
        """Deliver the next request message, then report the client as gone"""
        return messages.pop(0) if messages else {"type": "http.disconnect"}

    async def send(message):
        """Record one response message"""
        answered.append(message)

    middleware = RequestBodySizeLimitMiddleware(_echo_app, max_body_bytes=_CAP_BYTES)
    await middleware(_scope(headers), receive, send)

    return answered[0]["status"], answered[1]["body"]


async def test_body_at_the_cap_reaches_the_app_unchanged():
    """A body the size of the cap is accepted and arrives byte for byte"""
    payload = bytes(range(64))

    status, echoed = await _send_body(payload)

    assert status == 200
    assert echoed == payload


async def test_body_one_byte_over_the_cap_is_refused():
    """One byte past the cap is refused, so the limit is not off by one"""
    status, _ = await _send_body(b"x" * (_CAP_BYTES + 1))

    assert status == 413


async def test_chunked_body_at_the_cap_reaches_the_app_unchanged():
    """A chunked body within the cap is reassembled in order and passed on whole"""
    payload = bytes(range(64))

    status, echoed = await _send_body(payload, chunked=True)

    assert status == 200
    assert echoed == payload


async def test_chunked_body_over_the_cap_is_refused_without_a_declared_length():
    """A chunked body is counted as it arrives, so no declared length is needed to refuse it"""
    status, _ = await _send_body(b"x" * (_CAP_BYTES + 1), chunked=True)

    assert status == 413


async def test_request_without_a_body_is_passed_straight_through():
    """A request declaring no body keeps the server's own receive rather than a buffered replay

    Nothing is read, which matters because a server that only sends a request message once
    the app asks for one would otherwise be waited on for a body that never arrives
    """
    kept_the_original: list[bool] = []

    async def receive():
        """Never reached, since neither the guard nor the stub app below reads"""
        raise AssertionError("a request with no body must not be read")

    async def app(scope, app_receive, send):
        """Record whether the app was handed the original receive or a replay"""
        kept_the_original.append(app_receive is receive)

    async def send(message):
        """Ignore the response"""

    middleware = RequestBodySizeLimitMiddleware(app, max_body_bytes=_CAP_BYTES)
    await middleware(_scope([(b"accept", b"application/json")]), receive, send)

    assert kept_the_original == [True]


async def test_the_app_keeps_reading_from_the_server_after_the_body():
    """Once the buffered body is spent the app reads on from the server, not from a stand-in

    Answering with a disconnect of its own would tell a streaming response the client had
    gone the moment its body was read
    """
    server_messages = [
        {"type": "http.request", "body": b"payload", "more_body": False},
        {"type": "http.disconnect"},
    ]
    read_after_the_body: list[dict] = []

    async def receive():
        """Deliver the next message the server has"""
        return server_messages.pop(0)

    async def app(scope, app_receive, send):
        """Read the body, then keep listening as a streaming response would"""
        await app_receive()
        read_after_the_body.append(await app_receive())

    async def send(message):
        """Ignore the response"""

    middleware = RequestBodySizeLimitMiddleware(app, max_body_bytes=_CAP_BYTES)
    await middleware(_scope([(b"content-length", b"7")]), receive, send)

    # The server's own disconnect, reached because the replay fell through to it
    assert read_after_the_body == [{"type": "http.disconnect"}]
    assert server_messages == []


async def test_a_client_vanishing_mid_body_leaves_the_app_to_handle_it():
    """A disconnect part way through a body is passed on with the bytes read so far"""
    server_messages = [
        {"type": "http.request", "body": b"half", "more_body": True},
        {"type": "http.disconnect"},
    ]
    seen: list[dict] = []

    async def receive():
        """Deliver the next message the server has"""
        return server_messages.pop(0)

    async def app(scope, app_receive, send):
        """Read until the client is reported gone"""
        seen.append(await app_receive())
        seen.append(await app_receive())

    async def send(message):
        """Ignore the response"""

    middleware = RequestBodySizeLimitMiddleware(app, max_body_bytes=_CAP_BYTES)
    await middleware(_scope([(b"transfer-encoding", b"chunked")]), receive, send)

    assert seen[0]["body"] == b"half"

    # more_body is what keeps the app reading. False here would have a route treat a
    # truncated upload as a whole one and never reach the disconnect below
    assert seen[0]["more_body"] is True
    assert seen[1] == {"type": "http.disconnect"}


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
