import httpx
import pytest

from tests.fake_simplefin_bridge import FakeBridgeTransport
from tests.fake_simplefin_bridge._helpers import BRIDGE_URL


@pytest.fixture
async def bridge():
    """An HTTP client on the fake Bridge, mounted in-process"""
    async with httpx.AsyncClient(transport=FakeBridgeTransport(), base_url=BRIDGE_URL) as client:
        yield client
