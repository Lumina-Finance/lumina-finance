"""Bank sync API routes"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.bank_connection import PROVIDER_ID_MAX_LENGTH
from app.models.user import User
from app.schemas.bank_review import (
    AddReviewItemRequest,
    BankReviewBacklogResponse,
    BankReviewPageResponse,
    BulkAddReviewItemsRequest,
    BulkDismissReviewItemsRequest,
    BulkReviewResultResponse,
)
from app.schemas.bank_sync import (
    AccountBankStatusResponse,
    BankAccountLinkResponse,
    BankConnectionResponse,
    BankHoldResponse,
    BankImportRangeResponse,
    BankLinkResponse,
    BankPendingTransactionResponse,
    BankProvidersResponse,
    CreateBankConnectionRequest,
    DiscoveredBankAccountsResponse,
    DismissCutOffDayRequest,
    DismissHistoryReminderRequest,
    LinkBankAccountRequest,
    ReconnectBankConnectionRequest,
    ReconnectBankConnectionResponse,
    RecordBalanceMatchRequest,
    RestoreBankValueRequest,
    UnlinkResponse,
    UpdateBankConnectionRequest,
)
from app.schemas.transaction import TransactionResponse
from app.services.bank_sync.account_link import list_bank_links, read_account_bank_status
from app.services.bank_sync.availability import list_providers
from app.services.bank_sync.balance_match import record_balance_match
from app.services.bank_sync.bulk_review import bulk_add_review_items, bulk_dismiss_review_items
from app.services.bank_sync.claim import claim_connection, reconnect_connection
from app.services.bank_sync.connections import list_connections, rename_connection
from app.services.bank_sync.history_reminder import dismiss_cut_off_day, dismiss_history_reminder
from app.services.bank_sync.holds import dismiss_hold, list_holds
from app.services.bank_sync.import_range import get_import_range
from app.services.bank_sync.links import (
    disconnect_connection,
    link_bank_account,
    list_bank_accounts_for_account,
    unlink_account,
)
from app.services.bank_sync.pending_items import list_pending_transactions
from app.services.bank_sync.review_decisions import (
    accept_bank_change,
    add_review_item_to_ledger,
    dismiss_review_item,
    keep_current_value,
    keep_transaction,
    remove_from_ledger,
    restore_bank_value,
)
from app.services.bank_sync.review_items import REVIEW_PAGE_SIZE, list_review_backlogs, list_review_items
from app.services.bank_sync.sync_now import sync_account_now

router = APIRouter(prefix="/bank-sync", tags=["bank-sync"])

# An account's own link to a bank account, kept with the rest of bank sync rather than the account routes
bank_link_router = APIRouter(prefix="/accounts/{account_id}/bank-link", tags=["bank-sync"])

# The bank items waiting for the user to add, dismiss or decide
review_router = APIRouter(prefix="/bank-review", tags=["bank-sync"])


@router.get("/providers", response_model=BankProvidersResponse)
async def list_bank_providers(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the providers the deployment enables, and whether the user can link bank accounts now

    Args:
        user: Authenticated user choosing a provider
        db: Active database session

    Returns:
        The bank-linking check, whether sync is running, and each enabled provider's facts
    """
    return await list_providers(db, user)


@router.get("/connections", response_model=list[BankConnectionResponse])
async def list_bank_connections(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the user's bank connections, oldest first

    Args:
        user: Authenticated owner of the connections
        db: Active database session

    Returns:
        Each connection with its bank accounts, pending discovery and request budget
    """
    return await list_connections(db, user)


@router.post("/connections", response_model=BankConnectionResponse, status_code=status.HTTP_201_CREATED)
async def create_bank_connection(
    request: CreateBankConnectionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Claim a credential the user supplied as a new connection and discover its bank accounts

    Args:
        request: The provider, the credential and an optional nickname
        user: Authenticated user connecting
        db: Active database session

    Returns:
        The new connection, with the bank accounts found or a pending discovery
    """
    return await claim_connection(db, user, request)


@router.patch("/connections/{connection_id}", response_model=BankConnectionResponse)
async def update_bank_connection(
    connection_id: uuid.UUID,
    request: UpdateBankConnectionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Set or clear a connection's nickname

    Args:
        connection_id: The connection to rename
        request: The new nickname, and a blank one brings back the provider's name
        user: Authenticated owner of the connection
        db: Active database session

    Returns:
        The renamed connection
    """
    return await rename_connection(db, user, connection_id, request)


@router.delete("/connections/{connection_id}", response_model=UnlinkResponse)
async def delete_bank_connection(
    connection_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Unlink every account linked through a connection and delete it with its stored credential

    Args:
        connection_id: The connection to disconnect
        user: Authenticated owner of the connection
        db: Active database session

    Returns:
        The accounts unlinked
    """
    return await disconnect_connection(db, user, connection_id)


@router.post("/connections/{connection_id}/reconnect", response_model=ReconnectBankConnectionResponse)
async def reconnect_bank_connection(
    connection_id: uuid.UUID,
    request: ReconnectBankConnectionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Replace a rejected connection's credential with a newly supplied one, and resume its linked accounts

    Args:
        connection_id: The connection to reconnect
        request: The new credential
        user: Authenticated owner of the connection
        db: Active database session

    Returns:
        The connection, and which linked accounts resume or need their bank account chosen again
    """
    return await reconnect_connection(db, user, connection_id, request)


@router.get("/connections/{connection_id}/accounts", response_model=DiscoveredBankAccountsResponse)
async def list_connection_bank_accounts(
    connection_id: uuid.UUID,
    for_account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a connection's bank accounts for the account being linked, asking for a fresh discovery when due

    Args:
        connection_id: The connection whose bank accounts to list
        for_account_id: The account being linked
        user: Authenticated user linking the account
        db: Active database session

    Returns:
        Each bank account, linkable or unavailable with its reason, and whether a discovery is on its way
    """
    return await list_bank_accounts_for_account(db, user, connection_id, for_account_id)


@router.get("/links", response_model=list[BankLinkResponse])
async def list_user_bank_links(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the user's live bank links, each with its import's progress and sync status

    Args:
        user: Authenticated owner of the links
        db: Active database session

    Returns:
        Each link on the user's own personal accounts, including those waiting for their bank account to be chosen again
    """
    return await list_bank_links(db, user)


@router.post("/transaction-sources/{transaction_id}/restore", response_model=TransactionResponse)
async def restore_transaction_bank_value(
    transaction_id: uuid.UUID,
    request: RestoreBankValueRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Put the bank's latest date or amount back on a bank-imported transaction where the user edited it

    Args:
        transaction_id: The bank-imported ledger transaction
        request: The edited field to restore
        user: Authenticated owner of the transaction
        db: Active database session

    Returns:
        The ledger transaction, with its bank source
    """
    return await restore_bank_value(db, user, transaction_id, request.field)


@router.get("/pending", response_model=list[BankPendingTransactionResponse])
async def list_pending_bank_transactions(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    account_id: Annotated[list[uuid.UUID] | None, Query()] = None,
):
    """Return the transactions the bank hasn't posted yet, newest first. They stay out of the ledger

    Args:
        user: Authenticated owner of the accounts
        db: Active database session
        account_id: The accounts whose items to list, repeated for each, or every account when left out

    Returns:
        Each pending item, with when the bank reported it
    """
    return await list_pending_transactions(db, user, account_ids=account_id)


@router.get("/holds", response_model=list[BankHoldResponse])
async def list_bank_holds(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    account_id: Annotated[list[uuid.UUID] | None, Query()] = None,
):
    """Return the bank records of no amount that haven't been dismissed, newest first. They stay out of the ledger and review

    Args:
        user: Authenticated owner of the accounts
        db: Active database session
        account_id: The accounts whose holds to list, repeated for each, or every account when left out

    Returns:
        Each hold, with when the bank reported it
    """
    return await list_holds(db, user, account_ids=account_id)


@router.post("/holds/{hold_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_bank_hold(
    hold_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Dismiss a hold so the same bank record doesn't come back

    Args:
        hold_id: The hold to dismiss
        user: Authenticated owner of the hold's account
        db: Active database session
    """
    await dismiss_hold(db, user, hold_id)


@bank_link_router.get("", response_model=AccountBankStatusResponse)
async def get_account_bank_status(
    account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return one of the user's own accounts' live bank link, or what it was last linked to

    Args:
        account_id: The account
        user: Authenticated owner of the account
        db: Active database session

    Returns:
        The live link with its import's progress and the bank's balance beside the ledger's, or the latest unlinked one
    """
    return await read_account_bank_status(db, user, account_id)


@bank_link_router.post("", response_model=BankAccountLinkResponse, status_code=status.HTTP_201_CREATED)
async def create_bank_link(
    account_id: uuid.UUID,
    request: LinkBankAccountRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Link one of the user's accounts to a bank account and queue its import

    Args:
        account_id: The account to link
        request: The connection, the bank account it lists and the import's first day
        user: Authenticated user linking the account
        db: Active database session

    Returns:
        The new link
    """
    return await link_bank_account(db, user, account_id, request)


@bank_link_router.delete("", response_model=UnlinkResponse)
async def delete_bank_link(
    account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """End an account's link, keeping its connection

    Args:
        account_id: The account to unlink
        user: Authenticated owner of the account
        db: Active database session

    Returns:
        The account unlinked
    """
    return await unlink_account(db, user, account_id)


@bank_link_router.post("/sync", response_model=BankLinkResponse)
async def sync_bank_link_now(
    account_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Queue a sync of one of the user's linked accounts for straight away, whatever its next daily time

    Args:
        account_id: The linked account
        user: Authenticated owner of the account
        db: Active database session

    Returns:
        The link, with a status that says the sync is requested until a worker starts it
    """
    return await sync_account_now(db, user, account_id)


@bank_link_router.post("/balance-match", response_model=AccountBankStatusResponse)
async def record_offered_balance_match(
    account_id: uuid.UUID,
    request: RecordBalanceMatchRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Record the balance match one of the user's linked accounts offers, for the amount given

    Args:
        account_id: The linked account
        request: The amount to record, the one offered or the user's own, and the offer it answers
        user: Authenticated owner of the account
        db: Active database session

    Returns:
        The account's bank link, with the balances taking in the adjustment and any difference left offered
    """
    return await record_balance_match(db, user, account_id, amount=request.amount, offered_amount=request.offered_amount)


@bank_link_router.post("/history-reminder/dismiss", response_model=AccountBankStatusResponse)
async def dismiss_bank_history_reminder(
    account_id: uuid.UUID,
    request: DismissHistoryReminderRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Dismiss the reminder that one of the user's linked accounts' import or catch-up returned less history than it asked for

    Args:
        account_id: The linked account
        request: The reminder as it showed
        user: Authenticated owner of the account
        db: Active database session

    Returns:
        The account's bank link, without the reminder unless a newer one replaced it
    """
    return await dismiss_history_reminder(db, user, account_id, request)


@bank_link_router.post("/cut-off-day/dismiss", response_model=AccountBankStatusResponse)
async def dismiss_bank_cut_off_day(
    account_id: uuid.UUID,
    request: DismissCutOffDayRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Dismiss the reminder that one of the user's linked accounts may be missing transactions from a day

    Args:
        account_id: The linked account
        request: The day the reminder named
        user: Authenticated owner of the account
        db: Active database session

    Returns:
        The account's bank link, without the reminder unless a later day replaced it
    """
    return await dismiss_cut_off_day(db, user, account_id, request)


@bank_link_router.get("/import-range", response_model=BankImportRangeResponse)
async def get_bank_import_range(
    account_id: uuid.UUID,
    provider: Annotated[str, Query(max_length=PROVIDER_ID_MAX_LENGTH)],
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return where an import from a provider into one of the user's own accounts may start

    Args:
        account_id: The account to link
        provider: The provider the import would come from
        user: Authenticated user linking the account
        db: Active database session

    Returns:
        The allowed range, its suggestions and the facts the start step shows beside them
    """
    return await get_import_range(db, user, account_id, provider)


@review_router.get("/items", response_model=BankReviewPageResponse)
async def list_bank_review_items(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    account_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    cursor: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=REVIEW_PAGE_SIZE)] = REVIEW_PAGE_SIZE,
):
    """Return a page of the items waiting for review, newest first, with counts by kind

    Args:
        user: Authenticated user reviewing
        db: Active database session
        account_id: The accounts whose items to list, repeated for each, or every account when left out
        cursor: The cursor the previous page returned, left out for the first page
        limit: The most items the page holds

    Returns:
        The page, the counts of every waiting item in scope, and the next page's cursor
    """
    return await list_review_items(db, user, account_ids=account_id, cursor=cursor, limit=limit)


@review_router.get("/backlogs", response_model=list[BankReviewBacklogResponse])
async def list_bank_review_backlogs(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    account_id: Annotated[list[uuid.UUID] | None, Query()] = None,
):
    """Return how many new items wait on each account, and whether its sync is paused or warned for them

    Args:
        user: Authenticated user reviewing
        db: Active database session
        account_id: The accounts whose backlogs to read, repeated for each, or every account when left out

    Returns:
        One backlog for each account
    """
    return await list_review_backlogs(db, user, account_ids=account_id)


@review_router.post("/items/bulk-add", response_model=BulkReviewResultResponse)
async def bulk_add_bank_review_items(
    data: BulkAddReviewItemsRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Add new bank items to the ledger with one set of values and each item's bank amount, in one save

    Args:
        data: The items, each at the version the list showed, and the values to add them with
        user: Authenticated user reviewing
        db: Active database session

    Returns:
        The items added, and the items skipped since they changed or can't take their bank amount
    """
    return await bulk_add_review_items(db, user, data)


@review_router.post("/items/bulk-dismiss", response_model=BulkReviewResultResponse)
async def bulk_dismiss_bank_review_items(
    data: BulkDismissReviewItemsRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Dismiss new bank items, in one save

    Args:
        data: The items, each at the version the list showed
        user: Authenticated user reviewing
        db: Active database session

    Returns:
        The items dismissed, and the items skipped since they changed
    """
    return await bulk_dismiss_review_items(db, user, data)


@review_router.post("/items/{item_id}/add", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
async def add_bank_review_item(
    item_id: uuid.UUID,
    data: AddReviewItemRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Add a new bank item to the ledger with the user's values, accepting it in the same save

    Args:
        item_id: The item to add
        data: The values to add it with
        user: Authenticated user reviewing
        db: Active database session

    Returns:
        The ledger transaction, with its bank source
    """
    return await add_review_item_to_ledger(db, user, item_id, data)


@review_router.post("/items/{item_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_bank_review_item(
    item_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Dismiss a new bank item so it never returns

    Args:
        item_id: The item to dismiss
        user: Authenticated user reviewing
        db: Active database session
    """
    await dismiss_review_item(db, user, item_id)


@review_router.post("/items/{item_id}/accept-change", response_model=TransactionResponse)
async def accept_bank_review_change(
    item_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Write the bank's corrected values to the ledger transaction and close the correction

    Args:
        item_id: The correction to accept
        user: Authenticated user reviewing
        db: Active database session

    Returns:
        The ledger transaction, with its bank source
    """
    return await accept_bank_change(db, user, item_id)


@review_router.post("/items/{item_id}/keep-current", response_model=TransactionResponse)
async def keep_bank_review_current_value(
    item_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Close a correction leaving the ledger transaction as it is

    Args:
        item_id: The correction to decline
        user: Authenticated user reviewing
        db: Active database session

    Returns:
        The ledger transaction, with its bank source
    """
    return await keep_current_value(db, user, item_id)


@review_router.post("/items/{item_id}/remove-from-ledger", status_code=status.HTTP_204_NO_CONTENT)
async def remove_bank_review_transaction(
    item_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete the ledger transaction the bank removed and rebuild its balances

    Args:
        item_id: The removal to accept
        user: Authenticated user reviewing
        db: Active database session
    """
    await remove_from_ledger(db, user, item_id)


@review_router.post("/items/{item_id}/keep-transaction", response_model=TransactionResponse)
async def keep_bank_review_transaction(
    item_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Close a removal leaving the ledger transaction as it is

    Args:
        item_id: The removal to decline
        user: Authenticated user reviewing
        db: Active database session

    Returns:
        The ledger transaction, with its bank source
    """
    return await keep_transaction(db, user, item_id)
