"""The control API tests use to set up and change a scenario, and a ready-made one for trying the app by hand

Every change shows in the next response. The application ID and private key a scenario starts with reach only
that scenario
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from .state import Account, Bank, Scenario, Transaction, enable_banking

router = APIRouter(prefix="/control/scenarios")

SAMPLE_BANK = "Aurora Bank"
SAMPLE_COUNTRY = "FI"
SAMPLE_CURRENCY = "EUR"

# The sample scenario: a current account and a credit card in euros, each with a few weeks of an ordinary
# month, so an import from any recent start finds some. Each transaction is days before today, amount,
# DBIT or CRDT and description. Enable Banking sends amounts unsigned
SAMPLE_CHECKING = (
    "Everyday",
    {"CLBD": "2418.36", "ITAV": "2318.36"},
    [
        (33, "3200.00", "CRDT", "SALARY BRIGHTWORKS OY"),
        (32, "1150.00", "DBIT", "RENT HARBOURVIEW KIINTEISTOT"),
        (27, "86.42", "DBIT", "CARD PURCHASE MARKET FRESH"),
        (19, "3200.00", "CRDT", "SALARY BRIGHTWORKS OY"),
        (15, "29.90", "DBIT", "DIRECT DEBIT FIBRANET INTERNET"),
        (9, "5.75", "DBIT", "CARD PURCHASE BAKERY SOL"),
        (5, "3200.00", "CRDT", "SALARY BRIGHTWORKS OY"),
        (2, "72.10", "DBIT", "CARD PURCHASE STATION NORTH"),
    ],
)
SAMPLE_CARD = (
    "Visa Gold",
    {"CLBD": "-412.40"},
    [
        (24, "9.90", "DBIT", "STREAMFLIX MONTHLY"),
        (18, "64.50", "DBIT", "RESTAURANT LUNA"),
        (11, "500.00", "CRDT", "PAYMENT RECEIVED"),
        (6, "129.95", "DBIT", "ONLINE SHOP PARCELPOINT"),
    ],
)

# A purchase on the card that hasn't posted yet, as days before today, amount and description
SAMPLE_PENDING = (0, "32.00", "SUPERMARKET FRESH")


class CreateScenarioRequest(BaseModel):
    """A scenario to start, with the one bank it lists"""

    bank_name: str = SAMPLE_BANK
    country: str = SAMPLE_COUNTRY


class UpdateScenarioRequest(BaseModel):
    """Scenario settings to change"""

    page_size: int | None = None
    redirect_urls: list[str] | None = None
    history_days: int | None = None


class AddAccountRequest(BaseModel):
    """An account the bank will share"""

    name: str
    currency: str = SAMPLE_CURRENCY
    cash_account_type: str = "CACC"
    balances: dict[str, str] = {"CLBD": "100.00"}


class UpdateAccountRequest(BaseModel):
    """Account fields to change, such as error to ASPSP_PSU_ACTION_REQUIRED as a bank asking for the user again does"""

    name: str | None = None
    balances: dict[str, str] | None = None
    error: str | None = None


class TransactionRequest(BaseModel):
    """A transaction to add. The amount is a string kept exactly as given, and the id is generated when left out"""

    id: str | None = None
    amount: str

    # A calendar date, or None for a record the bank dated no day
    booking_date: str | None = None
    indicator: str = "DBIT"
    description: str = ""
    status: str = "BOOK"
    currency: str | None = None


class AddTransactionsRequest(BaseModel):
    """Transactions to add to one account in a single call"""

    transactions: list[TransactionRequest]


def _find_scenario(scenario_id: str) -> Scenario:
    """Return a scenario, or answer 404"""
    scenario = enable_banking.scenarios.get(scenario_id)
    if scenario is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scenario not found")
    return scenario


def _find_account(scenario: Scenario, identification_hash: str) -> Account:
    """Return one of a scenario's accounts, or answer 404"""
    for account in scenario.accounts:
        if account.identification_hash == identification_hash:
            return account
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")


def _new_id() -> str:
    """Return an id no other object has"""
    return str(uuid.uuid4())


def _day(days_ago: int) -> str:
    """Return the calendar date of a day before today"""
    return (datetime.now(UTC) - timedelta(days=days_ago)).date().isoformat()


def _credentials(scenario: Scenario) -> dict[str, object]:
    """Return what a new scenario hands out: its id, the application ID and private key that reach it, and its accounts"""
    return {
        "id": scenario.id,
        "application_id": scenario.application_id,
        "private_key": scenario.private_key,
        "bank": scenario.banks[0].name if scenario.banks else None,
        "country": scenario.banks[0].country if scenario.banks else None,
        "account_ids": [account.identification_hash for account in scenario.accounts],
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_scenario(body: CreateScenarioRequest | None = None):
    """Start a scenario listing one bank and sharing no accounts, and return its id, application ID and private key"""
    chosen = body or CreateScenarioRequest()
    scenario = enable_banking.create_scenario()
    scenario.banks.append(Bank(chosen.bank_name, chosen.country))
    return _credentials(scenario)


@router.post("/sample", status_code=status.HTTP_201_CREATED)
async def create_sample_scenario():
    """Start a scenario sharing the sample accounts, dated from today, and return its credentials

    For trying the app by hand. Each call starts a new scenario under new ids
    """
    scenario = enable_banking.create_scenario()
    scenario.banks.append(Bank(SAMPLE_BANK, SAMPLE_COUNTRY))
    for (name, balances, entries), kind in ((SAMPLE_CHECKING, "CACC"), (SAMPLE_CARD, "CARD")):
        account = Account(_new_id(), name, SAMPLE_CURRENCY, kind, dict(balances))
        account.transactions = [
            Transaction(_new_id(), _day(days_ago), amount, indicator, description) for days_ago, amount, indicator, description in entries
        ]
        scenario.accounts.append(account)
    days_ago, amount, description = SAMPLE_PENDING
    scenario.accounts[1].transactions.append(
        Transaction(_new_id(), _day(days_ago), amount, "DBIT", description, status="PDNG"),
    )
    return _credentials(scenario)


@router.patch("/{scenario_id}")
async def update_scenario(scenario_id: str, body: UpdateScenarioRequest):
    """Change a scenario's settings, such as the redirect URLs it registered or how many transactions a page holds"""
    scenario = _find_scenario(scenario_id)
    for name, value in body.model_dump(exclude_unset=True).items():
        setattr(scenario, name, value)
    return {"page_size": scenario.page_size, "redirect_urls": scenario.redirect_urls, "history_days": scenario.history_days}


@router.post("/{scenario_id}/accounts", status_code=status.HTTP_201_CREATED)
async def add_account(scenario_id: str, body: AddAccountRequest):
    """Add an account the bank shares with sessions started from now on"""
    account = Account(_new_id(), body.name, body.currency, body.cash_account_type, dict(body.balances))
    _find_scenario(scenario_id).accounts.append(account)
    return {"id": account.identification_hash}


@router.patch("/{scenario_id}/accounts/{account_id}")
async def update_account(scenario_id: str, account_id: str, body: UpdateAccountRequest):
    """Change an account's name, balances or the error its reads answer with"""
    account = _find_account(_find_scenario(scenario_id), account_id)
    for name, value in body.model_dump(exclude_unset=True).items():
        setattr(account, name, value)
    return {"id": account.identification_hash}


@router.post("/{scenario_id}/accounts/{account_id}/transactions", status_code=status.HTTP_201_CREATED)
async def add_transactions(scenario_id: str, account_id: str, body: AddTransactionsRequest):
    """Add transactions to an account"""
    account = _find_account(_find_scenario(scenario_id), account_id)
    for item in body.transactions:
        account.transactions.append(
            Transaction(item.id or _new_id(), item.booking_date, item.amount, item.indicator, item.description, item.status, item.currency)
        )
    return {"added": len(body.transactions)}


@router.get("/{scenario_id}/sessions")
async def list_sessions(scenario_id: str):
    """List the sessions sign-ins made and the state each is in, so a test can see which were ended"""
    return [{"id": session.id, "status": session.status} for session in _find_scenario(scenario_id).sessions.values()]


@router.post("/{scenario_id}/sessions/expire", status_code=status.HTTP_204_NO_CONTENT)
async def expire_sessions(scenario_id: str):
    """Expire every open session, as the end of the bank's consent does, so reading its accounts is refused until the user signs in again"""
    for session in _find_scenario(scenario_id).sessions.values():
        if session.status == "AUTHORIZED":
            session.status = "EXPIRED"
