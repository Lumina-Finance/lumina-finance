"""How CSV files were read for each of the user's own accounts: listing it, saving it with a commit and undoing that"""

import hashlib
import json
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.account_import_layout import AccountImportLayout
from app.models.import_run import ImportRun
from app.models.user import User
from app.schemas.import_run import CsvImportLayout, CsvImportLayoutResponse

# The settings a layout row holds, which a save writes and an undo puts back
_LAYOUT_FIELDS = ("headers", "delimiter", "header_row","column_map", "date_format", "amount_format")

# The namespace separates this protocol's lock inputs from other advisory lock protocols
_LAYOUT_LOCK_NAMESPACE = b"lumina:account-import-layouts:"


async def list_import_layouts(db: AsyncSession, user: User) -> list[CsvImportLayoutResponse]:
    """Return the layouts saved for the user's own accounts, the most recently saved first

    Row-level security lets anyone who reaches an account read its layouts, so a member of a group
    would see them for a group account. Layouts are only ever saved for personal accounts, and the
    owner filter here keeps the list to those whatever the table holds

    Args:
        db: Active database session
        user: Authenticated user

    Returns:
        Every layout saved for an account the user owns
    """
    query = (
        select(AccountImportLayout)
        .join(Account, Account.id == AccountImportLayout.account_id)
        .where(Account.owner_id == user.id)
        .order_by(AccountImportLayout.updated_at.desc(), AccountImportLayout.id)
    )
    layouts = (await db.execute(query)).scalars().all()
    return [CsvImportLayoutResponse.model_validate(layout) for layout in layouts]


async def save_import_layout(
    db: AsyncSession,
    user: User,
    run: ImportRun,
    affected_account_ids: list[uuid.UUID],
) -> None:
    """Save how the run's file was read for the one account its rows went to, inside the commit

    Nothing is saved for a file read without a layout, for rows spread over several accounts, or for
    an account the user doesn't own. A transfer's counterparty is not among the affected accounts, so
    it never counts as a second one. The row the save replaces is kept on the run for undo

    Args:
        db: Active database session, whose transaction the commit owns
        user: Authenticated user committing the run
        run: Run being committed
        affected_account_ids: The accounts the run's rows were written to
    """
    if run.csv_layout is None or len(affected_account_ids) != 1:
        return
    account_id = affected_account_ids[0]
    if not await _is_personal_account(db, user, account_id):
        return

    layout = CsvImportLayout.model_validate(run.csv_layout)
    header_key = _hash_headers(layout.headers)

    # A row lock can't hold a row that isn't there yet, so two first saves for these headers would each
    # record replacing nothing, and undoing the later one would delete the earlier one's layout. The
    # lock makes the later save wait for the earlier commit and then read its row
    await db.execute(select(func.pg_advisory_xact_lock(_layout_lock_key(account_id, header_key))))
    replaced = (
        await db.execute(
            select(AccountImportLayout)
            .where(AccountImportLayout.account_id == account_id, AccountImportLayout.header_key == header_key)
            .with_for_update()
        )
    ).scalar_one_or_none()
    run.replaced_csv_layout = None if replaced is None else {
        **{field: getattr(replaced, field) for field in _LAYOUT_FIELDS},
        "updated_at": replaced.updated_at.isoformat(),
    }

    values = {**layout.model_dump(mode="json"), "import_run_id": run.id, "updated_at": func.now()}
    await db.execute(
        insert(AccountImportLayout)
        .values(id=uuid.uuid4(), account_id=account_id, header_key=header_key, **values)
        .on_conflict_do_update(constraint="uq_account_import_layouts_account_header_key", set_=values)
    )


async def undo_import_layout(db: AsyncSession, run: ImportRun) -> None:
    """Put back the layout a run's commit replaced, or delete the one it created, inside the undo

    Runs before the run itself is deleted, which would otherwise clear the link this follows

    Args:
        db: Active database session, whose transaction the undo owns
        run: Run being undone
    """
    saved_by_run = AccountImportLayout.import_run_id == run.id
    if run.replaced_csv_layout is None:
        await db.execute(delete(AccountImportLayout).where(saved_by_run))
        return

    replaced: dict[str, Any] = run.replaced_csv_layout
    await db.execute(
        update(AccountImportLayout)
        .where(saved_by_run)
        .values(
            **{field: replaced[field] for field in _LAYOUT_FIELDS},
            import_run_id=None,
            updated_at=datetime.fromisoformat(replaced["updated_at"]),
        )
    )


async def _is_personal_account(db: AsyncSession, user: User, account_id: uuid.UUID) -> bool:
    """Whether the user owns the account themselves, which is the one place layouts leave out group accounts

    An account belongs to a user or to a group, never both, so owning it rules out a group account and
    an account the user reaches only through a grant
    """
    owner_id = await db.scalar(select(Account.owner_id).where(Account.id == account_id))
    return owner_id == user.id


def _layout_lock_key(account_id: uuid.UUID, header_key: str) -> int:
    """Return the signed 64-bit advisory lock key for one account's layout of one header row"""
    digest = hashlib.blake2b(_LAYOUT_LOCK_NAMESPACE + account_id.bytes + header_key.encode(), digest_size=8).digest()
    return int.from_bytes(digest, byteorder="big", signed=True)


def _hash_headers(headers: list[str]) -> str:
    """Key a header row by its exact cells, in order and case-sensitive"""
    return hashlib.sha256(json.dumps(headers, ensure_ascii=False).encode()).hexdigest()
