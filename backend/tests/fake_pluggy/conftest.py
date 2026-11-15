import httpx
import pytest

from tests.fake_pluggy import app


@pytest.fixture
async def pluggy():
    """An HTTP client on the fake Pluggy, mounted in-process"""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://pluggy.test") as client:
        yield client
