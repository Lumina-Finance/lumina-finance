"""Shared builders for the opening adjustment route tests"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import update

from app.models.bank_connection import BankAccountLink, OpeningAdjustmentState
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _commit_bank_balance,
    _commit_link,
    _commit_listed_connection,
    _new_account,
    _record_ledger,
    _sign_up,
)

_TORONTO = ZoneInfo("America/Toronto")

# Noon on October 5 in Toronto, the zone _sign_up stores
_NOW = datetime(2026, 10, 5, 12, 0, tzinfo=_TORONTO)

# 6:00 PM on October 3 in Toronto
_BALANCE_AT = datetime(2026, 10, 3, 18, 0, tzinfo=_TORONTO)

# Everyday's import starts on 1 June, so its opening adjustment is dated 31 May
_IMPORT_START = date(2026, 6, 1)


@dataclass(frozen=True)
class _Everyday:
    """A signed-up user's Everyday account, linked to Fake Bank from 1 June"""

    headers: dict
    account_id: str
    link: BankAccountLink

    # The ledger transactions recorded before linking, in the order given
    ledger_ids: list[str]


async def _linked_everyday(
    client,
    *ledger: tuple[str, int],
    tz: str | None = None,
    account_kind: str = "asset",
    account_type: str = "checking",
    bank: dict | None = None,
    **link_values,
) -> _Everyday:
    """Sign up, record the ledger on a new Everyday account, give its bank account a balance and link it after its import, synced an hour ago

    The bank's balance is 1,250.00 as of _BALANCE_AT unless told otherwise
    """
    headers, user_id = await _sign_up(client)
    if tz is not None:
        moved = await client.patch("/me", json={"tz": tz}, headers=headers)
        assert moved.status_code == 200, moved.text
    account_id = await _new_account(client, headers, "Everyday", account_kind=account_kind, account_type=account_type)
    ledger_ids = await _record_ledger(client, headers, account_id, *ledger)
    connection = await _commit_listed_connection(user_id, discovered_at=_NOW)
    await _commit_bank_balance(connection, **{"balance": 125000, "balance_at": _BALANCE_AT, **(bank or {})})
    link = await _commit_link(account_id, connection, **{"importing": False, "last_success_at": _NOW - timedelta(hours=1), **link_values})
    async with TestSession() as session:
        await session.execute(
            update(BankAccountLink).where(BankAccountLink.id == link.id).values(import_start=_IMPORT_START, checkpoint=_NOW.date())
        )
        await session.commit()
    return _Everyday(headers, account_id, link, ledger_ids)


async def _offering_everyday(client, *ledger: tuple[str, int], **values) -> _Everyday:
    """Everyday as _linked_everyday leaves it, its link offering the opening adjustment"""
    return await _linked_everyday(client, *ledger, opening_adjustment_state=OpeningAdjustmentState.OFFERED, **values)
