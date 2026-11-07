"""Transaction creation service"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import PermissionLevel
from app.models.transaction import Transaction
from app.models.transaction_link import TransactionLink
from app.models.user import User
from app.permissions import check_account_access
from app.schemas.transaction import CreateTransactionRequest, TransactionResponse
from app.services.accounts.snapshots import recompute_account_snapshots, refuse_unstorable_balance
from app.services.bank_sync.manual_entries import refuse_days_a_bank_supplies
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.transactions.accounts import (
    validate_transaction_account_is_not_archived,
)
from app.services.transactions.links import validate_refund_original
from app.services.transactions.response_helpers import get_transaction_response
from app.services.transactions.tags import replace_transaction_tag_assignments
from app.services.transactions.validation import (
    get_valid_transaction_tag_ids,
    validate_transaction_category_access,
    validate_transaction_counterparty_account,
    validate_transaction_currency_exists,
    validate_transaction_fx_rate_for_account_currency,
    validate_transaction_merchant_access,
)


async def create_transaction_and_get_response(
    db: AsyncSession,
    user: User,
    data: CreateTransactionRequest,
) -> TransactionResponse:
    """Create a transaction and return its API response

    The service validates account write access, refuses a date a linked account's bank supplies,
    writes the transaction, marks the affected cache scope and commits

    Args:
        db: Active database session
        user: Authenticated user creating the transaction
        data: Transaction creation payload

    Returns:
        Newly created transaction response with related display data
    """
    # Load the target account and verify the user can write new transactions to it
    account = await check_account_access(
        db,
        data.account_id,
        user.id,
        PermissionLevel.WRITE,
        lock_against_delete=True,
    )
    await refuse_days_a_bank_supplies(db, user, {account.id: [data.dt]})
    txn = await insert_transaction(db, user, account, data)

    # Mark the affected user or group cache after all transaction writes are flushed
    await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)
    # Build the response before committing, since a delete of the account may take the row the moment
    # this commits
    await db.flush()
    await db.refresh(txn)
    response = await get_transaction_response(db, txn)
    await db.commit()
    return response


async def insert_transaction(
    db: AsyncSession,
    user: User,
    account: Account,
    data: CreateTransactionRequest,
) -> Transaction:
    """Validate a new transaction and write it with its tags and the account's balances, without committing

    Every single transaction the user creates goes through here, so a bank item added to the
    ledger passes the same checks as a transaction entered by hand. The caller marks the cache
    last and commits, so the write can be one step of a larger save. The days a linked account's
    bank supplies are left to the caller, since only a transaction that isn't the bank's own is
    refused there

    Args:
        db: Active database session
        user: The user creating the transaction
        account: The account named by the payload, one the user may write to
        data: Transaction creation payload

    Returns:
        The new transaction, flushed
    """
    validate_transaction_account_is_not_archived(account)
    refuse_unstorable_balance(account.name, data.amount)

    # Check currency and account currency inputs before any transaction row is inserted
    await validate_transaction_currency_exists(db, data.currency)
    validate_transaction_fx_rate_for_account_currency(data.currency, account.currency, data.fx_rate)

    # Confirm related records belong to the same accessible group as the account
    category = await validate_transaction_category_access(db, data.category_id, user.id, account.group_id)

    # A transfer records its counterparty account as it is entered, since the receiving side is
    # added days later and the two cannot be matched up afterwards
    await validate_transaction_counterparty_account(
        db,
        user.id,
        category,
        data.account_id,
        data.counterparty_account_id,
        data.counterparty_account_scope,
    )
    await validate_transaction_merchant_access(db, data.merchant_id, user.id, account.group_id)
    validated_tag_ids = []
    if data.tag_ids:
        validated_tag_ids = await get_valid_transaction_tag_ids(db, user.id, data.tag_ids, account.group_id)

    # A refund names its expense up front, so a pairing that is not a refund fails before any write
    original = None
    if data.refund_of_transaction_id is not None:
        original = await validate_refund_original(
            db,
            user,
            data.refund_of_transaction_id,
            data.amount,
            data.currency,
            account,
            category,
        )

    # Insert the transaction first so optional tag assignments can reference its id
    txn = Transaction(
        created_by_user_id=user.id,
        account_id=data.account_id,
        dt=data.dt,
        merchant_id=data.merchant_id,
        category_id=data.category_id,
        amount=data.amount,
        currency=data.currency,
        fx_rate=data.fx_rate,
        notes=data.notes,
        counterparty_account_id=data.counterparty_account_id,
        counterparty_account_scope=data.counterparty_account_scope,
    )
    db.add(txn)
    await db.flush()

    # Write optional tag assignments after the transaction id and tag ids are known
    if validated_tag_ids:
        await replace_transaction_tag_assignments(db, txn.id, validated_tag_ids)

    # Both accounts of a refund are the user's own, so one scope holds every list showing the link
    if original is not None:
        db.add(TransactionLink(refund_transaction_id=txn.id, original_transaction_id=original.id))

    # Rebuild balance snapshots from this transaction's day forward
    await recompute_account_snapshots(db, {data.account_id: data.dt})
    return txn
