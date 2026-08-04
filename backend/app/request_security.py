"""Request body size guard middleware"""

import json

# 10 MB. The frontend batches a transaction import into 750 KB requests, and the one
# request it cannot split, a Firefly III budget import, is a few MB at its largest
MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024

_TOO_LARGE_BODY = json.dumps({"detail": "Request body is too large"}).encode()
_TOO_LARGE_RESPONSE_START = {
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
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope, receive, send) -> None:
        """Count the request body, rejecting it past the cap, then run the app over it"""
        # Lifespan and websocket traffic carry no request body to count
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        if self._is_declared_length_over_cap(scope):
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

    def _is_declared_length_over_cap(self, scope) -> bool:
        """Whether the request declares a Content-Length larger than the cap

        A declared length lets an oversized body be refused without reading it. A missing
        or unparseable one is not trusted either way, since the counter above decides
        """
        for name, value in scope["headers"]:
            if name == b"content-length":
                return value.isdigit() and int(value) > self.max_body_bytes
        return False

    async def _reject(self, send) -> None:
        """Send the 413 the app would otherwise have to produce after reading the body"""
        await send(_TOO_LARGE_RESPONSE_START)
        await send({"type": "http.response.body", "body": _TOO_LARGE_BODY})


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
