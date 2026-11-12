import importlib

import pytest

from app.services.bank_sync import manual_entries
from tests.routes.support.manual_entry_helpers import NOW


@pytest.fixture(autouse=True)
def _pinned_now(pin_clock):
    """Pin the time the supplied-days check and the starting balance route read to 11pm on 3 October in Toronto"""
    pin_clock(NOW, manual_entries, importlib.import_module("app.routes.accounts.starting_balance_helpers"))
