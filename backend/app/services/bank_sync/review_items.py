"""Listing the bank items waiting for review, a page at a time

An item is a bank transaction awaiting its first review, or an accepted one with a correction or
removal open, so a bank transaction is at most one item and shares its id. Pages run newest first
by the bank's date and pick up after the last item the previous page returned rather than at a
position, so items decided between two pages are neither repeated nor skipped. Only the user's own
personal accounts have items. The list covers the accounts the transaction list is filtered to, or
every such account when it isn't. Each account's backlog, read for the same accounts, says how many
new items wait there and whether its sync is paused or warned for them
"""

import uuid
from collections.abc import Sequence
from datetime import date
from typing import get_args

from fastapi import HTTPException, status
from sqlalchemy import case, func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition, CorrectableBankField, OpenReviewKind
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.bank_review import (
    BankReviewBacklogResponse,
    BankReviewCountsResponse,
    BankReviewItemResponse,
    BankReviewPageResponse,
)
from app.schemas.bank_sync import BankValues
from app.services.accounts.access import check_own_personal_accounts, own_personal_account_condition
from app.services.bank_sync.availability import read_provider_labels
from app.services.bank_sync.review_pause import read_review_backlogs
from app.services.bank_sync.review_state import AWAITING_REVIEW, IS_REVIEW_ITEM, approved_description, edited_fields

# The most items one page holds, so an import that leaves hundreds waiting loads a page at a time
REVIEW_PAGE_SIZE = 50

# Why the reads of bank items refuse an account the user can see but doesn't own alone
REVIEW_NOT_OWN_DETAIL = "Bank items aren't listed for accounts shared with a group"

# Separates the bank date and the id of the last item a page returned. Its cursor carries them
_CURSOR_SEPARATOR = "_"

_KIND = case((AWAITING_REVIEW, "new"), else_=BankTransaction.open_kind)


async def list_review_items(
    db: AsyncSession,
    user: User,
    *,
    account_ids: Sequence[uuid.UUID] | None,
    cursor: str | None,
    limit: int,
) -> BankReviewPageResponse:
    """Return a page of the items waiting for review, for some of the user's accounts or all of them, with counts by kind

    Args:
        db: Active database session
        user: The user reviewing
        account_ids: The accounts whose items to list, or None for every account
        cursor: The cursor the previous page returned, or None for the first page
        limit: The most items the page holds

    Returns:
        The page, newest first, the counts of every waiting item in scope, and the cursor for the
        next page when one follows

    Raises:
        HTTPException 403: An account is visible but isn't the user's own personal account
        HTTPException 404: An account isn't visible to the user
        HTTPException 422: The cursor isn't one a page returned
    """
    scope = [IS_REVIEW_ITEM, own_personal_account_condition(user.id)]
    if account_ids is not None:
        await check_own_personal_accounts(db, account_ids, user.id, not_own_detail=REVIEW_NOT_OWN_DETAIL)
        scope.append(BankTransaction.account_id.in_(account_ids))

    # One row past the page says whether another page follows
    page_query = (
        select(BankTransaction, Transaction.dt, Transaction.amount)
        .join(Account, Account.id == BankTransaction.account_id)
        .outerjoin(Transaction, Transaction.id == BankTransaction.transaction_id)
        .where(*scope)
        .order_by(BankTransaction.observed_date.desc(), BankTransaction.id.desc())
        .limit(limit + 1)
    )
    if cursor is not None:
        page_query = page_query.where(tuple_(BankTransaction.observed_date, BankTransaction.id) < _read_cursor(cursor))
    rows = (await db.execute(page_query)).all()
    counts = dict(
        (
            await db.execute(
                select(_KIND, func.count())
                .select_from(BankTransaction)
                .join(Account, Account.id == BankTransaction.account_id)
                .where(*scope)
                .group_by(_KIND)
            )
        ).all()
    )

    page = rows[:limit]
    names = await read_provider_labels(db, (record.provider for record, _, _ in page))
    return BankReviewPageResponse(
        items=[build_review_item(record, ledger_date, ledger_amount, names[record.provider]) for record, ledger_date, ledger_amount in page],
        counts=BankReviewCountsResponse(new=counts.get("new", 0), correction=counts.get("correction", 0), removal=counts.get("removal", 0)),
        next_cursor=_write_cursor(page[-1][0]) if len(rows) > limit else None,
    )


async def list_review_backlogs(
    db: AsyncSession,
    user: User,
    *,
    account_ids: Sequence[uuid.UUID] | None,
) -> list[BankReviewBacklogResponse]:
    """Return each account's review backlog, for some of the user's accounts or all of them

    Args:
        db: Active database session
        user: The user reviewing
        account_ids: The accounts whose backlogs to read, or None for every account

    Returns:
        One backlog for each account named, in that order, or for every account

    Raises:
        HTTPException 403: An account is visible but isn't the user's own personal account
        HTTPException 404: An account isn't visible to the user
    """
    if account_ids is None:
        account_ids = list(await db.scalars(select(Account.id).where(own_personal_account_condition(user.id))))
    else:
        await check_own_personal_accounts(db, account_ids, user.id, not_own_detail=REVIEW_NOT_OWN_DETAIL)
    backlogs = await read_review_backlogs(db, account_ids)
    return [
        BankReviewBacklogResponse(
            account_id=account_id,
            waiting_new_count=backlogs[account_id].waiting_new,
            paused=backlogs[account_id].paused,
            review_warning=backlogs[account_id].warning,
        )
        for account_id in account_ids
    ]


def build_review_item(
    record: BankTransaction, ledger_date: date | None, ledger_amount: int | None, provider_name: str
) -> BankReviewItemResponse:
    """Return a bank transaction as a review item, given its ledger row's date and amount when it has one and its provider's name"""
    bank = BankValues(
        date=record.observed_date,
        amount=record.observed_amount,
        raw_amount=record.raw_amount,
        description=record.description,
    )
    item = {
        "id": record.id,
        "account_id": record.account_id,
        "provider": record.provider,
        "provider_name": provider_name,
        "received_at": record.received_at,
        "version": record.version,
        "bank": bank,
    }
    if record.disposition == BankTransactionDisposition.AWAITING_REVIEW:
        return BankReviewItemResponse(
            **item,
            kind="new",
            transaction_id=None,
            current=None,
            changed_fields=[],
            protected_fields=[],
            needs_merchant_or_category=True,
        )

    # The ledger holds the approved date and amount, and the record the description they were
    # decided with. A removal changes no field, though it keeps a correction it took the place of
    # for later
    previous = record.previous_values or {}
    changed = [field for field in get_args(CorrectableBankField) if field in previous and record.open_kind == OpenReviewKind.CORRECTION]
    current = bank.model_copy(
        update={"date": ledger_date, "amount": ledger_amount, "raw_amount": None, "description": approved_description(record)}
    )
    return BankReviewItemResponse(
        **item,
        kind=record.open_kind,
        transaction_id=record.transaction_id,
        current=current,
        changed_fields=changed,
        protected_fields=[field for field in edited_fields(record, ledger_date, ledger_amount) if field in changed],
        needs_merchant_or_category=False,
    )


def _write_cursor(record: BankTransaction) -> str:
    """Return the cursor that reads the items after this one"""
    return f"{record.observed_date.isoformat()}{_CURSOR_SEPARATOR}{record.id}"


def _read_cursor(cursor: str) -> tuple[date, uuid.UUID]:
    """Return the bank date and id of the last item the previous page returned

    Raises:
        HTTPException 422: The cursor isn't one a page returned
    """
    day, _, item_id = cursor.partition(_CURSOR_SEPARATOR)
    try:
        return date.fromisoformat(day), uuid.UUID(item_id)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unknown review list cursor") from error
