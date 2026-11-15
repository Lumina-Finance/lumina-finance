"""The Personal API endpoints the app reads, answered in the shapes Lunch Flow documents

Amounts are JSON numbers. Lunch Flow documents no paging, so a response holds every transaction in
the range, with its total
"""

from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Header, Query
from fastapi.responses import JSONResponse

from .state import Account, Scenario, lunchflow

router = APIRouter(prefix="/api/v1")


class Refused(Exception):
    """A request Lunch Flow answers with an error body instead of data"""

    def __init__(self, status_code: int, error: str, message: str) -> None:
        """Hold the error body's status and words"""
        super().__init__(message)
        self.status_code = status_code
        self.body = {"error": error, "message": message}


def _scenario_of(api_key: str | None) -> Scenario:
    """Return the scenario a key reaches, or refuse as Lunch Flow does a key it doesn't know"""
    scenario = lunchflow.find_by_key(api_key)
    if scenario is None:
        raise Refused(401, "Unauthorized", "Invalid API key")
    return scenario


def _account_of(scenario: Scenario, account_id: int) -> Account:
    """Return one of the scenario's accounts, or refuse as Lunch Flow does an account that isn't the key's"""
    for account in scenario.accounts:
        if account.id == account_id:
            return account
    raise Refused(404, "Not Found", "Account not found")


def _number(amount: str) -> float:
    """Return an amount as the JSON number Lunch Flow sends, since a float prints in its shortest exact form for any amount a test uses"""
    return float(Decimal(amount))


@router.get("/accounts")
async def list_accounts(x_api_key: Annotated[str | None, Header()] = None):
    """List the key's accounts"""
    scenario = _scenario_of(x_api_key)

    # No currency, as in Lunch Flow's live account list, so only the balance answer gives it
    accounts = [
        {
            "id": account.id,
            "connection_id": account.connection_id,
            "name": account.name,
            "institution_name": account.institution_name,
            "institution_logo": None,
            "provider": "gocardless",
            "status": account.status,
        }
        for account in scenario.accounts
    ]
    return {"accounts": accounts, "total": len(accounts)}


@router.get("/accounts/{account_id}/balance")
async def read_balance(account_id: int, x_api_key: Annotated[str | None, Header()] = None):
    """Return an account's balance"""
    account = _account_of(_scenario_of(x_api_key), account_id)
    return {"balance": {"amount": _number(account.balance), "currency": account.currency}}


@router.get("/accounts/{account_id}/transactions")
async def list_transactions(
    account_id: int,
    x_api_key: Annotated[str | None, Header()] = None,
    from_date: Annotated[date | None, Query(alias="from")] = None,
    to_date: Annotated[date | None, Query(alias="to")] = None,
    include_pending: bool = False,
):
    """Return an account's transactions from one day through the other, both included, pending ones only when asked for"""
    account = _account_of(_scenario_of(x_api_key), account_id)
    transactions = [
        {
            "id": item.id,
            "accountId": account.id,
            "amount": _number(item.amount),
            "currency": item.currency,
            "date": item.date,
            "merchant": item.merchant,
            "description": item.description,
            "isPending": item.is_pending,
        }
        for item in account.transactions
        if (include_pending or not item.is_pending)
        and (from_date is None or date.fromisoformat(item.date) >= from_date)
        and (to_date is None or date.fromisoformat(item.date) <= to_date)
    ]
    return {"transactions": transactions, "total": len(transactions)}


def refusal_response(refusal: Refused) -> JSONResponse:
    """Return a refusal as Lunch Flow's error body"""
    return JSONResponse(refusal.body, status_code=refusal.status_code)
