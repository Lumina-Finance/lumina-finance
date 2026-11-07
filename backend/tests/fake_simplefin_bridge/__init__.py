"""A fake SimpleFIN Bridge for development and tests

It speaks SimpleFIN protocol version 2 the way SimpleFIN Bridge does: single-use setup tokens that
claim an access URL carrying Basic credentials, and /accounts with connections, errlist, payee and
memo, noon-UTC posted stamps, decimal-string amounts, balances-only reads, account filters, pending
transactions and a refusal of ranges over 90 days. The control API under /control/scenarios gives
each test a scenario of its own, reached only through that scenario's setup tokens, and /docs lists
every endpoint

It lives under tests/ because the production image copies only app/, alembic/ and scripts/

Backend tests mount it in-process through FakeBridgeTransport. To run it as a server, from backend/
with the backend's environment:

    BANK_SYNC_SIMPLEFIN_TEST_ORIGIN=http://127.0.0.1:8790 uvicorn --app-dir tests fake_simplefin_bridge:app --host 127.0.0.1 --port 8790

--app-dir loads it as a package of its own, so tests/__init__.py doesn't run. It points the process at the
test database. Give it the BANK_SYNC_SIMPLEFIN_TEST_ORIGIN the app is given for it, and
its setup tokens point there whatever address minted them
"""

import asyncio

import httpx
from fastapi import FastAPI

from .control import router as control_router
from .protocol import router as protocol_router

app = FastAPI(title="Fake SimpleFIN Bridge")
app.include_router(protocol_router)
app.include_router(control_router)


class FakeBridgeTransport(httpx.ASGITransport):
    """Mounts the fake in-process and applies the client's read timeout that ASGITransport ignores

    Without it a timeout fault would hold a test for the whole stall and then answer, where a
    request to the running server times out
    """

    def __init__(self) -> None:
        """Mount the shared app, with scenarios that keep each test's data apart"""
        super().__init__(app=app)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        """Answer the request in-process, raising ReadTimeout once the client's read timeout passes"""
        read_timeout = request.extensions.get("timeout", {}).get("read")
        try:
            async with asyncio.timeout(read_timeout):
                return await super().handle_async_request(request)
        except TimeoutError as error:
            raise httpx.ReadTimeout("The fake SimpleFIN Bridge didn't answer in time", request=request) from error


__all__ = ["FakeBridgeTransport", "app"]
