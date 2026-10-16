"""Two imports of files with the same headers into one account committing at the same moment

The second commit has to see the first one's saved layout as the one it replaces. Otherwise it records
that it replaced nothing, and undoing it deletes the first import's layout with its own
"""

import asyncio

from sqlalchemy import select, text

from app.models.account import Account
from app.models.account_import_layout import AccountImportLayout
from app.models.base import AccountKind, AccountType
from app.models.import_run import ImportRun, ImportRunSource
from app.services.importers.shared.layouts import save_import_layout, undo_import_layout
from tests.conftest import TestSession
from tests.services.importers._helpers import _seed_user

_HEADERS = ["Date", "Description", "Amount"]


def _layout(delimiter):
    """Return a saved reading of the three-column file with the given separator"""
    return {
        "headers": _HEADERS,
        "delimiter": delimiter,
        "header_row": 1,
        "column_map": {"dt": "Date", "merchant_id": "Description", "amount": "Amount"},
        "date_format": "yearFirst",
        "amount_format": {"decimal_separator": ".", "grouping_separator": ","},
    }


async def _wait_until_blocked(blocker_pid, blocked_pid):
    """Wait until PostgreSQL reports one backend blocked by another"""
    async with asyncio.timeout(5):
        async with TestSession() as observer:
            while blocker_pid not in await observer.scalar(
                text("SELECT pg_blocking_pids(:pid)"), {"pid": blocked_pid},
            ):
                await asyncio.sleep(0.01)


async def test_a_commit_racing_the_first_save_for_its_headers_keeps_that_save_for_undo():
    """Undoing the second of two racing commits deleted the layout the first one saved."""
    async with TestSession() as session:
        user = await _seed_user(session)
        account = Account(
            owner_id=user.id, account_kind=AccountKind.ASSET, account_type=AccountType.CHECKING,
            name="Checking", currency="CAD",
        )
        session.add(account)
        await session.flush()
        first = ImportRun(owner_id=user.id, source=ImportRunSource.GENERIC, expected_transaction_count=1,
                          csv_layout=_layout(","))
        second = ImportRun(owner_id=user.id, source=ImportRunSource.GENERIC, expected_transaction_count=1,
                           csv_layout=_layout(";"))
        session.add_all([first, second])
        await session.commit()

    async with TestSession() as holder, TestSession() as waiter:
        holder_pid = await holder.scalar(text("SELECT pg_backend_pid()"))
        waiter_pid = await waiter.scalar(text("SELECT pg_backend_pid()"))
        await save_import_layout(holder, user, await holder.get(ImportRun, first.id), [account.id])

        waiting_run = await waiter.get(ImportRun, second.id)
        waiting_save = asyncio.create_task(save_import_layout(waiter, user, waiting_run, [account.id]))
        try:
            await _wait_until_blocked(holder_pid, waiter_pid)
            await holder.commit()
            async with asyncio.timeout(5):
                await waiting_save
            await waiter.commit()
        finally:
            if not waiting_save.done():
                waiting_save.cancel()
                await asyncio.gather(waiting_save, return_exceptions=True)

    async with TestSession() as session:
        await undo_import_layout(session, await session.get(ImportRun, second.id))
        await session.commit()
        layout = (await session.execute(select(AccountImportLayout))).scalar_one()

    assert layout.delimiter == ","
    assert layout.import_run_id is None
