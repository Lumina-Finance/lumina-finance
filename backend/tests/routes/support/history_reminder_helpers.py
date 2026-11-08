"""Shared builders for the history reminder and cut-off day route tests"""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import update

from app.models.bank_connection import BankAccountLink
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _commit_link, _commit_listed_connection, _new_account, _sign_up

# Noon on October 5 in Toronto, the zone _sign_up stores
_NOW = datetime(2026, 10, 5, 12, 0, tzinfo=ZoneInfo("America/Toronto"))

# Everyday's import from 1 June got history from 9 June
_FELL_SHORT = {"history_reminder_start": date(2026, 6, 1), "history_reminder_earliest": date(2026, 6, 9)}
_SHOWN = {"requested_start": "2026-06-01", "earliest_returned": "2026-06-09"}

# 2 October came back as long as Fake Bank's longest response
_CUT_SHORT = {"cut_off_day": date(2026, 10, 2)}


async def _linked_everyday(client, **link_values) -> tuple[dict, str, BankAccountLink]:
    """Sign up with Everyday linked to Fake Bank, its import ended and synced through today an hour ago, its link's values set as given

    Returns:
        The auth headers, Everyday's id and its link
    """
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    link = await _commit_link(account_id, connection, importing=False, last_success_at=_NOW - timedelta(hours=1), **link_values)
    async with TestSession() as session:
        await session.execute(update(BankAccountLink).where(BankAccountLink.id == link.id).values(checkpoint=_NOW.date()))
        await session.commit()
    return headers, account_id, link
