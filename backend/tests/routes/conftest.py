import pytest
from httpx import ASGITransport, AsyncClient

from app.database import get_db
from app.main import app
from tests.conftest import TestSession


async def _override_get_db():
    """Override the app's DB dependency to use the test database."""
    async with TestSession() as session:
        yield session


app.dependency_overrides[get_db] = _override_get_db


@pytest.fixture
async def client():
    """Provide an async HTTP client wired to the FastAPI app with the test database."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
