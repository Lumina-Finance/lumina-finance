"""A fake Enable Banking for development and tests

It speaks the API the way Enable Banking documents it: every request carries a token the application's
private key signed, POST /auth starts a sign-in at a bank and answers with the bank's page, the page
sends the browser back to the redirect address with a code and the state (or an error), POST /sessions
turns the code into a session once, and the session's accounts answer balances and transactions over an
inclusive range of days with a continuation key between pages. The control API under /control/scenarios
gives each test a scenario of its own, reached only by that scenario's application ID and private key,
and /docs lists every endpoint

It lives under tests/ because the production image copies only app/, alembic/ and scripts/

To run it as a server, from backend/ with the backend's environment:

    FAKE_ENABLE_BANKING_PUBLIC_ORIGIN=http://localhost:8794 \
    uvicorn --app-dir tests fake_enable_banking:app --host 127.0.0.1 --port 8794

--app-dir loads it as a package of its own, so tests/__init__.py doesn't run. That file points the
process at the test database. The app and the bank sync worker are given the same address as their
BANK_SYNC_ENABLE_BANKING_TEST_ORIGIN. The public origin is where the user's browser reaches the bank's
page, which differs from the app's address for the fake when the two run on different networks
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .api import Refused, refusal_response
from .api import router as api_router
from .control import router as control_router

app = FastAPI(title="Fake Enable Banking")
app.include_router(api_router)
app.include_router(control_router)


@app.exception_handler(Refused)
async def answer_refusal(_request: Request, refusal: Refused) -> JSONResponse:
    """Answer a refused request with Enable Banking's error body"""
    return refusal_response(refusal)


__all__ = ["app"]
