"""Request observer middleware tests driving it as a plain ASGI app, for what a route test cannot set up"""

import uuid
from types import SimpleNamespace

from fastapi import Request

from app.request_hook import OTHER_METHOD, UNMATCHED_ROUTE, RequestObserverMiddleware, observe_requests, record_request_user


async def _ok_app(scope, receive, send) -> None:
    """Minimal ASGI app answering 200"""
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": b""})


async def _failing_app(scope, receive, send) -> None:
    """ASGI app ending in an unhandled error before it answers"""
    raise RuntimeError("deliberate failure")


async def _receive():
    return {"type": "http.request", "body": b""}


async def _send(_message) -> None:
    return None


def _scope(**extra) -> dict:
    """Return an HTTP scope for a plain request"""
    return {"type": "http", "method": "GET", "path": "/", "headers": [], **extra}


async def test_an_observer_gets_the_route_template_status_and_duration(request_records):
    """The record names the matched route's template, never the path that was requested"""
    scope = _scope(path="/accounts/42", route=SimpleNamespace(path="/accounts/{account_id}"))

    await RequestObserverMiddleware(_ok_app)(scope, _receive, _send)

    assert len(request_records) == 1
    record = request_records[0]
    assert (record.method, record.route, record.status) == ("GET", "/accounts/{account_id}", 200)
    assert record.duration_seconds >= 0
    assert record.user_id is None


async def test_a_request_no_route_matched_gets_the_placeholder(request_records):
    """A path no route matches never reaches the observers"""
    await RequestObserverMiddleware(_ok_app)(_scope(path="/wp-admin/secret-probe"), _receive, _send)

    assert request_records[0].route == UNMATCHED_ROUTE


async def test_an_unhandled_error_is_reported_as_a_500_and_still_raised(request_records):
    """The observers hear of a request that ends in an error, and the error still reaches the server"""
    try:
        await RequestObserverMiddleware(_failing_app)(_scope(), _receive, _send)
    except RuntimeError:
        pass
    else:
        raise AssertionError("the error was swallowed")

    assert request_records[0].status == 500


async def test_a_method_outside_the_standard_set_is_folded_into_one_value(request_records):
    """A client choosing odd methods cannot grow what an observer keeps per method"""
    await RequestObserverMiddleware(_ok_app)(_scope(method="FUZZ-1234"), _receive, _send)

    assert request_records[0].method == OTHER_METHOD


async def test_the_signed_in_user_is_on_the_record(request_records):
    """The ID the sign-in check left on the request reaches the observers"""
    user_id = uuid.UUID("7f2b9b1e-0000-4000-8000-000000000001")
    scope = _scope(state={})
    record_request_user(Request(scope), user_id)

    await RequestObserverMiddleware(_ok_app)(scope, _receive, _send)

    assert request_records[0].user_id == user_id


async def test_an_observer_that_fails_does_not_stop_the_others_or_the_request(request_records, caplog):
    """A broken observer is logged, the observers after it still run, and the response is unaffected"""

    def broken(_record) -> None:
        raise ValueError("deliberate failure")

    observe_requests(broken)
    later: list = []
    observe_requests(later.append)

    await RequestObserverMiddleware(_ok_app)(_scope(), _receive, _send)

    assert len(request_records) == 1
    assert len(later) == 1
    assert "A request observer failed" in caplog.text


async def test_non_http_traffic_reaches_no_observer(request_records):
    """Lifespan traffic passes through without a record"""
    await RequestObserverMiddleware(_ok_app)({"type": "lifespan"}, _receive, _send)

    assert request_records == []
