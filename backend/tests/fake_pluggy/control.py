"""The control API tests use to set up and change a scenario, and a ready-made one for trying the app by hand

Every change shows in the next response. The client ID and secret a scenario starts with reach only that scenario
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from .state import Account, Item, Scenario, Transaction, pluggy

router = APIRouter(prefix="/control/scenarios")

SAMPLE_CONNECTOR_ID = 2
SAMPLE_CONNECTOR_NAME = "Pluggy Bank"
SAMPLE_CURRENCY = "BRL"

# The hour of day an instant of the sample is stamped at, in UTC. Midday keeps each on the same
# calendar day for a user anywhere from the Americas to Europe
SAMPLE_HOUR_UTC = 12

# The sample scenario: one item holding a checking account and a credit card in reais, each with a
# few weeks of an ordinary month, so an import from any recent start finds some. Each transaction is
# days before today, amount and description. A checking account's debits are negative, as Pluggy
# sends them. A bare date, as banks give most, is stamped at midnight UTC
SAMPLE_CHECKING = (
    "Conta Corrente",
    "4218.36",
    [
        (33, "6500.00", "SALARIO BRIGHTWORKS LTDA"),
        (32, "-2400.00", "PIX ALUGUEL HARBOURVIEW IMOVEIS"),
        (27, "-186.42", "COMPRA DEBITO MERCADO FRESCOR"),
        (19, "6500.00", "SALARIO BRIGHTWORKS LTDA"),
        (15, "-119.90", "DEBITO AUTOMATICO FIBRANET INTERNET"),
        (9, "-15.75", "COMPRA DEBITO PADARIA SOL NASCENTE"),
        (5, "6500.00", "SALARIO BRIGHTWORKS LTDA"),
        (2, "-172.10", "COMPRA DEBITO POSTO NORTE"),
    ],
)

# The credit card, whose charges Pluggy sends positive and whose payments it sends negative. A
# purchase abroad has its own currency and what it cost in reais
SAMPLE_CARD = (
    "Cartão Pluggy Gold",
    "1612.40",
    [
        (24, "39.90", "STREAMFLIX MENSAL", None, None),
        (18, "164.50", "RESTAURANTE LUNA", None, None),
        (11, "-1500.00", "PAGAMENTO RECEBIDO", None, None),
        (6, "329.95", "LOJA ONLINE PARCELPOINT", None, None),
        (4, "40.00", "CLOUDHOST SUBSCRIPTION", "USD", "208.74"),
    ],
)

# A purchase on the card that hasn't posted yet, as days before today, amount and description
SAMPLE_PENDING = (0, "62.00", "SUPERMERCADO FRESCOR")


class AddItemRequest(BaseModel):
    """An item to add"""

    connector_name: str = SAMPLE_CONNECTOR_NAME
    connector_id: int = SAMPLE_CONNECTOR_ID
    status: str = "UPDATED"
    execution_status: str = "SUCCESS"


class UpdateItemRequest(BaseModel):
    """Item fields to change, such as status to LOGIN_ERROR with an execution status of INVALID_CREDENTIALS"""

    status: str | None = None
    execution_status: str | None = None


class AddAccountRequest(BaseModel):
    """An account to add to an item"""

    name: str
    type: str = "BANK"
    currency: str = SAMPLE_CURRENCY
    balance: str = "100.00"


class UpdateAccountRequest(BaseModel):
    """Account fields to change"""

    name: str | None = None
    balance: str | None = None


class TransactionRequest(BaseModel):
    """A transaction to add. The amount is a string kept exactly as given, and the id is generated when left out"""

    id: str | None = None
    amount: str

    # An ISO 8601 UTC timestamp, at exactly midnight for a date with no time
    date: str
    description: str = ""
    status: str = "POSTED"
    currency: str | None = None
    amount_in_account_currency: str | None = None


class AddTransactionsRequest(BaseModel):
    """Transactions to add to one account in a single call"""

    transactions: list[TransactionRequest]


class UpdateScenarioRequest(BaseModel):
    """Scenario settings to change"""

    page_size: int | None = None


def _find_scenario(scenario_id: str) -> Scenario:
    """Return a scenario, or answer 404"""
    scenario = pluggy.scenarios.get(scenario_id)
    if scenario is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scenario not found")
    return scenario


def _find_item(scenario: Scenario, item_id: str) -> Item:
    """Return one of a scenario's items, or answer 404"""
    for item in scenario.items:
        if item.id == item_id:
            return item
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")


def _find_account(scenario: Scenario, account_id: str) -> Account:
    """Return one of a scenario's accounts, or answer 404"""
    for item in scenario.items:
        for account in item.accounts:
            if account.id == account_id:
                return account
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")


def _new_id() -> str:
    """Return an id no other object has"""
    return str(uuid.uuid4())


def _new_item(scenario: Scenario, body: AddItemRequest) -> Item:
    """Add an item to a scenario"""
    item = Item(
        id=_new_id(),
        connector_id=body.connector_id,
        connector_name=body.connector_name,
        status=body.status,
        execution_status=body.execution_status,
    )
    scenario.items.append(item)
    return item


def _days_ago(days: int, *, is_bare_date: bool = False) -> str:
    """Return the sample timestamp of a day, as Pluggy writes one: midnight for a bare date, else midday"""
    hour = 0 if is_bare_date else SAMPLE_HOUR_UTC
    day = datetime.now(UTC).replace(hour=hour, minute=0, second=0, microsecond=0) - timedelta(days=days)
    return day.isoformat(timespec="milliseconds").replace("+00:00", "Z")


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_scenario():
    """Start an empty scenario and return its id, client ID and secret"""
    return _credentials(pluggy.create_scenario())


@router.post("/sample", status_code=status.HTTP_201_CREATED)
async def create_sample_scenario():
    """Start a scenario holding the sample item, dated from today, and return its id, client ID, secret and item ID

    For trying the app by hand. Each call starts a new scenario under new ids
    """
    scenario = pluggy.create_scenario()
    item = _new_item(scenario, AddItemRequest())

    name, balance, entries = SAMPLE_CHECKING
    checking = Account(id=_new_id(), type="BANK", name=name, balance=balance, currency=SAMPLE_CURRENCY)
    checking.transactions = [
        Transaction(id=_new_id(), date=_days_ago(days_ago, is_bare_date=True), amount=amount, description=description)
        for days_ago, amount, description in entries
    ]

    name, balance, entries = SAMPLE_CARD
    card = Account(id=_new_id(), type="CREDIT", name=name, balance=balance, currency=SAMPLE_CURRENCY)
    card.transactions = [
        Transaction(
            id=_new_id(),
            date=_days_ago(days_ago),
            amount=amount,
            description=description,
            currency=currency or SAMPLE_CURRENCY,
            amount_in_account_currency=in_account,
        )
        for days_ago, amount, description, currency, in_account in entries
    ]
    days_ago, amount, description = SAMPLE_PENDING
    card.transactions.append(
        Transaction(id=_new_id(), date=_days_ago(days_ago), amount=amount, description=description, status="PENDING", currency=SAMPLE_CURRENCY)
    )
    item.accounts = [checking, card]
    return _credentials(scenario)


@router.patch("/{scenario_id}")
async def update_scenario(scenario_id: str, body: UpdateScenarioRequest):
    """Change a scenario's settings, such as how many transactions a page holds"""
    scenario = _find_scenario(scenario_id)
    for name, value in body.model_dump(exclude_unset=True).items():
        setattr(scenario, name, value)
    return {"page_size": scenario.page_size}


@router.post("/{scenario_id}/items", status_code=status.HTTP_201_CREATED)
async def add_item(scenario_id: str, body: AddItemRequest):
    """Add an item, before or after the keys are claimed"""
    return _new_item(_find_scenario(scenario_id), body)


@router.patch("/{scenario_id}/items/{item_id}")
async def update_item(scenario_id: str, item_id: str, body: UpdateItemRequest):
    """Change an item's status, such as putting it into LOGIN_ERROR as a bank asking for the user again does"""
    item = _find_item(_find_scenario(scenario_id), item_id)
    for name, value in body.model_dump(exclude_unset=True).items():
        setattr(item, name, value)
    return item


@router.post("/{scenario_id}/items/{item_id}/accounts", status_code=status.HTTP_201_CREATED)
async def add_account(scenario_id: str, item_id: str, body: AddAccountRequest):
    """Add an account to an item"""
    account = Account(id=_new_id(), type=body.type, name=body.name, balance=body.balance, currency=body.currency)
    _find_item(_find_scenario(scenario_id), item_id).accounts.append(account)
    return account


@router.patch("/{scenario_id}/accounts/{account_id}")
async def update_account(scenario_id: str, account_id: str, body: UpdateAccountRequest):
    """Change an account's name or balance"""
    account = _find_account(_find_scenario(scenario_id), account_id)
    for name, value in body.model_dump(exclude_unset=True).items():
        setattr(account, name, value)
    return account


@router.post("/{scenario_id}/accounts/{account_id}/transactions", status_code=status.HTTP_201_CREATED)
async def add_transactions(scenario_id: str, account_id: str, body: AddTransactionsRequest):
    """Add transactions to an account"""
    account = _find_account(_find_scenario(scenario_id), account_id)
    for item in body.transactions:
        account.transactions.append(
            Transaction(
                id=item.id or _new_id(),
                date=item.date,
                amount=item.amount,
                description=item.description,
                status=item.status,
                currency=item.currency or account.currency,
                amount_in_account_currency=item.amount_in_account_currency,
            )
        )
    return {"added": len(body.transactions)}


@router.delete("/{scenario_id}/secret", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_secret(scenario_id: str):
    """Revoke the scenario's client secret, as rotating it in Pluggy does, so every request with it or its API keys is refused"""
    _find_scenario(scenario_id).is_secret_revoked = True


def _credentials(scenario: Scenario) -> dict[str, object]:
    """Return what a new scenario hands out: its id, the client ID and secret that reach it, and its item IDs"""
    return {
        "id": scenario.id,
        "client_id": scenario.client_id,
        "client_secret": scenario.client_secret,
        "item_ids": [item.id for item in scenario.items],
    }
