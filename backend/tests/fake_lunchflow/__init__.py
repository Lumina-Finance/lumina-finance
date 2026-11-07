"""A fake Lunch Flow for development and tests

It speaks the Personal API the way Lunch Flow documents it: an x-api-key header, accounts with their
connection and status, a balance per account, and transactions per account over inclusive dates with
pending ones only when asked for. The control API under /control/scenarios gives each test a
scenario of its own, reached only by that scenario's API key, and /docs lists every endpoint

It lives under tests/ because the production image copies only app/, alembic/ and scripts/

To run it as a server, from backend/ with the backend's environment:

    uvicorn --app-dir tests fake_lunchflow:app --host 127.0.0.1 --port 8791

--app-dir loads it as a package of its own, so tests/__init__.py doesn't run and the process isn't
pointed at the test database. The app and the bank sync worker are given the same address as their
BANK_SYNC_LUNCHFLOW_TEST_ORIGIN
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .api import Refused, refusal_response
from .api import router as api_router
from .control import router as control_router

app = FastAPI(title="Fake Lunch Flow")
app.include_router(api_router)
app.include_router(control_router)


@app.exception_handler(Refused)
async def answer_refusal(_request: Request, refusal: Refused) -> JSONResponse:
    """Answer a refused request with Lunch Flow's error body"""
    return refusal_response(refusal)


__all__ = ["app"]
