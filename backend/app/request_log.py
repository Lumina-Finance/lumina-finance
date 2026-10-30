"""One log line per answered request, naming the route by its template so no path value is written"""

import logging

from app.request_hook import RequestRecord

_SERVER_ERROR_STATUS = 500

logger = logging.getLogger(__name__)


def log_request(record: RequestRecord) -> None:
    """Write a request's line, at debug level unless the server failed to answer it

    A server error is written at every log level, since many are answered on purpose with no
    exception. The traceback of an unhandled one is the web server's own line and isn't repeated

    Args:
        record: The answered request, as a request observer receives it
    """
    level = logging.ERROR if record.status >= _SERVER_ERROR_STATUS else logging.DEBUG
    logger.log(level, "%s %s answered %d in %.0f ms", record.method, record.route, record.status, record.duration_seconds * 1000)
