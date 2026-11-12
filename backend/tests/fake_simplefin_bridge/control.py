"""The control API tests use to set up and change a scenario, and a ready-made one for trying the app by hand

Every change shows in the next protocol response. Errors and the fault stay until they are cleared
"""

import base64
import dataclasses
import os
import secrets
from datetime import UTC, date, datetime, time, timedelta
from typing import Self

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field, model_validator

from .state import Account, BankError, Connection, Fault, FaultKind, Scenario, Transaction, bridge

router = APIRouter(prefix="/control/scenarios")

# The Bridge stamps a booked transaction's posted time at noon UTC on its bank date
BANK_DATE_STAMP_TIME = time(12, tzinfo=UTC)

# The status an HTML error page comes with unless the fault names another
DEFAULT_HTML_ERROR_STATUS = status.HTTP_403_FORBIDDEN

# The sample scenario: one bank login holding a chequing account and a credit card in Canadian
# dollars, each with a few weeks of an ordinary month, so an import from any recent start finds
# some. Each transaction is days before today, amount, description and payee
SAMPLE_CURRENCY = "CAD"
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
            (11, "500.00", "PAYMENT RECEIVED THANK YOU", ""),
            (6, "-129.95", "VISA PURCHASE PARCELPOINT ONLINE", "Parcelpoint"),
            (1, "-20.00", "VISA PURCHASE CITYLINK TRANSIT TOPUP", "Citylink Transit"),
        ],
    ),
]

# Waiting on the chequing account, so the sample shows a pending transaction too
SAMPLE_PENDING = ("-41.30", "EFTPOS GREENLEAF GROCER", "Greenleaf Grocer")


class AddConnectionRequest(BaseModel):
    """A bank login to add. conn_id is generated when left out"""

    conn_id: str | None = None
    name: str
    org_id: str
    org_url: str | None = None


class UpdateConnectionRequest(BaseModel):
    """Connection fields to change, such as org_id to move its accounts to another institution"""

    name: str | None = None
    org_id: str | None = None
    org_url: str | None = None


class AddAccountRequest(BaseModel):
    """A bank account to add. Currency is any string, so a custom currency's URL or an empty one is accepted"""

    id: str | None = None
    name: str
    conn_id: str
    currency: str
    balance: str
    available_balance: str | None = None
    balance_date: int | None = None


class UpdateAccountRequest(BaseModel):
    """Account fields to change. A new id makes it reappear under that id, and hidden makes it vanish"""

    id: str | None = None
    name: str | None = None
    currency: str | None = None
    balance: str | None = None
    available_balance: str | None = None
    balance_date: int | None = None
    hidden: bool | None = None


class TransactionRequest(BaseModel):
    """A transaction to add. Amounts are strings kept exactly as given, and a bank date is stamped at noon UTC"""

    id: str | None = None
    posted: date | int | None = None
    pending: bool = False
    amount: str
    description: str
    payee: str = ""
    memo: str = ""
    transacted_at: int | None = None

    @model_validator(mode="after")
    def _require_posted_when_booked(self) -> Self:
        """Refuse a booked transaction without a posted time"""
        if not self.pending and self.posted is None:
            raise ValueError("A booked transaction needs posted")
        return self


class AddTransactionsRequest(BaseModel):
    """Transactions to add to one account in a single call, as for over 1,000 in a range"""

    transactions: list[TransactionRequest]


class UpdateTransactionRequest(BaseModel):
    """Transaction fields to change: a correction, a new id, or pending false with posted to post it"""

    id: str | None = None
    posted: date | int | None = None
    pending: bool | None = None
    amount: str | None = None
    description: str | None = None
    payee: str | None = None
    memo: str | None = None
    transacted_at: int | None = None


class AddErrorRequest(BaseModel):
    """An errlist entry, such as con.auth with or without a conn_id"""

    code: str
    msg: str
    conn_id: str | None = None
    account_id: str | None = None


class SetFaultRequest(BaseModel):
    """The fault to show. status applies only to html_error"""

    kind: FaultKind
    status: int | None = Field(None, ge=400, le=599)

    @model_validator(mode="after")
    def _limit_status_to_html_errors(self) -> Self:
        """Refuse a status the fault would ignore"""
        if self.status is not None and self.kind != FaultKind.HTML_ERROR:
            raise ValueError("Only an html_error fault takes a status")
        return self


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_scenario(request: Request):
    """Start an empty scenario and return its id and first setup token"""
    scenario = bridge.create_scenario()
    return {"id": scenario.id, "setup_token": _setup_token(request, scenario)}


@router.post("/sample", status_code=status.HTTP_201_CREATED)
async def create_sample_scenario(request: Request):
    """Start a scenario holding the sample bank login, dated from today, and return its id and first setup token

    For trying the app by hand. Each call starts a new scenario under new ids
    """
    scenario = bridge.create_scenario()
    connection = Connection(conn_id=_new_id("CON"), name="Harbour Bank", org_id="ORG-harbour-bank", org_url=None)
    scenario.connections.append(connection)

    today = datetime.now(UTC).date()
    for name, balance, entries in SAMPLE_ACCOUNTS:
        account = Account(
            id=_new_id("ACT"),
            name=name,
            conn_id=connection.conn_id,
            currency=SAMPLE_CURRENCY,
            balance=balance,
            available_balance=None,
            balance_date=None,
        )
        account.transactions = [
            Transaction(
                id=_new_id("TRN"),
                amount=amount,
                description=description,
                payee=payee,
                memo="",
                pending=False,
                posted=_stamp(today - timedelta(days=days_ago)),
                transacted_at=None,
            )
            for days_ago, amount, description, payee in entries
        ]
        scenario.accounts.append(account)

    amount, description, payee = SAMPLE_PENDING
    pending = Transaction(
        id=_new_id("TRN"), amount=amount, description=description, payee=payee, memo="", pending=True, posted=None, transacted_at=None
    )
    scenario.accounts[0].transactions.append(pending)
    return {"id": scenario.id, "setup_token": _setup_token(request, scenario)}


@router.post("/{scenario_id}/setup-tokens", status_code=status.HTTP_201_CREATED)
async def create_setup_token(scenario_id: str, request: Request):
    """Return another setup token reaching the same scenario, as a reconnect needs"""
    return {"setup_token": _setup_token(request, _find_scenario(scenario_id))}


@router.post("/{scenario_id}/connections", status_code=status.HTTP_201_CREATED)
async def add_connection(scenario_id: str, body: AddConnectionRequest):
    """Add a bank login"""
    scenario = _find_scenario(scenario_id)
    connection = Connection(**body.model_dump() | {"conn_id": body.conn_id or _new_id("CON")})
    _refuse_taken_id(connection.conn_id, [item.conn_id for item in scenario.connections])
    scenario.connections.append(connection)
    return connection


@router.patch("/{scenario_id}/connections/{conn_id}")
async def update_connection(scenario_id: str, conn_id: str, body: UpdateConnectionRequest):
    """Change a bank login's name or institution"""
    connection = _find(_find_scenario(scenario_id).connections, "conn_id", conn_id, "Connection")
    for name, value in body.model_dump(exclude_unset=True).items():
        setattr(connection, name, value)
    return connection


@router.post("/{scenario_id}/accounts", status_code=status.HTTP_201_CREATED)
async def add_account(scenario_id: str, body: AddAccountRequest):
    """Add a bank account, before or after the token is claimed"""
    scenario = _find_scenario(scenario_id)
    if body.conn_id not in [item.conn_id for item in scenario.connections]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Connection not found")

    account = Account(**body.model_dump() | {"id": body.id or _new_id("ACT")})
    _refuse_taken_id(account.id, [item.id for item in scenario.accounts])
    scenario.accounts.append(account)
    return account


@router.patch("/{scenario_id}/accounts/{account_id}")
async def update_account(scenario_id: str, account_id: str, body: UpdateAccountRequest):
    """Change a bank account: vanish, reappear under a new id, change currency, balance or name"""
    scenario = _find_scenario(scenario_id)
    account = _find(scenario.accounts, "id", account_id, "Account")
    updates = body.model_dump(exclude_unset=True)
    if "id" in updates:
        _refuse_taken_id(updates["id"], [item.id for item in scenario.accounts if item is not account])
    for name, value in updates.items():
        setattr(account, name, value)
    return account


@router.post("/{scenario_id}/accounts/{account_id}/transactions", status_code=status.HTTP_201_CREATED)
async def add_transactions(scenario_id: str, account_id: str, body: AddTransactionsRequest):
    """Add booked or pending transactions to a bank account"""
    account = _find(_find_scenario(scenario_id).accounts, "id", account_id, "Account")
    added = [
        Transaction(**fields.model_dump() | {"id": fields.id or _new_id("TRN"), "posted": _stamp(fields.posted)})
        for fields in body.transactions
    ]
    taken = [item.id for item in account.transactions]
    for transaction in added:
        _refuse_taken_id(transaction.id, taken)
        taken.append(transaction.id)
    account.transactions.extend(added)
    return added


@router.patch("/{scenario_id}/accounts/{account_id}/transactions/{transaction_id}")
async def update_transaction(scenario_id: str, account_id: str, transaction_id: str, body: UpdateTransactionRequest):
    """Correct a transaction, rotate its id, or post a pending one under a new id"""
    account = _find(_find_scenario(scenario_id).accounts, "id", account_id, "Account")
    transaction = _find(account.transactions, "id", transaction_id, "Transaction")
    updates = body.model_dump(exclude_unset=True)
    if "posted" in updates:
        updates["posted"] = _stamp(updates["posted"])

    updated = dataclasses.replace(transaction, **updates)
    if not updated.pending and updated.posted is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A booked transaction needs posted")
    _refuse_taken_id(updated.id, [item.id for item in account.transactions if item is not transaction])

    account.transactions[account.transactions.index(transaction)] = updated
    return updated


@router.post("/{scenario_id}/errors", status_code=status.HTTP_201_CREATED)
async def add_error(scenario_id: str, body: AddErrorRequest):
    """Add an errlist entry to every response"""
    error = BankError(**body.model_dump())
    _find_scenario(scenario_id).errors.append(error)
    return error


@router.delete("/{scenario_id}/errors", status_code=status.HTTP_204_NO_CONTENT)
async def clear_errors(scenario_id: str):
    """Remove every errlist entry"""
    _find_scenario(scenario_id).errors.clear()


@router.put("/{scenario_id}/fault")
async def set_fault(scenario_id: str, body: SetFaultRequest):
    """Make every request show a fault, replacing any earlier one"""
    page_status = None
    if body.kind == FaultKind.HTML_ERROR:
        page_status = body.status or DEFAULT_HTML_ERROR_STATUS
    fault = Fault(kind=body.kind, status=page_status)
    _find_scenario(scenario_id).change_fault(fault)
    return fault


@router.delete("/{scenario_id}/fault", status_code=status.HTTP_204_NO_CONTENT)
async def clear_fault(scenario_id: str):
    """Answer requests normally again, freeing any a timeout fault still holds"""
    _find_scenario(scenario_id).change_fault(None)


@router.post("/{scenario_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_access(scenario_id: str):
    """Revoke the access URLs claimed so far, as disabling the token in the Bridge does"""
    bridge.revoke(_find_scenario(scenario_id))


def _setup_token(request: Request, scenario: Scenario) -> str:
    """Return a setup token, the base64 of a claim URL on the fake's test origin, or else on whatever address the caller reached it at"""
    # Read from the setting the app reads. It agrees with the app's only when whoever starts the
    # two gives both the same value, as the dev instance tooling and the browser tests' Compose
    # file do. Then a token minted at another address, such as the port a browser test's machine
    # reaches, still sends the app's claim somewhere the app can reach. Blank when the fake is
    # mounted in-process, and then a token points wherever its caller reached the fake
    test_origin = os.getenv("BANK_SYNC_SIMPLEFIN_TEST_ORIGIN", "").strip().rstrip("/")
    base_url = f"{test_origin}/" if test_origin else str(request.base_url)
    claim_url = f"{base_url}simplefin/claim/{bridge.mint_setup_token(scenario)}"
    return base64.b64encode(claim_url.encode()).decode()


def _find_scenario(scenario_id: str) -> Scenario:
    """Return the scenario, or refuse with a 404"""
    scenario = bridge.scenarios.get(scenario_id)
    if scenario is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scenario not found")
    return scenario


def _find[T](items: list[T], key: str, value: str, entity: str) -> T:
    """Return the item whose key field holds the value, or refuse with a 404 naming the entity"""
    for item in items:
        if getattr(item, key) == value:
            return item
    raise HTTPException(status.HTTP_404_NOT_FOUND, f"{entity} not found")


def _refuse_taken_id(new_id: str, taken: list[str]) -> None:
    """Refuse an id another item already has, since the Bridge would never send one twice"""
    if new_id in taken:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{new_id} is already taken")


def _new_id(prefix: str) -> str:
    """Return a Bridge-style id such as ACT-1f2e3d4c5b6a7980"""
    return f"{prefix}-{secrets.token_hex(8)}"


def _stamp(posted: date | int | None) -> int | None:
    """Return epoch seconds, stamping a bank date at noon UTC as the Bridge does"""
    if isinstance(posted, date):
        return int(datetime.combine(posted, BANK_DATE_STAMP_TIME).timestamp())
    return posted
