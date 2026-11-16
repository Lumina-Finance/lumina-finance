"""The application API endpoints the app reads, answered in the shapes Enable Banking documents

Every request carries a token the application's private key signed. Amounts are strings. Transactions come
a page at a time, with a continuation key between pages. The bank's own pages, where the user would sign
in, are a link to approve and a link to decline, each sending the browser back to the redirect address
"""

import html
import os
import secrets
import uuid
from datetime import date, timedelta
from typing import Annotated
from urllib.parse import urlencode, urlsplit, urlunsplit

import jwt
from fastapi import APIRouter, Header, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel

from .state import Account, Authorization, Scenario, Session, Transaction, enable_banking

router = APIRouter()

_CURSOR_PREFIX = "cursor_"

# Enable Banking's account `name` holds the account holder's name, never the account's own label
_HOLDER_NAME = "Alex Sample"
_SESSION_OVER = {"EXPIRED": "EXPIRED_SESSION", "REVOKED": "REVOKED_SESSION", "CLOSED": "CLOSED_SESSION"}


class Refused(Exception):
    """A request Enable Banking answers with an error body instead of data"""

    def __init__(self, status_code: int, error: str, message: str | None = None) -> None:
        """Hold the error body's status and words"""
        super().__init__(error)
        self.status_code = status_code
        self.body = {"message": message or error, "code": status_code, "error": error, "detail": None}


class AspspRef(BaseModel):
    """The bank a sign-in is for"""

    name: str
    country: str


class AccessRequest(BaseModel):
    """How long the sign-in lasts"""

    valid_until: str


class AuthRequest(BaseModel):
    """The body of POST /auth"""

    access: AccessRequest
    aspsp: AspspRef
    state: str
    redirect_url: str
    psu_type: str = "personal"


class SessionRequest(BaseModel):
    """The body of POST /sessions"""

    code: str


def _scenario_of(authorization: str | None) -> Scenario:
    """Return the scenario a token reaches, or refuse as Enable Banking does a token it can't verify"""
    token = (authorization or "").removeprefix("Bearer ")
    try:
        application_id = jwt.get_unverified_header(token).get("kid", "")
        scenario = enable_banking.find_by_application(application_id)
        if scenario is None:
            raise Refused(401, "UNAUTHORIZED_ACCESS")
        jwt.decode(
            token,
            scenario.public_key,
            algorithms=["RS256"],
            audience="api.enablebanking.com",
            issuer="enablebanking.com",
            options={"require": ["exp", "iat"]},
        )
    except jwt.PyJWTError:
        raise Refused(401, "UNAUTHORIZED_ACCESS") from None
    return scenario


def _session_account(scenario: Scenario, uid: str) -> tuple[Session, Account]:
    """Return the session and account a uid names, refusing one that is unknown or whose session is over"""
    for session in scenario.sessions.values():
        for identification_hash, session_uid in session.uids.items():
            if session_uid != uid:
                continue
            if session.status != "AUTHORIZED":
                raise Refused(401, _SESSION_OVER.get(session.status, "CLOSED_SESSION"))
            account = next(account for account in scenario.accounts if account.identification_hash == identification_hash)
            if account.error:
                raise Refused(400, account.error)
            return session, account
    raise Refused(404, "SESSION_DOES_NOT_EXIST")


def _day(item: Transaction) -> date | None:
    """Return the day a transaction counts for, or None when the bank gave none"""
    return date.fromisoformat(item.booking_date) if item.booking_date else None


@router.get("/aspsps")
async def list_banks(country: str | None = None, authorization: Annotated[str | None, Header()] = None):
    """List the banks of a country the application can sign in at"""
    scenario = _scenario_of(authorization)
    return {
        "aspsps": [
            {"name": bank.name, "country": bank.country, "maximum_consent_validity": bank.maximum_consent_validity, "logo": None}
            for bank in scenario.banks
            if country is None or bank.country == country
        ]
    }


@router.post("/auth")
async def start_authorization(body: AuthRequest, request: Request, authorization: Annotated[str | None, Header()] = None):
    """Start a sign-in at a bank, answering with the address of the bank's page"""
    scenario = _scenario_of(authorization)
    if not any(bank.name == body.aspsp.name and bank.country == body.aspsp.country for bank in scenario.banks):
        raise Refused(422, "WRONG_ASPSP_PROVIDED")
    if scenario.redirect_urls and body.redirect_url not in scenario.redirect_urls:
        raise Refused(422, "REDIRECT_URI_NOT_ALLOWED")
    pending = Authorization(
        id=str(uuid.uuid4()),
        bank_name=body.aspsp.name,
        country=body.aspsp.country,
        state=body.state,
        redirect_url=body.redirect_url,
    )
    scenario.authorizations[pending.id] = pending
    return {"url": f"{_public_origin(request)}/fake-bank/{scenario.id}/{pending.id}", "authorization_id": pending.id}


@router.post("/sessions")
async def create_session(body: SessionRequest, authorization: Annotated[str | None, Header()] = None):
    """Exchange the code the bank returned for a session, once"""
    scenario = _scenario_of(authorization)
    pending = next((entry for entry in scenario.authorizations.values() if entry.code == body.code), None)
    if pending is None:
        raise Refused(422, "WRONG_AUTHORIZATION_CODE")
    pending.code = None
    session = Session(
        id=str(uuid.uuid4()),
        bank_name=pending.bank_name,
        country=pending.country,
        uids={account.identification_hash: str(uuid.uuid4()) for account in scenario.accounts},
    )
    scenario.sessions[session.id] = session
    return {
        "session_id": session.id,
        "accounts": [
            {
                "uid": session.uids[account.identification_hash],
                "identification_hash": account.identification_hash,
                "account_id": {"iban": "FI2112345600000785"},
                "name": _HOLDER_NAME,
                "details": account.name,
                "product": "Current account" if account.cash_account_type == "CACC" else "Credit card",
                "currency": account.currency,
                "cash_account_type": account.cash_account_type,
            }
            for account in scenario.accounts
        ],
        "aspsp": {"name": session.bank_name, "country": session.country},
        "psu_type": "personal",
    }


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, authorization: Annotated[str | None, Header()] = None):
    """End a session, after which its accounts are refused"""
    session = _scenario_of(authorization).sessions.get(session_id)
    if session is None or session.status == "CLOSED":
        raise Refused(404, "SESSION_DOES_NOT_EXIST")
    session.status = "CLOSED"
    return {}


@router.get("/accounts/{uid}/balances")
async def read_balances(uid: str, authorization: Annotated[str | None, Header()] = None):
    """Return an account's balances"""
    _, account = _session_account(_scenario_of(authorization), uid)
    return {
        "balances": [
            {
                "name": f"{kind} balance",
                "balance_amount": {"amount": amount, "currency": account.currency},
                "balance_type": kind,
                "last_change_date_time": None,
            }
            for kind, amount in account.balances.items()
        ]
    }


@router.get("/accounts/{uid}/transactions")
async def list_transactions(
    uid: str,
    date_from: str | None = None,
    date_to: str | None = None,
    continuation_key: str | None = None,
    strategy: str = "default",
    authorization: Annotated[str | None, Header()] = None,
):
    """Return a page of an account's transactions from date_from to date_to, both days included, with the key of the next page

    As Enable Banking documents it, the longest strategy ignores date_to and reads from date_from or the
    oldest day the bank shares, whichever is later. The default strategy refuses a range reaching further
    back than the bank shares
    """
    scenario = _scenario_of(authorization)
    _, account = _session_account(scenario, uid)
    first = date.fromisoformat(date_from) if date_from else None
    last = date.fromisoformat(date_to) if date_to else None
    if scenario.history_days is not None:
        oldest = date.today() - timedelta(days=scenario.history_days - 1)
        if strategy == "longest":
            first = max(first or oldest, oldest)
        elif first is None or first < oldest:
            raise Refused(422, "WRONG_TRANSACTIONS_PERIOD")
    if strategy == "longest":
        last = None
    matching = [
        item
        for item in account.transactions
        if (day := _day(item)) is None or ((first is None or day >= first) and (last is None or day <= last))
    ]
    offset = int(continuation_key.removeprefix(_CURSOR_PREFIX)) if continuation_key else 0
    page = matching[offset : offset + scenario.page_size]
    more = offset + scenario.page_size < len(matching)
    return {
        "transactions": [_wire_transaction(item, account) for item in page],
        "continuation_key": f"{_CURSOR_PREFIX}{offset + scenario.page_size}" if more else None,
    }


def _wire_transaction(item: Transaction, account: Account) -> dict:
    """Return a transaction as Enable Banking sends it"""
    return {
        "entry_reference": item.id,
        # Enable Banking may give a transaction a new transaction_id each time the list is read
        "transaction_id": str(uuid.uuid4()),
        "transaction_amount": {"amount": item.amount, "currency": item.currency or account.currency},
        "credit_debit_indicator": item.indicator,
        "status": item.status,
        "booking_date": item.booking_date,
        "value_date": None,
        "transaction_date": None,
        "remittance_information": [item.description] if item.description else [],
        "creditor": None,
        "debtor": None,
    }


def _public_origin(request: Request) -> str:
    """Return the origin the user's browser reaches the fake's bank pages at, which the app's own address for it may not be"""
    return (os.getenv("FAKE_ENABLE_BANKING_PUBLIC_ORIGIN") or str(request.base_url)).rstrip("/")


def _bank_page_of(scenario_id: str, authorization_id: str) -> tuple[Scenario, Authorization]:
    """Return a sign-in the bank page is for, or refuse as a bank does an expired one"""
    scenario = enable_banking.scenarios.get(scenario_id)
    pending = scenario.authorizations.get(authorization_id) if scenario else None
    if scenario is None or pending is None:
        raise Refused(404, "NOT_FOUND", "This sign-in has expired")
    return scenario, pending


def _return_to(pending: Authorization, **query: str) -> RedirectResponse:
    """Send the browser back to the redirect address with the state and an answer"""
    parts = urlsplit(pending.redirect_url)
    joined = urlencode([*query.items(), ("state", pending.state)])
    return RedirectResponse(urlunsplit((parts.scheme, parts.netloc, parts.path, joined, "")), status_code=303)


@router.get("/fake-bank/{scenario_id}/{authorization_id}", response_class=HTMLResponse)
async def bank_page(scenario_id: str, authorization_id: str):
    """The page a bank would show: a button to share the accounts and one to decline"""
    scenario, pending = _bank_page_of(scenario_id, authorization_id)
    base = f"/fake-bank/{scenario.id}/{pending.id}"
    return (
        f"<!doctype html><title>{html.escape(pending.bank_name)}</title>"
        f"<h1>{html.escape(pending.bank_name)}</h1><p>Lumina Finance asks to read your accounts.</p>"
        f'<p><a id="approve" href="{base}/approve">Share my accounts</a></p>'
        f'<p><a id="decline" href="{base}/decline">Decline</a></p>'
    )


@router.get("/fake-bank/{scenario_id}/{authorization_id}/approve")
async def approve(scenario_id: str, authorization_id: str):
    """Approve the sign-in, sending the browser back with a code that opens a session once"""
    _, pending = _bank_page_of(scenario_id, authorization_id)
    pending.code = f"code-{secrets.token_urlsafe(16)}"
    return _return_to(pending, code=pending.code)


@router.get("/fake-bank/{scenario_id}/{authorization_id}/decline")
async def decline(scenario_id: str, authorization_id: str):
    """Decline the sign-in, sending the browser back with the error a bank gives"""
    _, pending = _bank_page_of(scenario_id, authorization_id)
    return _return_to(pending, error="access_denied")


def refusal_response(refusal: Refused) -> JSONResponse:
    """Return a refusal as Enable Banking's error body"""
    return JSONResponse(refusal.body, status_code=refusal.status_code)
