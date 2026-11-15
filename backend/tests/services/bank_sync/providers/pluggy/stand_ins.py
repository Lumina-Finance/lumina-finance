"""Stand-ins for Pluggy's API, answering with the shapes its documentation shows

Bodies are written as JSON text, so an amount reaches the adapter exactly as typed, the way it would
arrive from Pluggy, rather than as a float a test's own encoder had already changed
"""

import asyncio
from collections.abc import Callable
from datetime import datetime
from typing import Self
from zoneinfo import ZoneInfo

import httpx

from app.services.bank_sync.outbound import OutboundGuard
from app.services.bank_sync.providers.contract import FetchResult
from app.services.bank_sync.providers.pluggy import adapter as pluggy_module
from tests.services.bank_sync.stand_ins import PUBLIC_ADDRESS, FixedResolver

PLUGGY_ORIGIN = "https://api.pluggy.ai"
CLIENT_ID = "8c1f6e0a-2b54-4d7e-9a3c-5f0d1e2b3a4c"
CLIENT_SECRET = "d4e5f6a7-b8c9-4d0e-a1b2-c3d4e5f6a7b8"
API_KEY = "eyJhbGciOiJIUzI1NiJ9.stand-in-key"
ITEM_ID = "0b6f3c2e-91a4-4c7d-8e55-2d1a7f9b4c10"
OTHER_ITEM_ID = "7a2d9e41-3c68-4f05-b1e7-6c8d0a5f2b93"

type Answer = httpx.Response | Exception | Callable[[httpx.Request], httpx.Response]


def pluggy_adapter(transport: httpx.AsyncBaseTransport, *addresses: str) -> pluggy_module.PluggyAdapter:
    """Return a Pluggy adapter allowed to reach Pluggy, with every request going to the transport only

    Args:
        transport: Where every request goes
        addresses: What every host resolves to, a public address by default
    """
    resolver = FixedResolver(*(addresses or (PUBLIC_ADDRESS,)))
    return pluggy_module.PluggyAdapter(OutboundGuard([PLUGGY_ORIGIN], resolve=resolver, transport=transport))


def json_response(body: str, status: int = 200) -> httpx.Response:
    """Return an answer carrying JSON text as written"""
    return httpx.Response(status, content=body.encode(), headers={"Content-Type": "application/json"})


def item(
    item_id: str = ITEM_ID,
    *,
    status: str = "UPDATED",
    execution_status: str = "SUCCESS",
    connector_id: int = 612,
    connector_name: str | None = "Banco Aurora",
    last_updated: str | None = "2026-10-03T21:00:00.000Z",
) -> str:
    """Return one item as GET /items/{id} sends it, with the extra fields the adapter must not keep, and no connector name when None"""
    updated = "null" if last_updated is None else f'"{last_updated}"'
    named = "" if connector_name is None else f'"name": "{connector_name}", '
    return (
        f'{{"id": "{item_id}", "connector": {{"id": {connector_id}, {named}'
        '"institutionUrl": "https://aurora.example", "imageUrl": "https://cdn.example/aurora.png", "isSandbox": false}, '
        f'"status": "{status}", "executionStatus": "{execution_status}", "lastUpdatedAt": {updated}, '
        '"createdAt": "2026-09-01T00:00:00.000Z", "error": null, "parameter": {"cpf": "123.456.789-09"}, '
        '"consentExpiresAt": "2027-09-01T00:00:00.000Z", "clientUserId": "user-77"}'
    )


def account(
    account_id: str = "acc-chk",
    *,
    item_id: str = ITEM_ID,
    kind: str = "BANK",
    name: str = "Conta Corrente",
    balance: str = "1500.50",
    currency: str = "BRL",
) -> str:
    """Return one account as GET /accounts lists it, with the extra fields the adapter must not keep"""
    subtype = "CREDIT_CARD" if kind == "CREDIT" else "CHECKING_ACCOUNT"
    return (
        f'{{"id": "{account_id}", "type": "{kind}", "subtype": "{subtype}", "name": "{name}", "marketingName": "Aurora Premium", '
        f'"number": "0001/123456-7", "owner": "MARIA S SOUZA", "taxNumber": "123.456.789-09", "balance": {balance}, '
        f'"currencyCode": "{currency}", "itemId": "{item_id}", "createdAt": "2026-09-01T00:00:00.000Z", '
        '"updatedAt": "2026-10-03T21:00:00.000Z", "bankData": {"transferNumber": "0001/123456-7"}, '
        '"creditData": {"creditLimit": 8000, "availableCreditLimit": 7000}}'
    )


def accounts_body(*accounts: str, total_pages: int = 1) -> str:
    """Return the body of GET /accounts"""
    return f'{{"page": 1, "total": {len(accounts)}, "totalPages": {total_pages}, "results": [{", ".join(accounts)}]}}'


def transaction(
    transaction_id: str = "tx-1",
    amount: str = "-4.50",
    *,
    date: str = "2026-10-01T11:00:00.000Z",
    description: str = "PADARIA SOL NASCENTE",
    status: str = "POSTED",
    currency: str = "BRL",
    in_account_currency: str | None = None,
) -> str:
    """Return one transaction as GET /v2/transactions sends it, the amount written as given"""
    converted = "" if in_account_currency is None else f'"amountInAccountCurrency": {in_account_currency}, '
    return (
        f'{{"id": "{transaction_id}", "description": "{description}", "descriptionRaw": "{description} SAO PAULO", '
        f'"currencyCode": "{currency}", "amount": {amount}, {converted}"date": "{date}", "category": "Food", '
        f'"status": "{status}", "type": "DEBIT", "merchant": {{"name": "Padaria Sol", "cnpj": "12.345.678/0001-95"}}, '
        '"paymentData": {"payer": {"documentNumber": {"value": "123.456.789-09"}}}}'
    )


def next_page(account_id: str, after: str) -> str:
    """Return the query string Pluggy's next cursor is, holding only the account and the position as its published example does"""
    return f"?accountId={account_id}&after={after}"


def transactions_body(*transactions: str, next_query: str | None = None) -> str:
    """Return the body of GET /v2/transactions, with the query of its next page"""
    cursor = "null" if next_query is None else f'"{next_query}"'
    return f'{{"results": [{", ".join(transactions)}], "next": {cursor}}}'


class PluggyApi:
    """A stand-in transport for Pluggy's API, answering each path from what a test sets and recording every request

    Each answer takes a moment, so requests sent together overlap and most_in_flight shows how many
    """

    def __init__(self) -> None:
        """Start with nothing answered, so a request for anything nobody set up is a 404"""
        self._answers: dict[str, Answer] = {}
        self._accounts: dict[str, Answer] = {}
        self._transactions: dict[str, Answer] = {}
        self.requests: list[httpx.Request] = []
        self.transport = httpx.MockTransport(self._answer)
        self.most_in_flight = 0
        self._in_flight = 0

    def paths(self) -> list[str]:
        """Return the path of every request received, in order"""
        return [request.url.path for request in self.requests]

    def serve(self, path: str, answer: str | Answer, status: int = 200) -> Self:
        """Answer a path with a JSON body, a response, an error to raise or a function of the request"""
        self._answers[path] = json_response(answer, status) if isinstance(answer, str) else answer
        return self

    def serve_sign_in(self) -> Self:
        """Answer POST /auth as Pluggy does for an application's client ID and secret"""
        return self.serve("/auth", f'{{"apiKey": "{API_KEY}"}}')

    def serve_item(self, item_body: str, *accounts: str, item_id: str = ITEM_ID) -> Self:
        """Answer GET /items/{id} and the item's accounts"""
        self.serve(f"/items/{item_id}", item_body)
        self._accounts[item_id] = json_response(accounts_body(*accounts))
        return self

    def serve_accounts(self, item_id: str, answer: str | Answer, status: int = 200) -> Self:
        """Answer the listing of one item's accounts"""
        self._accounts[item_id] = json_response(answer, status) if isinstance(answer, str) else answer
        return self

    def serve_transactions(self, account_id: str, answer: str | Answer, status: int = 200) -> Self:
        """Answer the transactions of one account, every page"""
        self._transactions[account_id] = json_response(answer, status) if isinstance(answer, str) else answer
        return self

    async def _answer(self, request: httpx.Request) -> httpx.Response:
        """Answer from what was set up, and 404 anything else"""
        self.requests.append(request)
        self._in_flight += 1
        self.most_in_flight = max(self.most_in_flight, self._in_flight)
        try:
            await asyncio.sleep(0.01)
        finally:
            self._in_flight -= 1

        path = request.url.path
        if path == "/accounts":
            answer = self._accounts.get(request.url.params.get("itemId", ""))
        elif path == "/v2/transactions":
            answer = self._transactions.get(request.url.params.get("accountId", ""))
        else:
            answer = self._answers.get(path)
        if answer is None:
            return json_response('{"code": 404, "message": "Not found"}', 404)
        if isinstance(answer, Exception):
            raise answer
        if callable(answer):
            return answer(request)
        return answer


EXPONENTS = {"BRL": 2, "USD": 2, "JPY": 0}
CREDENTIAL = f'{{"client_id": "{CLIENT_ID}", "client_secret": "{CLIENT_SECRET}", "item_ids": ["{ITEM_ID}"]}}'
TORONTO = ZoneInfo("America/Toronto")

# Three whole days in Toronto, 1 to 3 October 2026
WINDOW_START = datetime(2026, 10, 1, tzinfo=TORONTO)
WINDOW_END = datetime(2026, 10, 4, tzinfo=TORONTO)


async def fetch(
    adapter: pluggy_module.PluggyAdapter,
    *account_ids: str,
    start: datetime = WINDOW_START,
    end: datetime = WINDOW_END,
    include_pending: bool = False,
    timezone: ZoneInfo = TORONTO,
) -> FetchResult:
    """Fetch a window of records for accounts"""
    return await adapter.fetch(
        CREDENTIAL,
        account_ids=account_ids,
        start=start,
        end=end,
        include_pending=include_pending,
        timezone=timezone,
        currency_exponents=EXPONENTS,
    )
