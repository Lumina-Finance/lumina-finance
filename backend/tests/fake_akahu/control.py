"""The control API tests use to set up and change a scenario, and a ready-made one for trying the app by hand

Every change shows in the next response. The tokens a scenario starts with reach only that scenario
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from .state import Account, Scenario, Transaction, akahu

router = APIRouter(prefix="/control/scenarios")

SAMPLE_CONNECTION_NAME = "Harbour Bank"
SAMPLE_CURRENCY = "NZD"

# The hour of day the sample transactions are stamped at, in UTC. Midday keeps each on the same
# calendar day for a user anywhere from the Americas to Europe
SAMPLE_HOUR_UTC = 12

# The sample scenario: one connection holding a chequing account and a credit card in New Zealand
# dollars, each with a few weeks of an ordinary month, so an import from any recent start finds some.
# Each transaction is days before today, amount and description
SAMPLE_ACCOUNTS = [
    (
        "Everyday Chequing",
        "2418.36",
        [
            (33, "2650.00", "DIRECT CREDIT BRIGHTWORKS LTD SALARY"),
            (32, "-1950.00", "AUTOMATIC PAYMENT HARBOURVIEW RENTALS"),
            (27, "-86.42", "EFTPOS FRESHWAY MARKET 0412"),
            (19, "2650.00", "DIRECT CREDIT BRIGHTWORKS LTD SALARY"),
            (15, "-79.99", "DIRECT DEBIT FIBRENET BROADBAND"),
            (9, "-5.75", "EFTPOS BEAN THERE CAFE"),
            (5, "2650.00", "DIRECT CREDIT BRIGHTWORKS LTD SALARY"),
            (2, "-72.10", "EFTPOS NORTHERN FUEL STOP"),
        ],
    ),
    (
        "Rewards Visa",
        "-612.40",
        [
            (24, "-17.99", "VISA PURCHASE STREAMFLIX MONTHLY"),
            (18, "-64.50", "VISA PURCHASE OSTERIA LUNA"),
            (11, "500.00", "PAYMENT RECEIVED THANK YOU"),
            (6, "-129.95", "VISA PURCHASE PARCELPOINT ONLINE"),
            (1, "-20.00", "VISA PURCHASE CITYLINK TRANSIT TOPUP"),
        ],
    ),
]

# A pending purchase on the sample chequing account, as days before today, amount and description
SAMPLE_PENDING = (0, "-12.00", "CARD PURCHASE FRESHWAY MARKET")


class AddAccountRequest(BaseModel):
    """An account to add. The connection is new unless connection_id names one the scenario's accounts already sit under"""

    name: str
    connection_name: str = SAMPLE_CONNECTION_NAME
    connection_id: str | None = None
    currency: str = SAMPLE_CURRENCY
    status: str = "ACTIVE"
    balance: str = "100.00"
    attributes: list[str] = ["TRANSACTIONS"]


class UpdateAccountRequest(BaseModel):
    """Account fields to change, such as status to INACTIVE"""

    name: str | None = None
    status: str | None = None
    balance: str | None = None


class TransactionRequest(BaseModel):
    """A transaction to add. The amount is a string kept exactly as given, and the id is generated when left out

    A pending transaction is kept without its id, as Akahu sends none
    """

    id: str | None = None
    amount: str

    # An ISO 8601 UTC timestamp
    date: str
    description: str = ""
    is_pending: bool = False


class AddTransactionsRequest(BaseModel):
    """Transactions to add to one account in a single call"""

    transactions: list[TransactionRequest]


class UpdateScenarioRequest(BaseModel):
    """Scenario settings to change"""

    page_size: int | None = None


def _find_scenario(scenario_id: str) -> Scenario:
    """Return a scenario, or answer 404"""
    scenario = akahu.scenarios.get(scenario_id)
    if scenario is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scenario not found")
    return scenario


def _find_account(scenario: Scenario, account_id: str) -> Account:
    """Return one of a scenario's accounts, or answer 404"""
    for account in scenario.accounts:
        if account.id == account_id:
            return account
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")


def _new_account(scenario: Scenario, body: AddAccountRequest) -> Account:
    """Add an account to a scenario, on a connection of its own unless one is named"""
    account = Account(
        id=akahu.new_id("acc"),
        connection_id=body.connection_id if body.connection_id is not None else akahu.new_id("conn"),
        connection_name=body.connection_name,
        name=body.name,
        status=body.status,
        currency=body.currency,
        balance=body.balance,
        attributes=body.attributes,
    )
    scenario.accounts.append(account)
    return account


def _days_ago(days: int) -> str:
    """Return the sample timestamp of a day, as Akahu writes one"""
    day = datetime.now(UTC).replace(hour=SAMPLE_HOUR_UTC, minute=0, second=0, microsecond=0) - timedelta(days=days)
    return day.isoformat(timespec="milliseconds").replace("+00:00", "Z")


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_scenario():
    """Start an empty scenario and return its id and tokens"""
    scenario = akahu.create_scenario()
    return _credentials(scenario)


@router.post("/sample", status_code=status.HTTP_201_CREATED)
async def create_sample_scenario():
    """Start a scenario holding the sample connection, dated from today, and return its id and tokens

    For trying the app by hand. Each call starts a new scenario under new ids
    """
    scenario = akahu.create_scenario()
    connection_id = akahu.new_id("conn")
    for name, balance, entries in SAMPLE_ACCOUNTS:
        account = _new_account(scenario, AddAccountRequest(name=name, balance=balance, connection_id=connection_id))
        account.transactions = [
            Transaction(id=akahu.new_id("trans"), date=_days_ago(days_ago), amount=amount, description=description)
            for days_ago, amount, description in entries
        ]
    days_ago, amount, description = SAMPLE_PENDING
    scenario.accounts[0].pending = [Transaction(id="", date=_days_ago(days_ago), amount=amount, description=description)]
    return _credentials(scenario)


@router.patch("/{scenario_id}")
async def update_scenario(scenario_id: str, body: UpdateScenarioRequest):
    """Change a scenario's settings, such as how many transactions a page holds"""
    scenario = _find_scenario(scenario_id)
    for name, value in body.model_dump(exclude_unset=True).items():
        setattr(scenario, name, value)
    return {"page_size": scenario.page_size}


@router.post("/{scenario_id}/accounts", status_code=status.HTTP_201_CREATED)
async def add_account(scenario_id: str, body: AddAccountRequest):
    """Add an account, before or after the tokens are claimed"""
    return _new_account(_find_scenario(scenario_id), body)


@router.patch("/{scenario_id}/accounts/{account_id}")
async def update_account(scenario_id: str, account_id: str, body: UpdateAccountRequest):
    """Change an account's name, status or balance"""
    account = _find_account(_find_scenario(scenario_id), account_id)
    for name, value in body.model_dump(exclude_unset=True).items():
        setattr(account, name, value)
    return account


@router.post("/{scenario_id}/accounts/{account_id}/transactions", status_code=status.HTTP_201_CREATED)
async def add_transactions(scenario_id: str, account_id: str, body: AddTransactionsRequest):
    """Add transactions to an account"""
    account = _find_account(_find_scenario(scenario_id), account_id)
    for item in body.transactions:
        added = Transaction(
            id="" if item.is_pending else item.id or f"trans_fake{uuid.uuid4().hex[:12]}",
            date=item.date,
            amount=item.amount,
            description=item.description,
        )
        (account.pending if item.is_pending else account.transactions).append(added)
    return {"added": len(body.transactions)}


@router.delete("/{scenario_id}/tokens", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_tokens(scenario_id: str):
    """Revoke the scenario's tokens, as deleting the personal app in Akahu does, so every request with them is refused"""
    _find_scenario(scenario_id).are_tokens_revoked = True


def _credentials(scenario: Scenario) -> dict[str, str]:
    """Return what a new scenario hands out: its id and the pair of tokens that reaches it"""
    return {"id": scenario.id, "app_id_token": scenario.app_id_token, "user_access_token": scenario.user_access_token}
