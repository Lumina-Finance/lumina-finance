"""Which importer last brought transactions into each of the user's own accounts: listing it, saving it with a commit and undoing that"""

import hashlib
import uuid

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.account_import_source import AccountImportSource
from app.models.import_run import ImportRun
from app.models.user import User
from app.schemas.import_run import AccountImportSourceResponse

# The namespace separates this protocol's lock inputs from other advisory lock protocols
_SOURCE_LOCK_NAMESPACE = b"lumina:account-import-sources:"


async def list_import_sources(db: AsyncSession, user: User) -> list[AccountImportSourceResponse]:
    """Return the importer last used for each of the user's own accounts

    Row-level security lets anyone who reaches an account read its row, so the owner filter keeps the
    list to the user's own accounts, as it does for saved layouts

    Args:
        db: Active database session
        user: Authenticated user

    Returns:
        One entry for every owned account an import has written to
    """
    query = (
        select(AccountImportSource)
        .join(Account, Account.id == AccountImportSource.account_id)
        .where(Account.owner_id == user.id)
        .order_by(AccountImportSource.account_id)
    )
    rows = (await db.execute(query)).scalars().all()
    return [AccountImportSourceResponse.model_validate(row) for row in rows]


async def save_import_sources(
    db: AsyncSession,
    user: User,
    run: ImportRun,
    affected_account_ids: list[uuid.UUID],
) -> None:
    """Remember the run's importer for every personal account its rows were written to, inside the commit

    Group accounts and accounts the user only reaches through a grant are left out. What each save
    replaces is kept on the run for undo

    Args:
        db: Active database session, whose transaction the commit owns
        user: Authenticated user committing the run
        run: Run being committed
        affected_account_ids: The accounts the run's rows were written to
    """
    account_ids = sorted(
        (await db.execute(select(Account.id).where(Account.id.in_(affected_account_ids), Account.owner_id == user.id))).scalars(),
        key=str,
    )
    if not account_ids:
        return

    # A row lock can't hold a row that isn't there yet, so two first saves for an account would each
    # record replacing nothing, and undoing the later one would delete the earlier one's source. The
    # locks make the later save wait for the earlier commit and then read its row. They are taken in
    # one order, so two commits sharing accounts can't wait on each other
    for account_id in account_ids:
        await db.execute(select(func.pg_advisory_xact_lock(_source_lock_key(account_id))))
    replaced_rows = (
        await db.execute(select(AccountImportSource).where(AccountImportSource.account_id.in_(account_ids)).with_for_update())
    ).scalars()
    replaced_by_account = {row.account_id: row for row in replaced_rows}
    run.replaced_account_sources = {
        str(account_id): replaced_by_account[account_id].source if account_id in replaced_by_account else None
        for account_id in account_ids
    }

    values = [{"id": uuid.uuid4(), "account_id": account_id, "source": run.source, "import_run_id": run.id} for account_id in account_ids]
    statement = insert(AccountImportSource).values(values)
    await db.execute(
        statement.on_conflict_do_update(
            constraint="uq_account_import_sources_account_id",
            set_={"source": statement.excluded.source, "import_run_id": run.id},
        )
    )


async def undo_import_sources(db: AsyncSession, run: ImportRun) -> None:
    """Put back the source each account held before the run's commit, or forget the ones it created

    Runs before the run itself is deleted, which would otherwise clear the link this follows

    Args:
        db: Active database session, whose transaction the undo owns
        run: Run being undone
    """
    saved_by_run = (await db.execute(select(AccountImportSource).where(AccountImportSource.import_run_id == run.id))).scalars()
    replaced = run.replaced_account_sources or {}
    for row in saved_by_run:
        before = replaced.get(str(row.account_id))
        if before is None:
            await db.delete(row)
            continue
        row.source = before
        row.import_run_id = None


def _source_lock_key(account_id: uuid.UUID) -> int:
    """Return the signed 64-bit advisory lock key for one account's remembered source"""
    digest = hashlib.blake2b(_SOURCE_LOCK_NAMESPACE + account_id.bytes, digest_size=8).digest()
    return int.from_bytes(digest, byteorder="big", signed=True)
