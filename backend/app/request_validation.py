"""Keeps the bank account numbers and bank IDs of an import out of validation error responses

FastAPI answers a refused request with each error's input, the value that failed. For an OFX row
that value is a raw account number or bank ID, or a whole row or batch holding them, and the server
must never hand them back, so they are dropped from the errors before the response is built
"""

from typing import Any

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

# The request fields that hold a raw account number or bank ID, with the names an earlier page sent
# them under, which a request from it is refused for and must not have echoed back
SENSITIVE_FIELDS = frozenset({"bank_account", "bank_transaction", "bank_account_key", "bank_transaction_id"})


def _holds_sensitive_value(error: dict[str, Any]) -> bool:
    """Say whether an error's input is, or may contain, a raw account number or bank ID"""
    location = error.get("loc", ())
    if location and location[-1] in SENSITIVE_FIELDS:
        return True
    value = error.get("input")
    return isinstance(value, dict | list) and any(field in str(value) for field in SENSITIVE_FIELDS)


async def handle_request_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Answer 422 with FastAPI's usual body, minus the input of errors that may hold bank values

    Args:
        request: The refused request
        exc: The validation failure

    Returns:
        The 422 response, its errors carrying no input where it held a bank account or bank ID
    """
    errors = [
        {key: value for key, value in error.items() if key != "input"} if _holds_sensitive_value(error) else error for error in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(errors)})
