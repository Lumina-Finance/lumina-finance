"""Stand-ins for Akahu's API, answering with the shapes its documentation shows

Bodies are written as JSON text, so an amount reaches the adapter exactly as typed, the way it would
arrive from Akahu, rather than as a float a test's own encoder had already changed
"""

import asyncio
from collections.abc import Callable
from datetime import datetime
from typing import Self
from zoneinfo import ZoneInfo

import httpx

from app.services.bank_sync.outbound import OutboundGuard
from app.services.bank_sync.providers.akahu.adapter import AkahuAdapter
from app.services.bank_sync.providers.contract import FetchResult
from tests.services.bank_sync.stand_ins import PUBLIC_ADDRESS, FixedResolver

AKAHU_ORIGIN = "https://api.akahu.io"
APP_ID_TOKEN = "app_token_cl0abc123"
USER_ACCESS_TOKEN = "user_token_9f3e77ab"

type Answer = httpx.Response | Exception | Callable[[httpx.Request], httpx.Response]


def akahu_adapter(transport: httpx.AsyncBaseTransport, *addresses: str) -> AkahuAdapter:
    """Return an Akahu adapter allowed to reach Akahu, with every request going to the transport only

    Args:
        transport: Where every request goes
        addresses: What every host resolves to, a public address by default
    """
    resolver = FixedResolver(*(addresses or (PUBLIC_ADDRESS,)))
    return AkahuAdapter(OutboundGuard([AKAHU_ORIGIN], resolve=resolver, transport=transport))


def json_response(body: str, status: int = 200) -> httpx.Response:
    """Return an answer carrying JSON text as written"""
    return httpx.Response(status, content=body.encode(), headers={"Content-Type": "application/json"})


def account(
    account_id: str = "acc_chq",
    *,
    connection_id: str = "conn_bank",
    connection_name: str = "Harbour Bank",
    name: str = "Everyday Chequing",
    status: str = "ACTIVE",
    attributes: str = '"TRANSACTIONS", "TRANSFER_FROM"',
    current: str = "100.00",
    available: str | None = "90.00",
    currency: str = "NZD",
    balance_refreshed: str | None = "2026-10-03T21:00:00.000Z",
    has_balance: bool = True,
) -> str:
    """Return one account as GET /accounts lists it, with the extra fields the adapter must not keep

    Akahu doesn't require a balance, so has_balance=False lists the account without one
    """
    available_text = "null" if available is None else available
    balance = (
        f'"balance": {{"current": {current}, "available": {available_text}, "currency": "{currency}", "overdrawn": false}}, '
        if has_balance
        else ""
    )
    refreshed = "" if balance_refreshed is None else f', "balance": "{balance_refreshed}"'
    return (
        f'{{"_id": "{account_id}", "_authorisation": "auth_1", '
        f'"connection": {{"_id": "{connection_id}", "name": "{connection_name}", "logo": "https://static.akahu.io/harbour.png"}}, '
        f'"name": "{name}", "status": "{status}", "type": "CHECKING", "formatted_account": "12-3456-7890123-00", '
        f'"attributes": [{attributes}], '
        f"{balance}"
        '"meta": {"holder": "Jane Q Holder", "address": {"suburb": "Karori"}}, '
        f'"refreshed": {{"meta": "2026-10-03T21:00:00.000Z"{refreshed}}}}}'
    )


def accounts_body(*accounts: str) -> str:
    """Return the body of GET /accounts"""
    return f'{{"success": true, "items": [{", ".join(accounts)}]}}'


def transaction(
    transaction_id: str = "trans_1",
    amount: str = "-4.50",
    *,
    account_id: str = "acc_chq",
    date: str = "2026-10-01T11:00:00.000Z",
    description: str = "EFTPOS BEAN THERE CAFE",
) -> str:
    """Return one transaction as GET /accounts/{id}/transactions sends it, the amount written as given"""
    return (
        f'{{"_id": "{transaction_id}", "_account": "{account_id}", "_connection": "conn_bank", '
        f'"created_at": "2026-10-02T01:00:00.000Z", "updated_at": "2026-10-02T01:00:00.000Z", '
        f'"date": "{date}", "description": "{description}", "amount": {amount}, "type": "EFTPOS", '
        '"merchant": {"_id": "merchant_1", "name": "Bean There", "website": "https://beanthere.example"}, '
        '"meta": {"particulars": "CARD 1234", "logo": "https://static.akahu.io/bean.png"}}'
    )


def transactions_body(*transactions: str, next_cursor: str | None = None) -> str:
    """Return the body of GET /accounts/{id}/transactions, with the cursor to its next page"""
    cursor = "null" if next_cursor is None else f'"{next_cursor}"'
    return f'{{"success": true, "items": [{", ".join(transactions)}], "cursor": {{"next": {cursor}}}}}'


def pending(
    amount: str = "-12.00",
    *,
    account_id: str = "acc_chq",
    date: str = "2026-10-03T11:00:00.000Z",
    description: str = "CARD PURCHASE FRESHWAY",
) -> str:
    """Return one pending transaction as GET /transactions/pending sends it, with no id"""
    return (
        f'{{"_account": "{account_id}", "_connection": "conn_bank", "updated_at": "2026-10-03T01:00:00.000Z", '
        f'"date": "{date}", "description": "{description}", "amount": {amount}, "type": "EFTPOS"}}'
    )


def pending_body(*items: str) -> str:
    """Return the body of GET /transactions/pending"""
    return f'{{"success": true, "items": [{", ".join(items)}]}}'


class AkahuApi:
    """A stand-in transport for Akahu's API, answering each path from what a test sets and recording every request

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
        """Answer a path under /v1 with a JSON body, a response, an error to raise or a function of the request"""
        self._answers[f"/v1{path}"] = json_response(answer, status) if isinstance(answer, str) else answer
        return self

    def serve_me(self) -> Self:
        """Answer GET /me as Akahu does for a personal app's tokens"""
        return self.serve("/me", '{"success": true, "item": {"_id": "user_1", "access_granted_at": "2026-09-01T00:00:00.000Z"}}')

    async def _answer(self, request: httpx.Request) -> httpx.Response:
        """Answer from what was set up, and 404 anything else"""
        self.requests.append(request)
        self._in_flight += 1
        self.most_in_flight = max(self.most_in_flight, self._in_flight)
        try:
            await asyncio.sleep(0.01)
        finally:
            self._in_flight -= 1

        answer = self._answers.get(request.url.path)
        if answer is None:
            return json_response('{"success": false, "message": "Not found"}', 404)
        if isinstance(answer, Exception):
            raise answer
        if callable(answer):
            return answer(request)
        return answer


EXPONENTS = {"NZD": 2, "JPY": 0}
CREDENTIAL = f'{{"app_id_token": "{APP_ID_TOKEN}", "user_access_token": "{USER_ACCESS_TOKEN}"}}'
TORONTO = ZoneInfo("America/Toronto")

# Three whole days in Toronto, 1 to 3 October 2026
WINDOW_START = datetime(2026, 10, 1, tzinfo=TORONTO)
WINDOW_END = datetime(2026, 10, 4, tzinfo=TORONTO)


async def fetch(
    adapter: AkahuAdapter,
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
