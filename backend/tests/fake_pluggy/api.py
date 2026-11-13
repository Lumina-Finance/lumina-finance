"""The application API endpoints the app reads, answered in the shapes Pluggy documents

Amounts are JSON numbers. Transactions come a page at a time, the query of the next page in the
answer holding the account and an opaque cursor, as Pluggy's published example does. An error
answers in the shape live Pluggy sends: a message, a code, a code description where it has one,
and an error id

What each error is based on:
- Seen live: the 401 CLIENT_KEYS_UNAUTHORIZED for a wrong pair, the 400 "clientId must be a UUID"
  for a client ID that isn't a UUID, the 400 "clientId must be a UUID,clientId must be a string,
  clientSecret must be a string" for a body with no client ID, and the 403
  API_KEY_MISSING_OR_INVALID for a missing or wrong API key. The fake answers every body it can't
  read with the first message, a shorter text than live Pluggy gives a body with no client ID
- From Pluggy's OpenAPI file: the 404 ITEM_NOT_FOUND "item not found" and the 400 "Invalid cursor"
- The fake's own, published nowhere: the 404 for an unknown account's transactions and for an
  unknown item's account list. They only keep a test from reading another application's data
"""

import base64
import binascii
import json
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import JSONResponse

from .state import Account, Item, Scenario, Transaction, pluggy

router = APIRouter()

# Pluggy's cursors are opaque base64 text. This one is padded to end in "==", as the published example's does
_CURSOR_PADDING = "|"


class Refused(Exception):
    """A request Pluggy answers with an error body instead of data"""

    def __init__(self, status_code: int, message: str, description: str | None = None) -> None:
        """Hold the error body's status and words

        Args:
            status_code: The HTTP status, repeated as the body's code
            message: What went wrong
            description: The body's code description, left out as Pluggy does for a request it can't read
        """
        super().__init__(message)
        self.status_code = status_code
        self.body = {"message": message, "code": status_code}
        if description is not None:
            self.body["codeDescription"] = description
        self.body["errorId"] = str(uuid.uuid4())


def _scenario_of(api_key: str | None) -> Scenario:
    """Return the scenario an API key reaches, or refuse as Pluggy does a key it doesn't know"""
    scenario = pluggy.find_by_api_key(api_key)
    if scenario is None:
        raise Refused(403, "Missing or invalid authorization token", "API_KEY_MISSING_OR_INVALID")
    return scenario


def _item_of(scenario: Scenario, item_id: str) -> Item:
    """Return one of the scenario's items, or refuse an item that isn't the application's

    Pluggy publishes the 404 ITEM_NOT_FOUND for reading an item. The account list's answer for an unknown item is the fake's own
    """
    for item in scenario.items:
        if item.id == item_id:
            return item
    raise Refused(404, "item not found", "ITEM_NOT_FOUND")


def _account_of(scenario: Scenario, account_id: str) -> Account:
    """Return one of the scenario's accounts, or refuse an account that isn't the application's"""
    for item in scenario.items:
        for account in item.accounts:
            if account.id == account_id:
                return account
    # The fake's own answer: Pluggy publishes none for an unknown account on this endpoint
    raise Refused(404, "Account not found")


def _cursor_after(offset: int) -> str:
    """Return the opaque cursor that leads to the transaction at an offset"""
    payload = f"offset|{offset}"
    while len(payload) % 3 != 1:
        payload += _CURSOR_PADDING
    return base64.b64encode(payload.encode()).decode()


def _offset_of(cursor: str) -> int:
    """Return the offset an opaque cursor leads to, or refuse a cursor this fake didn't hand out"""
    try:
        name, offset, *_ = base64.b64decode(cursor, validate=True).decode().split(_CURSOR_PADDING[0])
        if name == "offset":
            return int(offset)
    except binascii.Error, UnicodeDecodeError, ValueError:
        pass
    raise Refused(400, "Invalid cursor")


def _number(amount: str) -> float:
    """Return an amount as the JSON number Pluggy sends, since a float prints in its shortest exact form for any amount a test uses"""
    return float(Decimal(amount))


def _day(stamp: str) -> date:
    """Return the UTC calendar day of an ISO 8601 timestamp"""
    return datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(UTC).date()


async def _keys_of(request: Request) -> tuple[str, str]:
    """Return the client ID and secret a sign-in carries, or refuse as Pluggy does a body it can't use"""
    try:
        body = json.loads(await request.body())
    except ValueError:
        body = None
    body = body if isinstance(body, dict) else {}
    client_id, client_secret = body.get("clientId"), body.get("clientSecret")
    try:
        uuid.UUID(client_id if isinstance(client_id, str) else "")
    except ValueError:
        raise Refused(400, "clientId must be a UUID") from None
    if not isinstance(client_secret, str):
        raise Refused(400, "clientSecret must be a string")
    return client_id, client_secret


@router.post("/auth")
async def sign_in(request: Request):
    """Exchange a client ID and secret for an API key"""
    client_id, client_secret = await _keys_of(request)
    api_key = pluggy.sign_in(client_id, client_secret)
    if api_key is None:
        raise Refused(401, "client keys are invalid", "CLIENT_KEYS_UNAUTHORIZED")
    return {"apiKey": api_key}


@router.get("/items/{item_id}")
async def read_item(item_id: str, x_api_key: Annotated[str | None, Header()] = None):
    """Return one item and the state of its connection"""
    item = _item_of(_scenario_of(x_api_key), item_id)
    return {
        "id": item.id,
        "connector": {
            "id": item.connector_id,
            "name": item.connector_name,
            "institutionUrl": "https://pluggy.example",
            "imageUrl": None,
            "isSandbox": True,
        },
        "status": item.status,
        "executionStatus": item.execution_status,
        "lastUpdatedAt": datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "error": None,
    }


@router.get("/accounts")
async def list_accounts(itemId: Annotated[str, Query()], x_api_key: Annotated[str | None, Header()] = None):
    """List an item's accounts, all on the one page, since Pluggy publishes no page parameter for the list"""
    item = _item_of(_scenario_of(x_api_key), itemId)
    return {
        "total": len(item.accounts),
        "totalPages": 1,
        "page": 1,
        "results": [
            {
                "id": account.id,
                "type": account.type,
                "subtype": "CREDIT_CARD" if account.type == "CREDIT" else "CHECKING_ACCOUNT",
                "name": account.name,
                "balance": _number(account.balance),
                "currencyCode": account.currency,
                "itemId": item.id,
            }
            for account in item.accounts
        ],
    }


@router.get("/v2/transactions")
async def list_transactions(
    accountId: Annotated[str, Query()],
    dateFrom: str | None = None,
    dateTo: str | None = None,
    after: str | None = None,
    x_api_key: Annotated[str | None, Header()] = None,
):
    """Return a page of an account's transactions from dateFrom to dateTo, both days included, with the query of the next page"""
    scenario = _scenario_of(x_api_key)
    account = _account_of(scenario, accountId)
    first = date.fromisoformat(dateFrom) if dateFrom else None
    last = date.fromisoformat(dateTo) if dateTo else None
    matching = [
        item for item in account.transactions if (first is None or _day(item.date) >= first) and (last is None or _day(item.date) <= last)
    ]
    offset = _offset_of(after) if after else 0
    page = matching[offset : offset + scenario.page_size]

    # The dates of a request are not repeated in the next page's query, so the next request carries them itself
    next_query = None
    if offset + scenario.page_size < len(matching):
        next_query = f"?accountId={accountId}&after={_cursor_after(offset + scenario.page_size)}"
    return {"results": [_wire_transaction(item) for item in page], "next": next_query}


def _wire_transaction(item: Transaction) -> dict:
    """Return a transaction as Pluggy sends it"""
    wire = {
        "id": item.id,
        "description": item.description,
        "descriptionRaw": None,
        "currencyCode": item.currency,
        "amount": _number(item.amount),
        "date": item.date,
        "status": item.status,
    }
    if item.amount_in_account_currency is not None:
        wire["amountInAccountCurrency"] = _number(item.amount_in_account_currency)
    return wire


def refusal_response(refusal: Refused) -> JSONResponse:
    """Return a refusal as Pluggy's error body"""
    return JSONResponse(refusal.body, status_code=refusal.status_code)
