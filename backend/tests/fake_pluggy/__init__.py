"""A fake Pluggy for development and tests

It speaks the application API the way Pluggy documents it: POST /auth turns a client ID and secret
into an API key sent as X-API-KEY, an item says how its bank connection stands, its accounts list on
one page, and transactions come from GET /v2/transactions over an inclusive range of days with an
opaque cursor between pages. Errors answer with the bodies live Pluggy sends. The control API under
/control/scenarios gives each test a scenario of its own, reached only by that scenario's client ID
and secret, and /docs lists every endpoint

It lives under tests/ because the production image copies only app/, alembic/ and scripts/

To run it as a server, from backend/ with the backend's environment:

    uvicorn --app-dir tests fake_pluggy:app --host 127.0.0.1 --port 8793

--app-dir loads it as a package of its own, so tests/__init__.py doesn't run. That file points the
process at the test database. The app and the bank sync worker are given the same address as their
BANK_SYNC_PLUGGY_TEST_ORIGIN
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .api import Refused, refusal_response
from .api import router as api_router
from .control import router as control_router

app = FastAPI(title="Fake Pluggy")
app.include_router(api_router)
app.include_router(control_router)


@app.exception_handler(Refused)
async def answer_refusal(_request: Request, refusal: Refused) -> JSONResponse:
    """Answer a refused request with Pluggy's error body"""
    return refusal_response(refusal)


__all__ = ["app"]
