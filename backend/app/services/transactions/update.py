"""Transaction update service"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import PermissionLevel
from app.models.category import Category
from app.models.transaction import Transaction
from app.models.user import User
from app.permissions import check_account_access, check_transaction_access
from app.schemas.transaction import TransactionResponse, UpdateTransactionRequest
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.categories.transfer_rules import does_category_record_counterparty_account
from app.services.transactions.accounts import (
    get_parent_account_for_transaction,
    validate_transaction_account_is_not_archived,
)
from app.services.transactions.bank_transaction_ids import find_held_bank_transactions
from app.services.transactions.links import refuse_broken_links
from app.services.transactions.response_helpers import get_transaction_response
from app.services.transactions.snapshots import recompute_snapshots_after_transaction_update
from app.services.transactions.tags import replace_transaction_tag_assignments
from app.services.transactions.validation import (
    COUNTERPARTY_NOT_ALLOWED_DETAIL,
    get_valid_transaction_tag_ids,
    validate_transaction_category_access,
    validate_transaction_counterparty_account,
    validate_transaction_merchant_access,
    validate_transaction_move_keeps_currency,
)


async def update_transaction_and_get_response(
    db: AsyncSession,
    user: User,
    transaction_id: uuid.UUID,
    data: UpdateTransactionRequest,
) -> TransactionResponse:
    """Update a transaction and return its API response

    The service checks write access, validates account and related entity
    changes, applies requested field updates, replaces tag assignments when
    supplied, recalculates affected snapshots, marks changed cache scopes, and returns
    the enriched transaction response

    Args:
        db: Active database session
        user: Authenticated user updating the transaction
        transaction_id: Transaction identifier from the route path
        data: Partial transaction update payload

    Returns:
        Updated transaction response with related display data
    """
    # Lock the fresh row before access checks and validation; hold it through the commit
    txn = await check_transaction_access(
        db,
        transaction_id,
        user.id,
        PermissionLevel.WRITE,
        lock_for_update=True,
    )

    # Load the persisted parent account for archive validation and cache scope updates
    current_account = await get_parent_account_for_transaction(db, txn)
    validate_transaction_account_is_not_archived(current_account)

    changed_fields = data.model_dump(exclude_unset=True)

    # Load related response data without writing when the request contains no changes
    if not changed_fields:
        return await get_transaction_response(db, txn)

    previous_account_id = txn.account_id
    previous_date = txn.dt
    new_account = None

    account_group_id = current_account.group_id

    # Load the target account and verify it can receive transaction history when the transaction is moved
    if "account_id" in changed_fields:
        new_account = await check_account_access(
            db,
            changed_fields["account_id"],
            user.id,
            PermissionLevel.WRITE,
            lock_against_delete=True,
        )
        validate_transaction_account_is_not_archived(new_account)
        account_group_id = new_account.group_id
        # Naming the account it is already in moves nothing, so a stored currency mismatch is not asked about
        if new_account.id != txn.account_id:
            validate_transaction_move_keeps_currency(txn.currency, new_account.currency)
        await _refuse_move_into_held_bank_transaction(db, txn, new_account)

    # Confirm changed category and merchant records belong to the selected account group
    if "category_id" in changed_fields:
        category = await validate_transaction_category_access(
            db,
            changed_fields["category_id"],
            user.id,
            account_group_id,
        )
    else:
        # The answer is judged against the category the transaction ends up with, so an unchanged
        # category is still loaded
        category = await db.get(Category, txn.category_id)
    # Editing brings the transaction onto the current rule, so one recorded before a merchant was
    # required has to name one before any other change to it is accepted, and one that already has
    # a merchant cannot have it taken away. Unsent fields keep their stored values, so an edit that
    # leaves the merchant alone is untouched by this
    resulting_merchant_id = changed_fields.get("merchant_id", txn.merchant_id)
    if resulting_merchant_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="merchant_id is required",
        )
    if "merchant_id" in changed_fields:
        await validate_transaction_merchant_access(db, resulting_merchant_id, user.id, account_group_id)

    if does_category_record_counterparty_account(category):
        # Editing a transfer answers the question, whatever else the edit changes. Transactions
        # predating the field are the ones this reaches, and refusing the edit until they record
        # their counterparty account is what moves that history onto the new footing rather than
        # leaving it counting wrongly forever. Unsent fields keep their stored values, so a transfer
        # that has already answered is untouched by this
        await validate_transaction_counterparty_account(
            db,
            user.id,
            category,
            changed_fields.get("account_id", txn.account_id),
            changed_fields.get("counterparty_account_id", txn.counterparty_account_id),
            changed_fields.get("counterparty_account_scope", txn.counterparty_account_scope),
        )
    else:
        if changed_fields.get("counterparty_account_id") is not None or changed_fields.get("counterparty_account_scope") is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=COUNTERPARTY_NOT_ALLOWED_DETAIL,
            )

        # Moving to a category with no counterparty account drops the answer recorded under the
        # previous one
        changed_fields["counterparty_account_id"] = None
        changed_fields["counterparty_account_scope"] = None

    # Handle tags outside the model field loop because they live in a junction table
    new_tag_ids = changed_fields.pop("tag_ids", None)

    for field, value in changed_fields.items():
        setattr(txn, field, value)

    # Flushed here so the index holding each bank transaction once per account refuses a move that
    # another change made clash after the check above, before anything else is written
    if new_account is not None:
        # Read before the rollback, which expires the account and would make reading its name load it
        detail = _get_held_bank_transaction_detail(new_account.name)
        try:
            await db.flush()
        except IntegrityError as error:
            await db.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from error

    # A linked transaction must stay a refund or an expense, so an edit that would undo that is refused
    await db.flush()
    await refuse_broken_links(db, [txn.id])

    # Validate requested tags before replacing junction rows
    if new_tag_ids is not None:
        validated_tag_ids = await get_valid_transaction_tag_ids(db, user.id, new_tag_ids, account_group_id) if new_tag_ids else []
        await replace_transaction_tag_assignments(db, txn.id, validated_tag_ids)

    # Flush row and tag changes before rebuilding any affected balance snapshots
    await recompute_snapshots_after_transaction_update(
        db,
        txn,
        previous_account_id=previous_account_id,
        previous_date=previous_date,
        changed_fields=changed_fields,
    )

    # Mark cache scopes for the original account and the new account when moved
    await mark_cache_changed_for_scope(db, user_id=current_account.owner_id, group_id=current_account.group_id)
    if new_account is not None and new_account.id != current_account.id:
        await mark_cache_changed_for_scope(db, user_id=new_account.owner_id, group_id=new_account.group_id)

    # Build the response before committing, since a delete of the account may take the row the moment
    # this commits
    await db.flush()
    await db.refresh(txn)
    response = await get_transaction_response(db, txn)
    await db.commit()
    return response


def _get_held_bank_transaction_detail(account_name: str) -> str:
    """Say a move is refused because the account already holds the transaction's bank ID"""
    return f"{account_name} already has this transaction from an earlier import"


async def _refuse_move_into_held_bank_transaction(db: AsyncSession, txn: Transaction, new_account: Account) -> None:
    """Refuse moving a transaction into an account already holding its bank ID under the same bank account

    A move keeps the bank ID, so a statement imported into the wrong account and moved to the right
    one is still recognised there, and two copies of one bank transaction cannot share an account

    Args:
        db: Active database session
        txn: Transaction being moved
        new_account: Account it moves to

    Raises:
        HTTPException: Raised with 409 when the account already holds the transaction's bank ID
    """
    if txn.bank_transaction_hash is None or new_account.id == txn.account_id:
        return
    if await find_held_bank_transactions(db, {(new_account.id, txn.bank_transaction_hash)}):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_get_held_bank_transaction_detail(new_account.name),
        )
