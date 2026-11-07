"""The personal app API endpoints the app reads, answered in the shapes Akahu documents

Amounts are JSON numbers. Transactions come a page at a time, the next page's cursor in the answer
"""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Header, Query
from fastapi.responses import JSONResponse

from .state import Account, Scenario, Transaction, akahu

router = APIRouter(prefix="/v1")

_CURSOR_PREFIX = "cursor_"


class Refused(Exception):
    """A request Akahu answers with an error body instead of data"""

    def __init__(self, status_code: int, message: str) -> None:
        """Hold the error body's status and words"""
        super().__init__(message)
        self.status_code = status_code
        self.body = {"success": False, "message": message}


def _scenario_of(authorization: str | None, app_id: str | None) -> Scenario:
    """Return the scenario a pair of tokens reaches, or refuse as Akahu does a pair it doesn't know"""
    user_access_token = authorization.removeprefix("Bearer ") if authorization and authorization.startswith("Bearer ") else None
    scenario = akahu.find_by_tokens(user_access_token, app_id)
    if scenario is None:
        raise Refused(401, "Invalid app token or user token")
    return scenario


def _account_of(scenario: Scenario, account_id: str) -> Account:
    """Return one of the scenario's accounts, or refuse as Akahu does an account that isn't the user's"""
    for account in scenario.accounts:
        if account.id == account_id:
            return account
    raise Refused(404, "Account not found")


def _number(amount: str) -> float:
    """Return an amount as the JSON number Akahu sends, since a float prints in its shortest exact form for any amount a test uses"""
    return float(Decimal(amount))


def _instant(stamp: str) -> datetime:
    """Read an ISO 8601 UTC timestamp"""
    return datetime.fromisoformat(stamp.replace("Z", "+00:00"))


@router.get("/me")
async def read_me(authorization: Annotated[str | None, Header()] = None, x_akahu_id: Annotated[str | None, Header()] = None):
    """Prove the pair of tokens"""
    scenario = _scenario_of(authorization, x_akahu_id)
    return {"success": True, "item": {"_id": f"user_{scenario.id}", "access_granted_at": "2026-09-01T00:00:00.000Z"}}


@router.get("/accounts")
async def list_accounts(authorization: Annotated[str | None, Header()] = None, x_akahu_id: Annotated[str | None, Header()] = None):
    """List the personal app's accounts"""
    scenario = _scenario_of(authorization, x_akahu_id)
    return {
        "success": True,
        "items": [
            {
                "_id": account.id,
                "connection": {"_id": account.connection_id, "name": account.connection_name, "logo": None},
                "name": account.name,
                "status": account.status,
                "type": "CHECKING",
                "attributes": account.attributes,
                "balance": {
                    "current": _number(account.balance),
                    "available": _number(account.balance),
                    "currency": account.currency,
                    "overdrawn": False,
                },
                "refreshed": {"balance": datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")},
            }
            for account in scenario.accounts
        ],
    }


@router.get("/accounts/{account_id}/transactions")
async def list_transactions(
    account_id: str,
    authorization: Annotated[str | None, Header()] = None,
    x_akahu_id: Annotated[str | None, Header()] = None,
    start: str | None = None,
    end: str | None = None,
    cursor: Annotated[str | None, Query()] = None,
):
    """Return a page of an account's transactions after the start and up to and including the end"""
    scenario = _scenario_of(authorization, x_akahu_id)
    account = _account_of(scenario, account_id)
    matching = [
        item
        for item in account.transactions
        if (start is None or _instant(item.date) > _instant(start)) and (end is None or _instant(item.date) <= _instant(end))
    ]
    offset = int(cursor.removeprefix(_CURSOR_PREFIX)) if cursor else 0
    page = matching[offset : offset + scenario.page_size]
    has_more = offset + scenario.page_size < len(matching)
    return {
        "success": True,
        "items": [_wire_transaction(item, account) for item in page],
        "cursor": {"next": f"{_CURSOR_PREFIX}{offset + scenario.page_size}" if has_more else None},
    }


@router.get("/transactions/pending")
async def list_pending(authorization: Annotated[str | None, Header()] = None, x_akahu_id: Annotated[str | None, Header()] = None):
    """Return the pending transactions of every account, with no ids"""
    scenario = _scenario_of(authorization, x_akahu_id)
    return {
        "success": True,
        "items": [
            {
                "_account": account.id,
                "_connection": account.connection_id,
                "updated_at": item.date,
                "date": item.date,
                "description": item.description,
                "amount": _number(item.amount),
                "type": "EFTPOS",
            }
            for account in scenario.accounts
            for item in account.pending
        ],
    }


def _wire_transaction(item: Transaction, account: Account) -> dict:
    """Return a transaction as Akahu sends it"""
    return {
        "_id": item.id,
        "_account": account.id,
        "_connection": account.connection_id,
        "created_at": item.date,
        "updated_at": item.date,
        "date": item.date,
        "description": item.description,
        "amount": _number(item.amount),
        "type": "EFTPOS",
    }


def refusal_response(refusal: Refused) -> JSONResponse:
    """Return a refusal as Akahu's error body"""
    return JSONResponse(refusal.body, status_code=refusal.status_code)
