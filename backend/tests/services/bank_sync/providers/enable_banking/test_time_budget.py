"""The time budget a bank sign-in gives its calls to Enable Banking

The user waits on both the start and the finish of a sign-in, so an Enable Banking that stops
answering ends either one while the browser still waits, with a reason the screen shows
"""

import asyncio
import json
from collections.abc import Callable

import httpx
import pytest

from app.services.bank_sync import outbound
from tests.routes.support.authorization_helpers import ORIGIN
from tests.routes.support.bank_sync_helpers import _sign_up, _stored_connections
from tests.services.bank_sync.fake_provider import use_adapter
from tests.services.bank_sync.providers.enable_banking.stand_ins import SUPPLIED, EnableBankingApi, enable_banking_adapter

# The budget these tests give a request, short to keep them quick
_BUDGET_SECONDS = 1.0

# Long past the budget, so a request still waiting then was never stopped by it
_GIVE_UP_SECONDS = 10


class _StallingApi(httpx.AsyncBaseTransport):
    """Forwards to the stand-in API, never answering a request to the path set to stall"""

    def __init__(self, api: EnableBankingApi) -> None:
        """Forward everything until a path is set to stall"""
        self._api = api
        self.stalled_path: str | None = None
        self.reached = asyncio.Event()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        """Hold a request to the stalled path for good, and forward any other"""
        if request.url.path == self.stalled_path:
            self.reached.set()
            await asyncio.Event().wait()
        return await self._api.transport.handle_async_request(request)


class _BudgetFromEachCall:
    """Stands in for the request's deadline, giving each provider call the short budget from when that call starts

    The real deadline counts from the start of the request, so on a busy machine the calls before the stalled one could
    spend the short budget and the stalled call would never be sent
    """

    def __init__(self, deadline) -> None:
        """Keep the real deadline, so a request outside the budget still has none"""
        self._deadline = deadline

    def get(self) -> float | None:
        """The short budget from now, or no deadline where the real one has none"""
        if self._deadline.get() is None:
            return None
        return asyncio.get_running_loop().time() + _BUDGET_SECONDS

    def set(self, value):
        """Set the real deadline"""
        return self._deadline.set(value)

    def reset(self, token) -> None:
        """Reset the real deadline"""
        self._deadline.reset(token)


@pytest.fixture
def shorten_budget(monkeypatch) -> Callable[[], None]:
    """Return the call that gives each later provider call the tests' short budget, made once setup is done so setup keeps the production one"""
    return lambda: monkeypatch.setattr(outbound, "_budget_deadline", _BudgetFromEachCall(outbound._budget_deadline))


@pytest.fixture
def api() -> EnableBankingApi:
    """The stand-in API, answering the bank list, the sign-in and an empty session"""
    return EnableBankingApi().serve_session()


@pytest.fixture
def stalling(api: EnableBankingApi, monkeypatch) -> _StallingApi:
    """Serve Enable Banking through the stand-in API, with no path stalled yet"""
    transport = _StallingApi(api)
    use_adapter(monkeypatch, enable_banking_adapter(transport))
    return transport


async def _start(client, headers):
    """Start a sign-in at Enable Banking through the route"""
    return await client.post(
        "/bank-sync/authorizations", json={"provider": "enable_banking", "credentials": SUPPLIED}, headers={**headers, "Origin": ORIGIN}
    )


async def test_start_when_enable_banking_stalls_answers_within_the_budget(client, stalling: _StallingApi, shorten_budget):
    """The sign-in request gets no answer, so the start stops at its budget and says Lumina Finance couldn't reach Enable Banking"""
    headers, _ = await _sign_up(client)
    shorten_budget()
    stalling.stalled_path = "/auth"

    async with asyncio.timeout(_GIVE_UP_SECONDS):
        refused = await _start(client, headers)

    assert stalling.reached.is_set()
    assert refused.status_code == 502, refused.text
    assert refused.json()["detail"] == "Lumina Finance couldn't reach Enable Banking. Please try again in a few minutes"


async def test_finish_when_enable_banking_stalls_answers_within_the_budget_and_saves_nothing(
    client, api: EnableBankingApi, stalling: _StallingApi, shorten_budget
):
    """The bank sent the user back, but the session request gets no answer, so the finish stops at its budget and says to connect again"""
    headers, _ = await _sign_up(client)
    started = await _start(client, headers)
    assert started.status_code == 201, started.text
    [sign_in] = [request for request in api.requests if request.url.path == "/auth"]
    state = json.loads(sign_in.content)["state"]
    shorten_budget()
    stalling.stalled_path = "/sessions"

    async with asyncio.timeout(_GIVE_UP_SECONDS):
        refused = await client.post("/bank-sync/authorizations/finish", json={"state": state, "code": "code-from-the-bank"}, headers=headers)

    assert stalling.reached.is_set()
    assert refused.status_code == 502, refused.text
    assert refused.json()["detail"] == "Enable Banking couldn't confirm your bank sign-in. Please connect again"
    assert await _stored_connections() == []
