from collections.abc import Iterator
from datetime import datetime

import pytest
from freezegun import freeze_time

from app.models.bank_connection import BankConnection
from app.models.currency import Currency
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _build_bank_connection, _build_user
from tests.services.bank_sync.stand_ins import FROZEN_NOW


@pytest.fixture
async def connections() -> list[BankConnection]:
    """Commit four connections, each with its own owner, so the worker's sessions can see them"""
    async with TestSession() as session:
        session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
        await session.flush()
        users = [_build_user(f"owner{index}@example.com") for index in range(4)]
        session.add_all(users)
        await session.flush()
        built = [_build_bank_connection(user.id) for user in users]
        session.add_all(built)
        await session.commit()
    return built


@pytest.fixture
def frozen_now() -> Iterator[datetime]:
    """Freeze the clock at FROZEN_NOW, leaving asyncio's own clock running so timeouts still fire"""
    with freeze_time(FROZEN_NOW, real_asyncio=True):
        yield FROZEN_NOW
