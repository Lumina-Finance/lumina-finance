"""SimpleFIN sync tests

Runs a sync job end to end through SimpleFIN and the fake SimpleFIN Bridge. The way the Bridge
stamps bank dates decides which records an import keeps
"""

from datetime import date
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import update

from app.encryption import encrypt
from app.models.bank_connection import BankConnection
from app.models.bank_sync_job import BankSyncJobKind
from app.models.bank_transaction import BankTransaction
from app.services.bank_sync.providers.simplefin.adapter import SimpleFinAdapter
from app.services.bank_sync.providers.simplefin.config import PROVIDER_ID
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _seed_job
from tests.services.bank_sync.providers.simplefin.stand_ins import FakeBridgeScenario
from tests.services.bank_sync.support import (
    _BANK_ID,
    _KNOWN_BANK_IDS,
    _TODAY,
    _bank_transactions,
    _checkpoints,
    _link,
    _run_jobs_until_none_is_due,
    _set_owner_timezone,
)

pytestmark = pytest.mark.usefixtures("worker_sessions")


async def test_job_keeps_records_from_the_import_start_on_for_a_user_far_east_of_utc(
    connection, scenario: FakeBridgeScenario, simplefin_reaches_the_fake_bridge: SimpleFinAdapter
):
    """In Tarawa, 12 hours ahead of UTC, an import from 5 July fetches 5 July to 2 October, then 3 October to today

    SimpleFIN Bridge stamps each bank date at noon UTC, midnight starting the next day in Tarawa, so the
    first window brings back 4 July, before the import start and left out, and the second brings back
    2 October. The first window ended too soon for it, and it is kept though it is the checkpoint's own day
    """
    await _set_owner_timezone(connection, ZoneInfo("Pacific/Tarawa"))
    await scenario.change("POST", "/connections", {"conn_id": "CON-harbour", "name": "Harbour Bank", "org_id": "ORG-harbour"})
    bank_account = {
        "id": "ACT-1",
        "name": "Everyday Chequing",
        "conn_id": "CON-harbour",
        "currency": "CAD",
        "balance": "100.00",
        "balance_date": 1791115200,
    }
    await scenario.change("POST", "/accounts", bank_account)
    transactions = [
        {"id": f"TRN-{day}", "posted": day, "amount": "-4.50", "description": "POS 4411 COFFEE"}
        for day in ("2026-07-04", "2026-07-05", "2026-10-02")
    ]
    await scenario.change("POST", "/accounts/ACT-1/transactions", {"transactions": transactions})
    access_url = await simplefin_reaches_the_fake_bridge.claim_setup_token(scenario.setup_token)
    async with TestSession() as session:
        await session.execute(
            update(BankConnection)
            .where(BankConnection.id == connection.id)
            .values(provider=PROVIDER_ID, credential_encrypted=encrypt(access_url))
        )
        await session.commit()
    connection.provider = PROVIDER_ID
    link = await _link(connection, "ACT-1", import_start=date(2026, 7, 5), checkpoint=date(2026, 7, 4))
    _KNOWN_BANK_IDS.update({"TRN-2026-07-05", "TRN-2026-10-02"})
    await _seed_job(connection, BankSyncJobKind.INITIAL)

    await _run_jobs_until_none_is_due()

    assert await _bank_transactions(_BANK_ID, BankTransaction.observed_date) == [
        ("TRN-2026-07-05", date(2026, 7, 5)),
        ("TRN-2026-10-02", date(2026, 10, 2)),
    ]
    assert await _checkpoints(link) == [_TODAY]
