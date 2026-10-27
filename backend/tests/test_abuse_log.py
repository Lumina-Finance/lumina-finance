"""Abuse log tests calling the observer directly, for what a route test cannot set up"""

import json
from types import SimpleNamespace

import pytest

from app.abuse_log import SOURCE_ADDRESS_ALWAYS_ROUTES, SOURCE_ADDRESS_ON_FAILURE_ROUTES, log_source_address
from app.main import app
from app.request_hook import RequestRecord

_CLIENT = ("203.0.113.9", 51000)


def test_every_listed_route_exists():
    """A route renamed without its entry here would silently stop feeding the ban"""
    served = set(app.openapi()["paths"])

    assert (SOURCE_ADDRESS_ALWAYS_ROUTES | SOURCE_ADDRESS_ON_FAILURE_ROUTES) <= served


def _record(route: str, status: int, client=_CLIENT, user_id=None) -> RequestRecord:
    """Return the record of a POST to the route, from the client"""
    return RequestRecord(
        scope={"type": "http", "client": client},
        method="POST",
        route=route,
        status=status,
        duration_seconds=0.01,
        user_id=user_id,
    )


def test_a_line_holds_only_the_time_method_route_status_and_address(abuse_log_lines):
    """Nothing else about the request is written, so nothing else can leak"""
    log_source_address(_record("/auth/login", 401, user_id=SimpleNamespace(hex="a-user")))

    assert len(abuse_log_lines) == 1
    line = json.loads(abuse_log_lines[0])
    assert list(line) == ["time", "method", "route", "status", "ip"]
    assert (line["method"], line["route"], line["status"], line["ip"]) == ("POST", "/auth/login", 401, "203.0.113.9")


@pytest.mark.parametrize("status", [503, 500])
def test_a_server_error_on_a_sign_in_route_logs_nothing(abuse_log_lines, status):
    """A 5xx is not a failed attempt, so people retrying through an outage are not counted toward a ban"""
    log_source_address(_record("/auth/login", status))

    assert abuse_log_lines == []


@pytest.mark.parametrize("route", ["/auth/signup", "/auth/password/forgot"])
@pytest.mark.parametrize("status", [204, 422])
def test_sign_up_and_reset_requests_are_logged_whatever_the_outcome(abuse_log_lines, route, status):
    """Each of these sends an email or creates a record, so every one counts toward a ban"""
    log_source_address(_record(route, status))

    assert json.loads(abuse_log_lines[0])["ip"] == "203.0.113.9"


def test_a_connection_with_no_client_address_logs_nothing(abuse_log_lines):
    """A request with no client in its scope is skipped rather than failing"""
    log_source_address(_record("/auth/signup", 204, client=None))

    assert abuse_log_lines == []
