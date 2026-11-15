import httpx
import pytest

from tests.fake_lunchflow import app


@pytest.fixture
async def lunchflow():
    """An HTTP client on the fake Lunch Flow, mounted in-process"""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://lunchflow.test") as client:
        yield client
