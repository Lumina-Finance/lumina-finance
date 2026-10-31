"""Log lines for the requests an abuse ban acts on, each holding the request's source address

A line is written only for sign-up, sign-in and reset requests, in one fixed JSON form a fail2ban
filter matches. The source address is personal data, so it is on as few lines as can still drive a
ban, and never beside a user ID or anything else that names a person: no email, name, body, query
string or path parameter value is ever written
"""

import json
import logging
import sys
from datetime import UTC, datetime

from app.request_hook import RequestRecord

# Requests logged whatever the outcome: each one sends an email or creates a record, so the count of
# them from one address is the abuse
SOURCE_ADDRESS_ALWAYS_ROUTES = frozenset({"/auth/signup", "/auth/password/forgot"})

# Requests logged only when they fail, so a person who signs in correctly is never counted against
# the ban threshold
SOURCE_ADDRESS_ON_FAILURE_ROUTES = frozenset(
    {
        "/auth/login",
        "/auth/2fa/verify",
        "/auth/passkeys/authenticate",
        "/auth/passkeys/mfa/verify",
        "/auth/signup/confirm",
        "/auth/password/reset",
        "/auth/password/reset/verify",
        "/auth/passkeys/reset/verify",
    }
)

# A failed attempt answers 4xx. A 5xx is the server's failure, so people retrying through an outage
# are never counted toward a ban
_FAILURE_STATUSES = range(400, 500)

# A server's own logging setup can prefix or reformat records, which would leave the line invalid
# JSON, so the line goes straight to standard output. It is an info line, so the app's log level
# above that stops it
abuse_log = logging.getLogger("lumina.abuse")
abuse_log.setLevel(logging.INFO)
abuse_log.propagate = False
if not abuse_log.handlers:
    _handler = logging.StreamHandler(sys.stdout)
    _handler.setFormatter(logging.Formatter("%(message)s"))
    abuse_log.addHandler(_handler)


def _is_source_address_logged(route: str, status: int) -> bool:
    """Return whether a request to this route with this outcome belongs in the abuse log"""
    if route in SOURCE_ADDRESS_ALWAYS_ROUTES:
        return True
    return route in SOURCE_ADDRESS_ON_FAILURE_ROUTES and status in _FAILURE_STATUSES


def _source_address(record: RequestRecord) -> str | None:
    """Return the client address as the server resolved it, or None when it has none

    Read from the scope and never from a forwarding header here. The server replaces the scope's
    client with the forwarded one only when the connection comes from a proxy it was told to trust,
    so a header a client forges is never believed
    """
    client = record.scope.get("client")
    return client[0] if client else None


def log_source_address(record: RequestRecord) -> None:
    """Write the abuse log line for a request, when it is one an abuse ban acts on

    Args:
        record: The answered request, as a request observer receives it
    """
    if not _is_source_address_logged(record.route, record.status):
        return
    source_address = _source_address(record)
    if not source_address:
        return
    fields = {
        "time": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "method": record.method,
        "route": record.route,
        "status": record.status,
        "ip": source_address,
    }
    abuse_log.info(json.dumps(fields, separators=(",", ":")))
