"""Stand-ins for Lunch Flow's Personal API, answering with the shapes its documentation shows

Bodies are written as JSON text, so an amount reaches the adapter exactly as typed, the way it would
arrive from Lunch Flow, rather than as a float a test's own encoder had already changed
"""

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from typing import Self

import httpx

from app.services.bank_sync.outbound import OutboundGuard
from app.services.bank_sync.providers.lunchflow.adapter import LunchFlowAdapter
from tests.services.bank_sync.stand_ins import PUBLIC_ADDRESS, FixedResolver

LUNCH_FLOW_ORIGIN = "https://www.lunchflow.app"
API_KEY = "lf_test_key_5e1d"

type Answer = httpx.Response | Exception | Callable[[httpx.Request], httpx.Response]


def lunchflow_adapter(transport: httpx.AsyncBaseTransport, *addresses: str) -> LunchFlowAdapter:
    """Return a Lunch Flow adapter allowed to reach Lunch Flow, with every request sent to the transport

    Args:
        transport: Where every request goes
        addresses: What every host resolves to, a public address by default
    """
    resolver = FixedResolver(*(addresses or (PUBLIC_ADDRESS,)))
    return LunchFlowAdapter(OutboundGuard([LUNCH_FLOW_ORIGIN], resolve=resolver, transport=transport))


def json_response(body: str, status: int = 200) -> httpx.Response:
    """Return an answer carrying JSON text as written"""
    return httpx.Response(status, content=body.encode(), headers={"Content-Type": "application/json"})


@dataclass(frozen=True)
class ListedAccount:
    """One account as GET /accounts lists it, kept with the id and currency a test serves its answers under"""

    account_id: int

    # None when the listing leaves the currency out
    currency: str | None
    json: str


def account(
    account_id: int = 11,
    *,
    connection_id: int = 7,
    name: str = "Everyday Chequing",
    institution: str = "Harbour Bank",
    currency: str | None = "CAD",
    status: str = "ACTIVE",
) -> ListedAccount:
    """Return one account as GET /accounts lists it, with the extra fields the adapter must not keep

    A currency of None leaves the field out, as Lunch Flow's live account list does
    """
    listed_currency = f'"currency": "{currency}", ' if currency is not None else ""
    return ListedAccount(
        account_id,
        currency,
        (
            f'{{"id": {account_id}, "connection_id": {connection_id}, "name": "{name}", "institution_name": "{institution}", '
            f'"institution_logo": "https://logo.example/harbour.png", "provider": "gocardless", {listed_currency}"status": "{status}"}}'
        ),
    )


def accounts_body(*accounts: ListedAccount) -> str:
    """Return the body of GET /accounts"""
    return f'{{"accounts": [{", ".join(listed.json for listed in accounts)}], "total": {len(accounts)}}}'


def balance_body(amount: str, currency: str = "CAD") -> str:
    """Return the body of GET /accounts/{id}/balance, the amount written as given"""
    return f'{{"balance": {{"amount": {amount}, "currency": "{currency}"}}}}'


def transaction(
    transaction_id: str | None = "t1",
    amount: str = "-4.50",
    *,
    account_id: int = 11,
    currency: str | None = "CAD",
    date: str = "2026-10-01",
    merchant: str | None = "Bean There",
    description: str | None = "EFTPOS BEAN THERE CAFE",
    pending: bool = False,
) -> str:
    """Return one transaction as GET /accounts/{id}/transactions sends it, the amount written as given

    A currency of None leaves the field out, and an id of None leaves the id out
    """

    def text(value: str | None) -> str:
        """Write a string or null"""
        return "null" if value is None else f'"{value}"'

    fields = [
        f'"accountId": {account_id}',
        f'"amount": {amount}',
        f'"date": "{date}"',
        f'"merchant": {text(merchant)}',
        f'"description": {text(description)}',
        f'"isPending": {"true" if pending else "false"}',
    ]
    if currency is not None:
        fields.insert(2, f'"currency": "{currency}"')
    if transaction_id is not None:
        fields.insert(0, f'"id": {text(transaction_id)}')
    return "{" + ", ".join(fields) + "}"


def transactions_body(*transactions: str, total: int | None = None) -> str:
    """Return the body of GET /accounts/{id}/transactions"""
    return f'{{"transactions": [{", ".join(transactions)}], "total": {len(transactions) if total is None else total}}}'


class LunchFlowApi:
    """A stand-in transport for Lunch Flow's API, answering each path from what a test sets and recording every request

    Each answer takes a moment, so requests sent together overlap and most_in_flight shows how many
    """

    def __init__(self) -> None:
        """Start with no path answered, so a request for one nobody set up is a 404"""
        self._answers: dict[str, Answer] = {}
        self.requests: list[httpx.Request] = []
        self.transport = httpx.MockTransport(self._answer)
        self.most_in_flight = 0
        self._in_flight = 0

    def paths(self) -> list[str]:
        """Return the path of every request received, in order"""
        return [request.url.path for request in self.requests]

    def serve(self, path: str, answer: str | Answer, status: int = 200) -> Self:
        """Answer a path under /api/v1 with a JSON body, a response, an error to raise or a function of the request"""
        self._answers[f"/api/v1{path}"] = json_response(answer, status) if isinstance(answer, str) else answer
        return self

    def serve_account(self, listed: ListedAccount, *, balance: str = "100.00", transactions: str | None = None, currency: str = "CAD") -> Self:
        """Answer an account's balance and transactions, the account itself listed by serve of /accounts

        The balance is in the listed currency, or in the currency given when the list sent none
        """
        self.serve(f"/accounts/{listed.account_id}/balance", balance_body(balance, listed.currency or currency))
        self.serve(f"/accounts/{listed.account_id}/transactions", transactions or transactions_body())
        return self

    async def _answer(self, request: httpx.Request) -> httpx.Response:
        """Answer from what was set up, and 404 anything else as Lunch Flow does an unknown path"""
        self.requests.append(request)
        self._in_flight += 1
        self.most_in_flight = max(self.most_in_flight, self._in_flight)
        try:
            await asyncio.sleep(0.01)
        finally:
            self._in_flight -= 1

        answer = self._answers.get(request.url.path)
        if answer is None:
            return json_response('{"error": "Not Found", "message": "No such route"}', 404)
        if isinstance(answer, Exception):
            raise answer
        if callable(answer):
            return answer(request)
        return answer
