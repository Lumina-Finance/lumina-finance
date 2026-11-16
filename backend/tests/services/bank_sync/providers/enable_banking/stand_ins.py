"""Stand-ins for Enable Banking's API, answering with the shapes its documentation shows

Bodies are written as JSON text, so an amount reaches the adapter exactly as typed, the way it would
arrive from Enable Banking, rather than as a float a test's own encoder had already changed. Every
request's token is checked against the application's public key
"""

import asyncio
import json
from collections.abc import Callable
from datetime import datetime
from typing import Self
from zoneinfo import ZoneInfo

import httpx
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.services.bank_sync.outbound import OutboundGuard
from app.services.bank_sync.providers.contract import FetchResult
from app.services.bank_sync.providers.enable_banking import adapter as enable_banking_module
from tests.services.bank_sync.stand_ins import PUBLIC_ADDRESS, FixedResolver

ENABLE_BANKING_ORIGIN = "https://api.enablebanking.com"
APPLICATION_ID = "5a3f9c1e-7b24-4d86-a0e5-3c1d8f2b6a47"
SESSION_ID = "9e2b7d40-1c85-4f3a-b6d9-0a4e5c8f1b23"
REDIRECT_URL = "https://app.example/settings/bank-authorization"
STATE = "state-from-the-engine"
CODE = "code-from-the-bank"
BANK = "Aurora Bank"
COUNTRY = "FI"

_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PRIVATE_KEY = _KEY.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
_PUBLIC_KEY = _KEY.public_key()

# Two accounts the session shares, a current account and a card
CHECKING = "hash-checking"
CARD = "hash-card"

type Answer = httpx.Response | Exception | Callable[[httpx.Request], httpx.Response]


def enable_banking_adapter(transport: httpx.AsyncBaseTransport) -> enable_banking_module.EnableBankingAdapter:
    """Return an adapter allowed to reach Enable Banking, with every request going to the transport only"""
    guard = OutboundGuard([ENABLE_BANKING_ORIGIN], resolve=FixedResolver(PUBLIC_ADDRESS), transport=transport)
    return enable_banking_module.EnableBankingAdapter(guard)


def json_response(body: str, status: int = 200) -> httpx.Response:
    """Return an answer carrying JSON text as written"""
    return httpx.Response(status, content=body.encode(), headers={"Content-Type": "application/json"})


def error_response(code: str, status: int = 400) -> httpx.Response:
    """Return an error as Enable Banking sends one"""
    return json_response(f'{{"message": "failed", "code": {status}, "error": "{code}", "detail": null}}', status)


def aspsps_body(*banks: tuple[str, str, int | None]) -> str:
    """Return the body of GET /aspsps for banks given as name, country and consent validity in seconds"""
    listed = ", ".join(
        f'{{"name": "{name}", "country": "{country}", "maximum_consent_validity": {"null" if seconds is None else seconds}, "logo": "x"}}'
        for name, country, seconds in banks
    )
    return f'{{"aspsps": [{listed}]}}'


HOLDER = "Alex Sample"


def session_account(
    uid: str | None,
    identification_hash: str,
    *,
    details: str | None = "Everyday",
    product: str | None = "Current account",
    currency: str = "EUR",
) -> str:
    """Return one account of a new session, with the extra fields the adapter must not keep

    The documented `name` holds the account holder's name. A uid of None leaves it out, as Enable Banking does for an
    account it knows can't be read
    """
    fields = {
        **({"uid": uid} if uid is not None else {}),
        "identification_hash": identification_hash,
        "account_id": {"iban": "FI2112345600000785"},
        "name": HOLDER,
        "details": details,
        "product": product,
        "currency": currency,
        "cash_account_type": "CACC",
        "credit_limit": None,
    }
    return json.dumps(fields)


def session_body(*accounts: str, bank: str = BANK) -> str:
    """Return the body of POST /sessions"""
    return (
        f'{{"session_id": "{SESSION_ID}", "accounts": [{", ".join(accounts)}], '
        f'"aspsp": {{"name": "{bank}", "country": "{COUNTRY}"}}, "psu_type": "personal"}}'
    )


def balance(
    kind: str,
    amount: str,
    currency: str = "EUR",
    *,
    changed: str | None = "2026-10-03T21:00:00Z",
    reference_date: str | None = None,
) -> str:
    """Return one balance as GET /accounts/{uid}/balances lists it, dated by when it last changed and the day it is for"""
    changed_text = "null" if changed is None else json.dumps(changed)
    reference_text = "null" if reference_date is None else json.dumps(reference_date)
    return (
        f'{{"name": "{kind} balance", "balance_type": "{kind}", "balance_amount": {{"amount": "{amount}", "currency": "{currency}"}}, '
        f'"last_change_date_time": {changed_text}, "reference_date": {reference_text}}}'
    )


def balances_body(*balances: str) -> str:
    """Return the body of GET /accounts/{uid}/balances"""
    return f'{{"balances": [{", ".join(balances)}]}}'


def transaction(
    amount: str = "4.50",
    *,
    indicator: str = "DBIT",
    status: str = "BOOK",
    entry_reference: str | None = "ref-1",
    transaction_id: str | None = "tx-1",
    booking_date: str | None = "2026-10-01",
    value_date: str | None = None,
    transaction_date: str | None = None,
    remittance: str = "PADARIA SOL",
    note: str | None = None,
    currency: str = "EUR",
    debtor: str | None = None,
) -> str:
    """Return one transaction as GET /accounts/{uid}/transactions sends it, the amount written as given"""

    def text(value: str | None) -> str:
        """Write a nullable string as JSON"""
        return "null" if value is None else json.dumps(value)

    payer = "null" if debtor is None else json.dumps({"name": debtor})
    return (
        f'{{"entry_reference": {text(entry_reference)}, "transaction_id": {text(transaction_id)}, '
        f'"transaction_amount": {{"amount": "{amount}", "currency": "{currency}"}}, "credit_debit_indicator": "{indicator}", '
        f'"status": "{status}", "booking_date": {text(booking_date)}, "value_date": {text(value_date)}, '
        f'"transaction_date": {text(transaction_date)}, "remittance_information": [{json.dumps(remittance)}], '
        f'"creditor": {{"name": "Padaria Sol"}}, "debtor": {payer}, "bank_transaction_code": {{"code": "PMNT"}}, "note": {text(note)}}}'
    )


def transactions_body(*transactions: str, continuation_key: str | None = None) -> str:
    """Return the body of GET /accounts/{uid}/transactions"""
    key = "null" if continuation_key is None else json.dumps(continuation_key)
    return f'{{"transactions": [{", ".join(transactions)}], "continuation_key": {key}}}'


class EnableBankingApi:
    """A stand-in transport for Enable Banking's API, answering each path from what a test sets and recording every request

    A request whose token the application's key didn't sign, or that names another application, is a 401.
    Each answer takes a moment, so requests sent together overlap and most_in_flight shows how many
    """

    def __init__(self) -> None:
        """Start with nothing answered, so a request for anything nobody set up is a 404"""
        self._answers: dict[tuple[str, str], Answer] = {}
        self.requests: list[httpx.Request] = []
        self.transport = httpx.MockTransport(self._answer)
        self.most_in_flight = 0
        self._in_flight = 0

    def paths(self) -> list[str]:
        """Return the method and path of every request received, in order"""
        return [f"{request.method} {request.url.path}" for request in self.requests]

    def serve(self, method: str, path: str, answer: str | Answer, status: int = 200) -> Self:
        """Answer a method and path with a JSON body, a response, an error to raise or a function of the request"""
        self._answers[(method, path)] = json_response(answer, status) if isinstance(answer, str) else answer
        return self

    def serve_session(self, *accounts: str) -> Self:
        """Answer the bank list, the sign-in and the session for the one bank, as a new connection sees them"""
        self.serve("GET", "/aspsps", aspsps_body((BANK, COUNTRY, 7_776_000), ("Other Bank", COUNTRY, None)))
        self.serve("POST", "/auth", '{"url": "https://bank.example/sign-in?x=1", "authorization_id": "auth-1"}')
        return self.serve("POST", "/sessions", session_body(*accounts))

    def serve_account(self, uid: str, *, balances: str | Answer, transactions: str | Answer) -> Self:
        """Answer one account's balances and every page of its transactions"""
        self.serve("GET", f"/accounts/{uid}/balances", balances)
        return self.serve("GET", f"/accounts/{uid}/transactions", transactions)

    async def _answer(self, request: httpx.Request) -> httpx.Response:
        """Check the token, then answer from what was set up and 404 anything else"""
        self.requests.append(request)
        self._in_flight += 1
        self.most_in_flight = max(self.most_in_flight, self._in_flight)
        try:
            await asyncio.sleep(0.01)
        finally:
            self._in_flight -= 1

        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        try:
            headers = jwt.get_unverified_header(token)
            jwt.decode(
                token,
                _PUBLIC_KEY,
                algorithms=["RS256"],
                audience="api.enablebanking.com",
                issuer="enablebanking.com",
                options={"require": ["exp", "iat"]},
            )
        except jwt.PyJWTError:
            return error_response("UNAUTHORIZED_ACCESS", 401)
        if headers.get("kid") != APPLICATION_ID:
            return error_response("UNAUTHORIZED_ACCESS", 401)

        answer = self._answers.get((request.method, request.url.path))
        if answer is None:
            return json_response('{"message": "Not found", "code": 404, "error": "NOT_FOUND"}', 404)
        if isinstance(answer, Exception):
            raise answer
        if callable(answer):
            return answer(request)
        return answer


EXPONENTS = {"EUR": 2, "USD": 2, "JPY": 0}
SUPPLIED = {"application_id": APPLICATION_ID, "private_key": PRIVATE_KEY, "country": "fi", "bank": "aurora BANK"}
TORONTO = ZoneInfo("America/Toronto")

# Three whole days in Toronto, 1 to 3 October 2026
WINDOW_START = datetime(2026, 10, 1, tzinfo=TORONTO)
WINDOW_END = datetime(2026, 10, 4, tzinfo=TORONTO)


def stored_credential(*accounts: tuple[str, str, str, str]) -> str:
    """Return the credential a claim stores, for accounts given as uid, identification hash, label and currency"""
    return json.dumps(
        {
            "application_id": APPLICATION_ID,
            "private_key": PRIVATE_KEY,
            "session_id": SESSION_ID,
            "bank": BANK,
            "country": COUNTRY,
            "accounts": [
                {"uid": uid, "identification_hash": ident, "details": label, "currency": currency} for uid, ident, label, currency in accounts
            ],
        }
    )


CREDENTIAL = stored_credential(("uid-checking", CHECKING, "Everyday", "EUR"), ("uid-card", CARD, "Visa", "EUR"))


async def fetch(
    adapter: enable_banking_module.EnableBankingAdapter,
    *account_ids: str,
    credential: str = CREDENTIAL,
    start: datetime = WINDOW_START,
    end: datetime = WINDOW_END,
    include_pending: bool = False,
    timezone: ZoneInfo = TORONTO,
) -> FetchResult:
    """Fetch a window of records for accounts"""
    return await adapter.fetch(
        credential,
        account_ids=account_ids,
        start=start,
        end=end,
        include_pending=include_pending,
        timezone=timezone,
        currency_exponents=EXPONENTS,
    )
