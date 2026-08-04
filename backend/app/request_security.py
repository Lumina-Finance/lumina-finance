"""Request body size guard middleware"""

import json

from fastapi import HTTPException

# 10 MB. The frontend batches a transaction import into 750 KB requests, and the one
# request it cannot split, a Firefly III budget import, is a few MB at its largest
MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024

_TOO_LARGE_DETAIL = "Request body is too large"
_TOO_LARGE_BODY = json.dumps({"detail": _TOO_LARGE_DETAIL}).encode()


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
    """Refuse a request body larger than the cap

    A declared length over the cap is refused before the route runs and before a byte is
    read. Anything else is counted as the route pulls it, rather than being read here, so
    an unauthenticated connection costs no more than the server already holds for it. A
    route that never reads its body is never counted, which the server bounds on its own
    by pausing the socket once nothing is consuming
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
        """Refuse an oversized body, otherwise run the app over a counted one"""
        # Lifespan and websocket traffic carry no request body to count
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared_length = _declared_body_length(scope)
        if declared_length is not None and declared_length > self.max_body_bytes:
            await self._reject(send)
            return

        await self.app(scope, _counting_receive(receive, self.max_body_bytes), send)

    async def _reject(self, send) -> None:
        """Answer the 413 directly, which is available because no route has started yet"""
        await send(_too_large_response_start())
        await send({"type": "http.response.body", "body": _TOO_LARGE_BODY})


def _declared_body_length(scope) -> int | None:
    """Return the body length the request declares, or None when it declares none

    A length that will not parse reads as undeclared, leaving the running count to decide
    rather than letting a malformed header skip the guard

    Args:
        scope: ASGI connection scope

    Returns:
        The declared length, or None
    """
    for name, value in scope["headers"]:
        if name == b"content-length":
            return int(value) if value.isdigit() else None
    return None


def _counting_receive(receive, max_body_bytes: int):
    """Return a receive callable refusing the body once it passes the cap

    The refusal is raised rather than written, because the route is already running and
    waiting on this call. FastAPI re-raises an HTTPException out of its body parsing, so it
    is rendered as the same 413 by the handler every other one goes through

    Args:
        receive: The server's receive
        max_body_bytes: Largest request body accepted

    Returns:
        An ASGI receive callable
    """
    counted = 0

    async def counting_receive():
        """Pass the next message through, counting the body as it goes"""
        nonlocal counted
        message = await receive()
        if message["type"] == "http.request":
            counted += len(message.get("body", b""))
            if counted > max_body_bytes:
                raise HTTPException(status_code=413, detail=_TOO_LARGE_DETAIL)
        return message

    return counting_receive
