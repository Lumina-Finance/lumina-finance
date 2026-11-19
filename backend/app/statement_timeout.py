"""Answers a request whose statement the database cancelled for running too long"""

import logging

from fastapi import Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError

from app.request_hook import route_template

logger = logging.getLogger(__name__)

# What PostgreSQL reports for a statement it cancelled, here because it ran past the app role's
# statement timeout
_QUERY_CANCELED_SQLSTATE = "57014"

# The wording the app's screens show when the server takes too long, so both limits read the same
STATEMENT_TIMEOUT_DETAIL = "Oops, the server took too long to answer. Please try again"


async def handle_statement_timeout(request: Request, exc: DBAPIError) -> JSONResponse:
    """Answer 503 with a readable reason for a cancelled statement, leaving any other database error a server fault

    Raises:
        DBAPIError: The error is not a cancelled statement
    """
    if getattr(exc.orig, "sqlstate", None) != _QUERY_CANCELED_SQLSTATE:
        raise exc

    # The database rolled the transaction back and released its locks. Which statement ran too long is
    # what a slow query needs to be found. The route is named by its template, and the parameters
    # stay out of the log, so no value of the user's is written
    logger.warning("A statement for %s %s ran past the statement timeout: %s", request.method, route_template(request.scope), exc.statement)
    return JSONResponse(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content={"detail": STATEMENT_TIMEOUT_DETAIL})
