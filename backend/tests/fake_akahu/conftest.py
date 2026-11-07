import httpx
import pytest

from tests.fake_akahu import app


@pytest.fixture
async def akahu():
    """An HTTP client on the fake Akahu, mounted in-process"""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://akahu.test") as client:
        yield client
