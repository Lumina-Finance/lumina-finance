"""The last saved import, and undoing it by deleting everything it wrote"""

import uuid
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import ARRAY, Uuid, any_, bindparam, delete, func, select
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only
from sqlalchemy.sql.elements import BindParameter

from app.config.imports import IMPORT_UNDO_WINDOW
from app.models.account import Account
from app.models.budget import BaseBudget
from app.models.cache_state import UserCacheState
from app.models.category import Category
from app.models.import_run import ImportRun
from app.models.merchant import Merchant
from app.models.tag import Tag
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.import_run import ImportUndoResponse, LastImportResponse
from app.services.cache_state import mark_user_cache_changed
from app.services.importers.shared.run_locking import load_locked_change_marker, load_locked_run
from app.services.transactions.bulk_access import load_locked_run_transactions, load_writable_accounts
from app.services.transactions.deletion import delete_locked_transactions

# The summary field listing what a run created, by the kind of record
_CREATED_ID_FIELDS = {
    "accounts": "created_account_ids",
    "categories": "created_category_ids",
    "merchants": "created_merchant_ids",
    "tags": "created_tag_ids",
}

# Deleted in this order, since a budget tracks categories and the rows, which go first, reference the
# rest. Accounts go last and take their snapshots and permissions with them
_CREATED_MODELS = (
    ("budgets", BaseBudget),
    ("merchants", Merchant),
    ("tags", Tag),
    ("categories", Category),
    ("accounts", Account),
)

_NO_LONGER_UNDOABLE = "This import can no longer be undone"
_DEADLOCK_SQLSTATE = "40P01"


async def get_last_import(db: AsyncSession, user: User) -> LastImportResponse | None:
    """Return the caller's last saved import while it can still be undone

    It can be undone within the undo window while nothing else has changed the user's data, and
    never when it wrote into a group account

    Args:
        db: Active database session
        user: Authenticated user

    Returns:
        The last import with what undoing it deletes, or None when there is none it can undo
    """
    changed_at = select(UserCacheState.changed_at).where(UserCacheState.user_id == user.id).scalar_subquery()
    run = (
        (
            await db.execute(
                select(ImportRun)
                .options(load_only(ImportRun.source, ImportRun.file_name, ImportRun.committed_at, ImportRun.summary))
                .where(
                    ImportRun.owner_id == user.id,
                    ImportRun.committed_at >= datetime.now(UTC) - IMPORT_UNDO_WINDOW,
                    ImportRun.committed_at == changed_at,
                )
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    if run is None:
        return None

    counts = dict(
        (
            await db.execute(
                select(Transaction.account_id, func.count()).where(Transaction.import_run_id == run.id).group_by(Transaction.account_id)
            )
        ).all()
    )
    if _has_group_account((await _load_accounts(db, set(counts))).values()):
        return None

    # Nothing has changed since, so everything the import created is still there
    created = _created_ids(run.summary)
    return LastImportResponse(
        id=run.id,
        source=run.source,
        file_name=run.file_name,
        committed_at=run.committed_at,
        undo_until=run.committed_at + IMPORT_UNDO_WINDOW,
        transaction_count=sum(counts.values()),
        account_count=len(created["accounts"]),
        category_count=len(created["categories"]),
        merchant_count=len(created["merchants"]),
        tag_count=len(created["tags"]),
        budget_count=len(created["budgets"]),
    )


async def undo_import_run(db: AsyncSession, user: User, run_id: uuid.UUID) -> ImportUndoResponse:
    """Delete everything an import wrote, its transactions and every record it created, or nothing

    Records the import reused, which existed before it, are left as they are. The run and the
    user's change marker are held for the whole undo, so two undos of one import queue and the
    second finds it gone, and a change landing meanwhile waits and then finds its records gone

    Args:
        db: Active database session
        user: Authenticated user undoing the import
        run_id: Import to undo

    Returns:
        How many transactions were deleted and the accounts they were in

    Raises:
        HTTPException: Raised with 404 for an import that is absent, not the caller's, never
            listed (an uncommitted run is never listed) or already undone, 409 when it was saved
            longer ago than the undo window, the user's data has changed since, another change
            holds it or one of its rows, a record elsewhere now references what it created or a
            write racing it deadlocks, and 422 when one of its accounts is in a group or refuses the
            write
    """
    run = await load_locked_run(db, run_id)
    if run is None or run.committed_at is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import not found")
    changed_at = await load_locked_change_marker(db, user.id)
    if run.committed_at < datetime.now(UTC) - IMPORT_UNDO_WINDOW or run.committed_at != changed_at:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NO_LONGER_UNDOABLE)

    deleted_days = await load_locked_run_transactions(db, user, run.id)
    accounts_by_id = await _load_accounts(db, {account_id for account_id, _ in deleted_days})

    # Lumina builds for individually owned resources, so group accounts are left out, as bulk delete
    # leaves them out
    if _has_group_account(accounts_by_id.values()):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Imports into group accounts can't be undone",
        )
    # An account the import created goes with it, whether or not the import archived it
    created = _created_ids(run.summary)
    accounts = await load_writable_accounts(db, user, set(accounts_by_id), archived_ok=created["accounts"])

    # A record in a group, which moves only the group's marker, can still reference what the import
    # created, such as a group transaction filed under its category or a group transfer naming its
    # account, and the foreign key refuses the delete rather than leave that record without it. A
    # write racing for the same rows can also end the undo as the deadlock's loser
    try:
        await delete_locked_transactions(db, Transaction.import_run_id == run.id, accounts, deleted_days)
        for kind, model in _CREATED_MODELS:
            if created[kind]:
                await db.execute(delete(model).where(model.id == any_(_id_array(kind, created[kind]))))
        await db.execute(delete(ImportRun).where(ImportRun.id == run.id))
        await mark_user_cache_changed(db, user.id)
        await db.commit()
    except DBAPIError as exc:
        if not isinstance(exc, IntegrityError) and getattr(exc.orig, "sqlstate", None) != _DEADLOCK_SQLSTATE:
            raise
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NO_LONGER_UNDOABLE) from exc

    return ImportUndoResponse(
        transactions_deleted=len(deleted_days),
        affected_account_ids=[account.id for account in accounts],
    )


def _has_group_account(accounts: Iterable[Account]) -> bool:
    """Return whether any of the accounts belongs to a group"""
    return any(account.group_id is not None for account in accounts)


async def _load_accounts(db: AsyncSession, account_ids: set[uuid.UUID]) -> dict[uuid.UUID, Account]:
    """Return the given accounts by id"""
    if not account_ids:
        return {}
    accounts = (await db.execute(select(Account).where(Account.id.in_(account_ids)))).scalars().all()
    return {account.id: account for account in accounts}


def _created_ids(summary: dict[str, Any] | None) -> dict[str, set[uuid.UUID]]:
    """Return what a run's stored summary says it created, by kind, budgets included"""
    summary = summary or {}
    created = {kind: {uuid.UUID(value) for value in summary.get(field, [])} for kind, field in _CREATED_ID_FIELDS.items()}
    created["budgets"] = {uuid.UUID(budget["base_budget_id"]) for budget in summary.get("budgets", [])}
    return created


def _id_array(kind: str, ids: set[uuid.UUID]) -> BindParameter[list[uuid.UUID]]:
    """Bind ids as one array value rather than one each

    A run can create thousands of merchants, and the driver caps bound values
    """
    return bindparam(f"{kind}_ids", sorted(ids), type_=ARRAY(Uuid))
