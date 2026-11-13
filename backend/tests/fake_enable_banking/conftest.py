import httpx
import pytest

from tests.fake_enable_banking import app


@pytest.fixture
async def enable_banking():
    """An HTTP client on the fake Enable Banking, mounted in-process"""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://enable-banking.test") as client:
        yield client
