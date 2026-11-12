"""Shared bank link route test builders"""

import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from app.models.bank_connection import BankConnection
from tests.routes.support.bank_sync_helpers import _commit_listed_connection, _new_account, _sign_up

# Noon on October 4 in Toronto, the zone _sign_up stores
_NOW = datetime(2026, 10, 4, 12, 0, tzinfo=ZoneInfo("America/Toronto"))


async def _linkable(client, name: str = "Everyday") -> tuple[dict, uuid.UUID, str, BankConnection]:
    """Sign up with an empty CAD account and a connection listing one CAD bank account at Harbour Bank"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, name)
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    return headers, user_id, account_id, connection
