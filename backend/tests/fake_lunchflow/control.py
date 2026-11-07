"""The control API tests use to set up and change a scenario, and a ready-made one for trying the app by hand

Every change shows in the next response. The key a scenario starts with reaches only that scenario
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from .state import Account, Scenario, Transaction, lunchflow

router = APIRouter(prefix="/control/scenarios")

SAMPLE_INSTITUTION = "Harbour Bank"
SAMPLE_CURRENCY = "CAD"

# The sample scenario: one connection holding a chequing account and a credit card in Canadian
# dollars, each with a few weeks of an ordinary month, so an import from any recent start finds some.
# Each transaction is days before today, amount, description and merchant
SAMPLE_ACCOUNTS = [
    (
        "Everyday Chequing",
        "2418.36",
        [
            (33, "2650.00", "DIRECT CREDIT BRIGHTWORKS LTD SALARY", "Brightworks Ltd"),
            (32, "-1950.00", "AUTOMATIC PAYMENT HARBOURVIEW RENTALS", "Harbourview Rentals"),
            (27, "-86.42", "EFTPOS FRESHWAY MARKET 0412", "Freshway Market"),
            (19, "2650.00", "DIRECT CREDIT BRIGHTWORKS LTD SALARY", "Brightworks Ltd"),
            (15, "-79.99", "DIRECT DEBIT FIBRENET BROADBAND", "Fibrenet"),
            (9, "-5.75", "EFTPOS BEAN THERE CAFE", "Bean There Cafe"),
            (5, "2650.00", "DIRECT CREDIT BRIGHTWORKS LTD SALARY", "Brightworks Ltd"),
            (2, "-72.10", "EFTPOS NORTHERN FUEL STOP", "Northern Fuel"),
        ],
    ),
    (
        "Rewards Visa",
        "-612.40",
        [
            (24, "-17.99", "VISA PURCHASE STREAMFLIX MONTHLY", "Streamflix"),
            (18, "-64.50", "VISA PURCHASE OSTERIA LUNA", "Osteria Luna"),
            (11, "500.00", "PAYMENT RECEIVED THANK YOU", None),
            (6, "-129.95", "VISA PURCHASE PARCELPOINT ONLINE", "Parcelpoint"),
            (1, "-20.00", "VISA PURCHASE CITYLINK TRANSIT TOPUP", "Citylink Transit"),
        ],
    ),
]


class AddAccountRequest(BaseModel):
    """An account to add. The connection is new unless connection_id names one the scenario's accounts already sit under"""

    name: str
    institution_name: str = SAMPLE_INSTITUTION
    connection_id: int | None = None
    currency: str = SAMPLE_CURRENCY
    status: str = "ACTIVE"
    balance: str = "100.00"


class UpdateAccountRequest(BaseModel):
    """Account fields to change, such as status to something other than ACTIVE"""

    name: str | None = None
    status: str | None = None
    balance: str | None = None


class TransactionRequest(BaseModel):
    """A transaction to add. The amount is a string kept exactly as given, and the id is generated when left out"""

    id: str | None = None
    amount: str
    currency: str | None = None
    date: str
    merchant: str | None = None
    description: str | None = None
    is_pending: bool = False


class AddTransactionsRequest(BaseModel):
    """Transactions to add to one account in a single call"""

    transactions: list[TransactionRequest]


def _find_scenario(scenario_id: str) -> Scenario:
    """Return a scenario, or answer 404"""
    scenario = lunchflow.scenarios.get(scenario_id)
    if scenario is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scenario not found")
    return scenario


def _find_account(scenario: Scenario, account_id: int) -> Account:
    """Return one of a scenario's accounts, or answer 404"""
    for account in scenario.accounts:
        if account.id == account_id:
            return account
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")


def _new_transaction_id() -> str:
    """Return a transaction id no other transaction has"""
    return f"fake-{uuid.uuid4().hex[:12]}"


def _new_account(scenario: Scenario, body: AddAccountRequest) -> Account:
    """Add an account to a scenario, on a connection of its own unless one is named"""
    connection_id = body.connection_id if body.connection_id is not None else lunchflow.new_connection_id()
    account = Account(
        id=lunchflow.new_account_id(),
        connection_id=connection_id,
        name=body.name,
        institution_name=body.institution_name,
        currency=body.currency,
        status=body.status,
        balance=body.balance,
    )
    scenario.accounts.append(account)
    return account


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_scenario():
    """Start an empty scenario and return its id and API key"""
    scenario = lunchflow.create_scenario()
    return {"id": scenario.id, "api_key": scenario.api_key}


@router.post("/sample", status_code=status.HTTP_201_CREATED)
async def create_sample_scenario():
    """Start a scenario holding the sample connection, dated from today, and return its id and API key

    For trying the app by hand. Each call starts a new scenario under new ids
    """
    scenario = lunchflow.create_scenario()
    today = datetime.now(UTC).date()
    connection_id = lunchflow.new_connection_id()
    for name, balance, entries in SAMPLE_ACCOUNTS:
        account = _new_account(scenario, AddAccountRequest(name=name, balance=balance, connection_id=connection_id))
        account.transactions = [
            Transaction(
                id=_new_transaction_id(),
                amount=amount,
                currency=SAMPLE_CURRENCY,
                date=(today - timedelta(days=days_ago)).isoformat(),
                merchant=merchant,
                description=description,
                is_pending=False,
            )
            for days_ago, amount, description, merchant in entries
        ]
    return {"id": scenario.id, "api_key": scenario.api_key}


@router.post("/{scenario_id}/accounts", status_code=status.HTTP_201_CREATED)
async def add_account(scenario_id: str, body: AddAccountRequest):
    """Add an account, before or after the key is claimed"""
    return _new_account(_find_scenario(scenario_id), body)


@router.patch("/{scenario_id}/accounts/{account_id}")
async def update_account(scenario_id: str, account_id: int, body: UpdateAccountRequest):
    """Change an account's name, status or balance"""
    account = _find_account(_find_scenario(scenario_id), account_id)
    for name, value in body.model_dump(exclude_unset=True).items():
        setattr(account, name, value)
    return account


@router.post("/{scenario_id}/accounts/{account_id}/transactions", status_code=status.HTTP_201_CREATED)
async def add_transactions(scenario_id: str, account_id: int, body: AddTransactionsRequest):
    """Add transactions to an account"""
    account = _find_account(_find_scenario(scenario_id), account_id)
    account.transactions.extend(
        Transaction(
            id=item.id or _new_transaction_id(),
            amount=item.amount,
            currency=item.currency or account.currency,
            date=item.date,
            merchant=item.merchant,
            description=item.description,
            is_pending=item.is_pending,
        )
        for item in body.transactions
    )
    return {"added": len(body.transactions)}


@router.delete("/{scenario_id}/api-key", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_key(scenario_id: str):
    """Revoke the scenario's API key, as deleting its destination in Lunch Flow does, so every request with it is refused"""
    _find_scenario(scenario_id).is_key_revoked = True
