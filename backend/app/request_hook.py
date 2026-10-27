"""A place for code that watches every API request to plug in

Code registers an observer with observe_requests. Once a request is answered, the outermost layer
calls each observer with a RequestRecord. The record names the route by its template, so an observer
has no reason to write the path. Its scope is the server's raw view of the request, with the path,
query string and headers in it, so an observer must pick fields from it and never write it whole
"""

import logging
import time
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from fastapi import Request

# Stands in for the route template of a path no route matches, so a scanner's guesses never reach an observer
UNMATCHED_ROUTE = "unmatched"

# Folded into one value, so a client choosing odd methods cannot grow what an observer keeps per method
OTHER_METHOD = "OTHER"
_STANDARD_METHODS = frozenset({"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"})

# Key under which the sign-in check leaves the user ID in the request's state, for the record to read
_USER_ID_STATE_KEY = "observed_user_id"

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RequestRecord:
    """What an observer is told about an answered request

    Attributes:
        scope: ASGI scope of the request, for what the server adds to it, such as the client address.
            It holds the raw path, query string and headers, so never write it whole
        method: HTTP method, or OTHER outside the standard set
        route: Template of the matched route, or the unmatched placeholder
        status: Response status, 500 when an unhandled error ended the request
        duration_seconds: Time from the request reaching the outermost layer to the response ending
        user_id: Internal ID of the signed-in user, or None when the request had none
    """

    scope: Mapping[str, Any]
    method: str
    route: str
    status: int
    duration_seconds: float
    user_id: uuid.UUID | None


RequestObserver = Callable[[RequestRecord], None]

_observers: list[RequestObserver] = []


def observe_requests(observer: RequestObserver) -> None:
    """Call the observer with the record of every request once it is answered

    Args:
        observer: Function taking the request's record. It runs on the request's own task, so it must
            return quickly, and an error it raises is logged and does not reach the request
    """
    _observers.append(observer)


def record_request_user(request: Request, user_id: uuid.UUID) -> None:
    """Leave the signed-in user's ID on the request, for the record observers get

    Args:
        request: Request the user signed in on
        user_id: Internal ID of the user
    """
    setattr(request.state, _USER_ID_STATE_KEY, user_id)


def _route_template(scope) -> str:
    """Return the matched route's template, or the placeholder when no route matched"""
    return getattr(scope.get("route"), "path", None) or UNMATCHED_ROUTE


class RequestObserverMiddleware:
    """Tell the observers about every HTTP request once it is answered

    Outermost, so a request refused by an inner layer, such as an oversized body, and a request that
    ends in an unhandled error reach the observers too
    """

    def __init__(self, app) -> None:
        """Wrap an ASGI app

        Args:
            app: ASGI application this wraps
        """
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        """Run the app, then tell the observers about the request with the status it answered"""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        # What an unhandled error leaves, since the server answers it with a 500 after this layer sees it
        status = 500

        async def send_noting_status(message) -> None:
            """Pass the message on, keeping the status of the response start"""
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_noting_status)
        finally:
            record = RequestRecord(
                scope=scope,
                method=scope["method"] if scope["method"] in _STANDARD_METHODS else OTHER_METHOD,
                route=_route_template(scope),
                status=status,
                duration_seconds=time.perf_counter() - started,
                user_id=(scope.get("state") or {}).get(_USER_ID_STATE_KEY),
            )
            for observer in tuple(_observers):
                try:
                    observer(record)
                except Exception:
                    logger.exception("A request observer failed")
