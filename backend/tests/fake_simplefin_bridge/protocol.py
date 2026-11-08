"""The SimpleFIN protocol version 2 endpoints, answered the way SimpleFIN Bridge answers them

Where the Bridge's behaviour isn't published (the 90-day refusal, the 1,000-transaction cap, the
pending transactions it returns, its warning and error bodies), the fake makes the assumption the
app is built on, noted beside each one
"""

import asyncio
import base64
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, Response

from .state import Access, Account, BankError, Connection, FaultKind, Scenario, Transaction, bridge

router = APIRouter(prefix="/simplefin")

# The Bridge's limit on end-date minus start-date, counted in seconds, so a window crossing a
# daylight-saving change is held to exactly 90 days of seconds
MAX_RANGE_SECONDS = 90 * 86_400

# The reported Bridge cap, with no paging: a response holds at most this many booked transactions
# and leaves the rest out without saying so. Assumed to count booked transactions across the whole
# response. The app flags a response as possibly cut off once booked and pending transactions
# together reach this many, so it never misses one the cap cut short
MAX_BOOKED_TRANSACTIONS = 1_000

# The longest a timeout fault holds a request whose client is still waiting, long enough for a
# client's read timeout to fire first
TIMEOUT_STALL_SECONDS = 60

# The Bridge's wording for these isn't published. A range over 90 days is refused as an API usage
# error, the protocol's gen.api, and a quota warning goes out under the general gen. code with the
# phrases other SimpleFIN clients look for
RANGE_REFUSAL = {"code": "gen.api", "msg": "The date range must be 90 days or less"}
QUOTA_WARNING = {
    "code": "gen.",
    "msg": "You are making too many requests. Make fewer requests or this access token may be disabled",
}

FORBIDDEN = "Forbidden"
VERSION_REFUSAL = "The fake SimpleFIN Bridge serves only protocol version 2, so send version=2"
HTML_ERROR_PAGE = "<!DOCTYPE html><html><head><title>Error</title></head><body><h1>Something went wrong</h1></body></html>"


@router.post("/claim/{token}")
async def claim_setup_token(token: str, request: Request):
    """Exchange a setup token for an access URL, once

    A fault answers in place of the claim and leaves the token unspent, so the claim can be tried again
    """
    scenario = bridge.setup_tokens.get(token)
    if scenario is not None and (fault_response := await _fault_response(scenario, request)) is not None:
        return fault_response

    credentials = bridge.claim(token)
    if credentials is None:
        return PlainTextResponse(FORBIDDEN, status_code=403)

    username, password = credentials
    return PlainTextResponse(f"{request.base_url.replace(username=username, password=password)}simplefin")


@router.get("/accounts")
async def get_accounts(
    request: Request,
    version: Annotated[str | None, Query()] = None,
    start_date: Annotated[int | None, Query(alias="start-date")] = None,
    end_date: Annotated[int | None, Query(alias="end-date")] = None,
    pending: Annotated[int, Query()] = 0,
    balances_only: Annotated[int, Query(alias="balances-only")] = 0,
    account: Annotated[list[str] | None, Query()] = None,
):
    """Return the scenario's account set for a date window

    start-date is inclusive and end-date exclusive, both epoch seconds. A missing end-date means now,
    and a missing start-date the 90 days before end-date
    """
    access = _find_access(request.headers.get("authorization"))
    if access is None:
        return PlainTextResponse(FORBIDDEN, status_code=403)

    scenario = access.scenario
    if (fault_response := await _fault_response(scenario, request)) is not None:
        return fault_response
    if access.revoked:
        return PlainTextResponse(FORBIDDEN, status_code=403)

    # The Bridge answers a client that doesn't ask for version 2 in version 1's shape. Refusing
    # instead makes a client that forgot to ask fail here rather than against the real Bridge
    if version != "2":
        return PlainTextResponse(VERSION_REFUSAL, status_code=400)

    end = end_date if end_date is not None else _now()
    start = start_date if start_date is not None else end - MAX_RANGE_SECONDS
    if end - start > MAX_RANGE_SECONDS:
        return JSONResponse(_account_set([RANGE_REFUSAL], [], []))

    errlist = [_wire_error(error) for error in scenario.errors]
    fault_kind = scenario.fault.kind if scenario.fault else None
    if fault_kind in (FaultKind.QUOTA_WARNING, FaultKind.QUOTA_WARNING_WITHOUT_DATA):
        errlist.append(QUOTA_WARNING)

    accounts = []
    if fault_kind != FaultKind.QUOTA_WARNING_WITHOUT_DATA:
        listed = [item for item in scenario.accounts if not item.hidden and (account is None or item.id in account)]
        accounts = _wire_accounts(listed, start, end, include_pending=pending == 1, balances_only=balances_only == 1)

    sfin_url = f"{request.base_url}simplefin"
    connections = [_wire_connection(connection, sfin_url) for connection in scenario.connections]
    return JSONResponse(_account_set(errlist, connections, accounts))


async def _fault_response(scenario: Scenario, request: Request) -> Response | None:
    """Return the response the scenario's fault answers with in place of the request, or None when it adds to the normal one"""
    fault = scenario.fault
    if fault is None:
        return None

    match fault.kind:
        case FaultKind.PAYMENT_REQUIRED:
            return PlainTextResponse("Payment required", status_code=402)
        case FaultKind.RATE_LIMITED:
            return PlainTextResponse("Too many requests", status_code=429)
        case FaultKind.HTML_ERROR:
            return HTMLResponse(HTML_ERROR_PAGE, status_code=fault.status)
        case FaultKind.TIMEOUT:
            await _stall(request, scenario)
            return Response(status_code=504)
    return None


async def _stall(request: Request, scenario: Scenario) -> None:
    """Hold the request until its client gives up, the fault is cleared, or for the whole stall at most

    Ending at the disconnect leaves no stalled request behind to hold up stopping the server. Ending
    at the clear lets a test free a client it held, such as the bank sync worker, once it has seen
    what the hold was for, rather than leaving the worker waiting out its read timeout
    """

    async def disconnected() -> None:
        while (await request.receive())["type"] != "http.disconnect":
            pass

    waits = [asyncio.create_task(disconnected()), asyncio.create_task(scenario.stalls_released.wait())]
    scenario.request_held.set()
    try:
        await asyncio.wait(waits, timeout=TIMEOUT_STALL_SECONDS, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for wait in waits:
            wait.cancel()


def _find_access(authorization: str | None) -> Access | None:
    """Return the access a Basic Authorization header identifies, or None"""
    scheme, _, encoded = (authorization or "").partition(" ")
    if scheme.lower() != "basic":
        return None

    # binascii.Error and UnicodeDecodeError are both ValueErrors
    try:
        username, _, password = base64.b64decode(encoded, validate=True).decode().partition(":")
    except ValueError:
        return None
    return bridge.find_access(username, password)


def _now() -> int:
    """Return the current time in epoch seconds"""
    return int(datetime.now(UTC).timestamp())


def _account_set(errlist: list[dict], connections: list[dict], accounts: list[dict]) -> dict:
    """Return a version 2 account set, with each errlist problem repeated in the legacy errors list

    The legacy entry words the problem in its own way, as the Bridge's two lists needn't match word
    for word, so a client can't pair them up by their text
    """
    return {
        "errors": [f"{error['code']}: {error['msg']}" for error in errlist],
        "errlist": errlist,
        "connections": connections,
        "accounts": accounts,
    }


def _wire_error(error: BankError) -> dict:
    """Return an errlist entry, naming the connection and account only when it has them"""
    wire = {"code": error.code, "msg": error.msg}
    if error.conn_id is not None:
        wire["conn_id"] = error.conn_id
    if error.account_id is not None:
        wire["account_id"] = error.account_id
    return wire


def _wire_connection(connection: Connection, sfin_url: str) -> dict:
    """Return a connection as the account set lists it"""
    wire = {"conn_id": connection.conn_id, "name": connection.name, "org_id": connection.org_id, "sfin_url": sfin_url}
    if connection.org_url is not None:
        wire["org_url"] = connection.org_url
    return wire


def _wire_accounts(accounts: list[Account], start: int, end: int, *, include_pending: bool, balances_only: bool) -> list[dict]:
    """Return the accounts with their booked transactions in the window, past the cap held back, and when asked every pending one"""
    remaining = MAX_BOOKED_TRANSACTIONS
    wired = []
    for account in accounts:
        wire = {
            "id": account.id,
            "name": account.name,
            "conn_id": account.conn_id,
            "currency": account.currency,
            "balance": account.balance,
            "balance-date": account.balance_date if account.balance_date is not None else _now(),
        }
        if account.available_balance is not None:
            wire["available-balance"] = account.available_balance

        # The protocol makes transactions optional, and a balances-only read leaves the key out
        if not balances_only:
            # Oldest first, so the cap drops the newest booked transactions within each account, and
            # an account listed after the cap is reached keeps none. Which ones the Bridge drops isn't
            # published
            booked = sorted(
                (item for item in account.transactions if not item.pending and start <= item.posted < end),
                key=lambda item: item.posted,
            )[:remaining]
            remaining -= len(booked)
            # Every pending transaction, whatever the window, since one has no posted date to place it
            # by. Assumed, not yet checked against the Bridge. The Bridge may leave out pending items it
            # dates before the window's start
            pending = [item for item in account.transactions if item.pending] if include_pending else []
            wire["transactions"] = [_wire_transaction(item) for item in booked + pending]
        wired.append(wire)
    return wired


def _wire_transaction(transaction: Transaction) -> dict:
    """Return a transaction with the Bridge's undocumented payee and memo, and posted 0 while pending"""
    wire = {
        "id": transaction.id,
        "posted": 0 if transaction.pending else transaction.posted,
        "amount": transaction.amount,
        "description": transaction.description,
        "payee": transaction.payee,
        "memo": transaction.memo,
    }
    if transaction.transacted_at is not None:
        wire["transacted_at"] = transaction.transacted_at
    if transaction.pending:
        wire["pending"] = True
    return wire
