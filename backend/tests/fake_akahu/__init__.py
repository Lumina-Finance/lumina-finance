"""A fake Akahu for development and tests

It speaks the personal app API the way Akahu documents it: an Authorization bearer header with the
user access token and an X-Akahu-Id header with the app ID token, accounts with their connection,
status and balance, transactions per account over an exclusive start and an inclusive end with a
cursor between pages, and the pending transactions of every account at once. The control API under
/control/scenarios gives each test a scenario of its own, reached only by that scenario's pair of
tokens, and /docs lists every endpoint

It lives under tests/ because the production image copies only app/, alembic/ and scripts/

To run it as a server, from backend/ with the backend's environment:

    uvicorn --app-dir tests fake_akahu:app --host 127.0.0.1 --port 8792

--app-dir loads it as a package of its own, so tests/__init__.py doesn't run. That file points the
process at the test database. The app and the bank sync worker are given the same address as their
BANK_SYNC_AKAHU_TEST_ORIGIN
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .api import Refused, refusal_response
from .api import router as api_router
from .control import router as control_router

app = FastAPI(title="Fake Akahu")
app.include_router(api_router)
app.include_router(control_router)


@app.exception_handler(Refused)
async def answer_refusal(_request: Request, refusal: Refused) -> JSONResponse:
    """Answer a refused request with Akahu's error body"""
    return refusal_response(refusal)


__all__ = ["app"]
