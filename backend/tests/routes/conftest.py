from datetime import datetime
from types import ModuleType
from typing import Annotated

import pytest
from fastapi import Depends

from app.database import current_user_id_ctx, get_db, get_session_factory
from app.dependencies import get_current_user
from app.main import app
from app.models.user import User
from app.services.email import contract as email_contract
from app.services.importers.background_save import run_import_save
from app.services.importers.shared import run_save
from app.services.importers.shared.run_save import set_import_save_starter
from tests.conftest import ScopedSession
from tests.routes.support.clock_helpers import _FixedClock
from tests.routes.support.mailbox import mailbox
from tests.routes.support.marker_guard import MarkerGuardClient


async def _override_get_db():
    """Override the app's DB dependency to use the row-level-security test session

    Connects as the app role so route tests run under the policies exactly as
    production does, confirming legitimate access is never blocked

    Yields:
        An async SQLAlchemy session bound to the test database as the app role
    """
    # Clear any inherited identity so a request can only ever stamp its own user,
    # matching the production dependency
    current_user_id_ctx.set(None)
    async with ScopedSession() as session:
        yield session


app.dependency_overrides[get_db] = _override_get_db

# Work a route runs after its response opens its sessions from this factory instead of get_db
app.dependency_overrides[get_session_factory] = lambda: ScopedSession


# Test-only route to exercise the get_current_user dependency
@app.get("/test/me")
async def _test_me(user: Annotated[User, Depends(get_current_user)]):
    """Return the current user payload for auth dependency tests

    Args:
        user: Current authenticated user resolved by the dependency

    Returns:
        Minimal user identity payload
    """
    return {"id": str(user.id), "email": user.email}


@pytest.fixture(autouse=True)
def captured_email(monkeypatch):
    """Install the capturing sender for the test, so sign-ups can read their emailed links

    Returns:
        The sender, empty at the start of each test
    """
    mailbox.sent.clear()
    monkeypatch.setattr(email_contract, "_active_sender", mailbox)
    return mailbox


@pytest.fixture(autouse=True)
def save_imports_inline(monkeypatch) -> None:
    """Run each import's save as the request for it ends, so a test reads its outcome without waiting

    The save runs on the test database as the app role, as the app's own runner does in production
    """

    async def start_save(run_id, owner_id) -> None:
        await run_import_save(run_id, owner_id, ScopedSession)

    # Put back whatever starter a test installs
    monkeypatch.setattr(run_save, "_custom_starter", None)
    set_import_save_starter(start_save)


@pytest.fixture
def pin_clock(monkeypatch):
    """Return a function pinning the time that modules read to one instant, for this test only

    Only the modules named have their datetime replaced with a fixed clock, so every other module
    and the database's own clock keep the real time

    Returns:
        A function taking the instant and the modules to pin
    """

    def pin(instant: datetime, *modules: ModuleType) -> None:
        """Make each module's datetime.now return the instant"""
        for module in modules:
            monkeypatch.setattr(module, "datetime", _FixedClock(instant))

    return pin


@pytest.fixture
async def client():
    """Provide an async HTTP client wired to the FastAPI app with the test database

    Yields:
        An httpx AsyncClient bound to the FastAPI app, which also checks that every
        successful signed-in write moved a change marker
    """
    async with MarkerGuardClient() as c:
        yield c
