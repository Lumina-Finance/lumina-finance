import pytest

from tests.conftest import TestSession


@pytest.fixture
async def db():
    """Provide a database session for service tests."""
    async with TestSession() as session:
        yield session
