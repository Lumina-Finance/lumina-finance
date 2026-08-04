"""Request body size guard middleware"""

import json

# 10 MB. The frontend batches a transaction import into 750 KB requests, and the one
# request it cannot split, a Firefly III budget import, is a few MB at its largest
MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024

_TOO_LARGE_BODY = json.dumps({"detail": "Request body is too large"}).encode()


def _too_large_response_start() -> dict:
    """Return a fresh 413 response-start message

    Rebuilt per rejection rather than shared, because the CORS layer wrapping this one
    appends its headers into the message it is handed, and a shared one would carry one
    request's origin onto the next
    """
    return {
        "type": "http.response.start",
        "status": 413,
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(_TOO_LARGE_BODY)).encode()),
        ],
    }


class RequestBodySizeLimitMiddleware:
    """Reject a request whose body is larger than the cap before any route runs

    The body is read and counted here rather than as the route pulls it, because a route
    that never reads its body, such as one working only from cookies, would otherwise let
    an unbounded stream through uncounted
    """

    def __init__(self, app, max_body_bytes: int = MAX_REQUEST_BODY_BYTES) -> None:
        """Wrap an ASGI app, refusing a request body larger than the given cap

        Args:
            app: ASGI application this wraps
            max_body_bytes: Largest request body accepted
        """
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope, receive, send) -> None:
        """Count the request body, rejecting it past the cap, then run the app over it"""
        # Lifespan and websocket traffic carry no request body to count
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared_length, carries_body = _read_body_headers(scope)

        # A request declaring neither a length nor a chunked encoding carries no body, so it
        # is handed straight on and keeps reading from the server rather than from a replay
        if not carries_body:
            await self.app(scope, receive, send)
            return

        # A declared length refuses an oversized body without reading any of it
        if declared_length is not None and declared_length > self.max_body_bytes:
            await self._reject(send)
            return

        body = bytearray()
        more_body = True
        while more_body:
            message = await receive()

            # A client that disconnects mid-body leaves the app to handle the disconnect
            if message["type"] != "http.request":
                await self.app(scope, _replay(body, message), send)
                return

            body += message.get("body", b"")
            if len(body) > self.max_body_bytes:
                await self._reject(send)
                return
            more_body = message.get("more_body", False)

        await self.app(scope, _replay(bytes(body)), send)

    async def _reject(self, send) -> None:
        """Send the 413 the app would otherwise have to produce after reading the body"""
        await send(_too_large_response_start())
        await send({"type": "http.response.body", "body": _TOO_LARGE_BODY})


def _read_body_headers(scope) -> tuple[int | None, bool]:
    """Return the declared body length and whether the request carries a body at all

    A declared length that will not parse still counts as carrying one, leaving the running
    count to decide it rather than letting a malformed header skip the guard

    Args:
        scope: ASGI connection scope

    Returns:
        The declared length or None, paired with whether a body is expected
    """
    declared_length = None
    carries_body = False
    for name, value in scope["headers"]:
        if name == b"content-length":
            declared_length = int(value) if value.isdigit() else None
            carries_body = carries_body or value != b"0"
        elif name == b"transfer-encoding":
            carries_body = carries_body or b"chunked" in value.lower()
    return declared_length, carries_body


def _replay(body: bytes, trailing_message: dict | None = None):
    """Return a receive callable handing the buffered body to the app

    Args:
        body: Request body already read and counted
        trailing_message: Message that ended the read early, such as a disconnect

    Returns:
        An ASGI receive callable
    """
    messages = [{"type": "http.request", "body": bytes(body), "more_body": trailing_message is not None}]
    if trailing_message is not None:
        messages.append(trailing_message)

    async def receive():
        """Return the next buffered message, then behave as a client that has gone away"""
        return messages.pop(0) if messages else {"type": "http.disconnect"}

    return receive
