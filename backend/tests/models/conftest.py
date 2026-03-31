import pytest

from tests.conftest import TestSession


@pytest.fixture
async def db():
    """Provide a database session for model tests."""
    async with TestSession() as session:
        yield session
