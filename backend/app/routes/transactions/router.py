"""Transaction API routes"""
import uuid
from datetime import date, datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.firefly_import import (
    FireflyBudgetImportRequest,
    FireflyBudgetImportResponse,
    FireflyTransactionImportRequest,
    FireflyTransactionImportResponse,
)
from app.schemas.transaction import (
    CreateTransactionRequest,
    TransactionImportRequest,
    TransactionImportResponse,
    TransactionResponse,
    TransactionsOverview,
    UpdateTransactionRequest,
)
from app.services.transactions.creation import create_transaction_and_get_response
from app.services.transactions.deletion import delete_transaction_for_user
from app.services.transactions.detail import get_transaction_response_for_user
from app.services.transactions.imports import (
    import_firefly_budgets,
    import_firefly_transactions,
    import_transactions,
)
from app.services.transactions.listing import list_transaction_responses
from app.services.transactions.overview import get_transactions_overview as get_transactions_overview_response
from app.services.transactions.update import update_transaction_and_get_response

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get("/overview", response_model=TransactionsOverview)
async def get_transactions_overview(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    account_id: Annotated[uuid.UUID | None, Query()] = None,
):
    """Return aggregated transaction metrics for a date range

    Args:
        user: Authenticated user requesting the overview
        db: Active database session
        from_date: Optional inclusive start date for the transaction window
        to_date: Optional inclusive end date for the transaction window
        account_id: Optional account filter applied within the user's accessible accounts

    Returns:
        Aggregated transaction overview metrics for the selected filters

    Raises:
        HTTPException: Raised with 422 when ``from_date`` is after ``to_date``
    """
    return await get_transactions_overview_response(
        db,
        user,
        from_date=from_date,
        to_date=to_date,
        account_id=account_id,
    )


@router.get("", response_model=list[TransactionResponse])
async def list_transactions(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    account_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    category_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    merchant_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    currency: Annotated[list[str] | None, Query()] = None,
    tag_id: Annotated[list[uuid.UUID] | None, Query()] = None,
    tag_match: Annotated[str, Query()] = "all",
    min_amount: Annotated[int | None, Query(ge=0)] = None,
    max_amount: Annotated[int | None, Query(ge=0)] = None,
    amount_currency: Annotated[str | None, Query(min_length=3, max_length=3)] = None,
    from_date: Annotated[date | None, Query()] = None,
    to_date: Annotated[date | None, Query()] = None,
    search_text: Annotated[str | None, Query(alias="q", max_length=200)] = None,
    sort_by: Annotated[str, Query()] = "dt",
    sort_order: Annotated[str, Query()] = "desc",
    limit: Annotated[int, Query(ge=1, le=50)] = 15,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    """Return paginated transactions with sorting and filtering

    Args:
        user: Authenticated user requesting transactions
        db: Active database session
        account_id: Optional accounts to keep within the user's accessible accounts
        category_id: Optional categories to keep
        merchant_id: Optional merchants to keep
        currency: Optional transaction currencies to keep
        tag_id: Optional tags to filter by, combined per ``tag_match``
        tag_match: ``all`` to require every selected tag, ``any`` to require at least one
        min_amount: Optional inclusive lower bound on the amount magnitude in ``amount_currency`` minor units
        max_amount: Optional inclusive upper bound on the amount magnitude in ``amount_currency`` minor units
        amount_currency: Currency the amount bounds are expressed in, required when a bound is set
        from_date: Optional inclusive start date for transaction dates
        to_date: Optional inclusive end date for transaction dates
        search_text: Optional text search across merchant name and notes
        sort_by: Transaction field used for ordering
        sort_order: Sort direction, either ``asc`` or ``desc``
        limit: Maximum number of transactions to return
        offset: Number of transactions to skip before returning rows

    Returns:
        Matching transaction responses for the requested page

    Raises:
        HTTPException: Raised with 422 for invalid sort fields, sort order, date
            range, tag match mode, or an amount range missing its currency
    """
    return await list_transaction_responses(
        db,
        user,
        account_ids=account_id,
        category_ids=category_id,
        merchant_ids=merchant_id,
        currencies=currency,
        tag_ids=tag_id,
        tag_match=tag_match,
        min_amount=min_amount,
        max_amount=max_amount,
        amount_currency=amount_currency,
        from_date=from_date,
        to_date=to_date,
        search_text=search_text,
        sort_by=sort_by,
        sort_order=sort_order,
        limit=limit,
        offset=offset,
    )


@router.get("/{transaction_id}", response_model=TransactionResponse)
async def get_transaction(
    transaction_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return one transaction after checking read access

    The route delegates read access checks and response assembly to the detail
    service

    Args:
        transaction_id: Transaction identifier from the route path
        user: Authenticated user requesting the transaction
        db: Active database session

    Returns:
        Transaction response enriched with tag and merchant display data
    """
    return await get_transaction_response_for_user(db, user, transaction_id)


@router.post("/import", response_model=TransactionImportResponse, status_code=status.HTTP_201_CREATED)
async def import_transaction_batch(
    data: TransactionImportRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Import a prepared transaction batch for the authenticated user

    The route delegates transaction validation, creation, cache invalidation,
    and affected snapshot recomputation to the import service

    Args:
        data: Prepared import payload from the frontend compiler
        user: Authenticated user running the import
        db: Active database session

    Returns:
        Import summary containing created and skipped transaction counts
    """
    return await import_transactions(db, user, data)


@router.post(
    "/import/firefly",
    response_model=FireflyTransactionImportResponse,
    status_code=status.HTTP_201_CREATED,
)
async def import_firefly_transaction_rows(
    data: FireflyTransactionImportRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Import journal rows from a Firefly III data export

    Rows between an imported account and an expense or revenue counterparty
    become single transactions, while rows between two imported accounts
    become transfer pairs. Rows that cannot convert are skipped and reported

    Args:
        data: Prepared Firefly III import payload from the frontend compiler
        user: Authenticated user running the import
        db: Active database session

    Returns:
        Import summary with converted, skipped, and created record counts
    """
    return await import_firefly_transactions(db, user, data)


@router.post(
    "/import/firefly/budgets",
    response_model=FireflyBudgetImportResponse,
    status_code=status.HTTP_201_CREATED,
)
async def import_firefly_budget_rows(
    data: FireflyBudgetImportRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Import budgets from a Firefly III data export

    Each budget becomes a monthly base budget backdated to its period start,
    with one period instance per month through today carrying the limit
    amount that was in force for that month

    Args:
        data: Budgets derived from the export by the frontend
        user: Authenticated user running the import
        db: Active database session

    Returns:
        Summary of the created budgets and their materialized periods
    """
    today = datetime.now(ZoneInfo(user.tz)).date()
    return await import_firefly_budgets(db, user, data, today)


@router.post("", response_model=TransactionResponse, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    data: CreateTransactionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a transaction after validating target account write access

    The route delegates account access checks, related entity validation,
    transaction insertion, tag updates, snapshot recalculation, and response
    assembly to the creation service

    Args:
        data: Transaction creation payload
        user: Authenticated user creating the transaction
        db: Active database session

    Returns:
        Newly created transaction response
    """
    return await create_transaction_and_get_response(db, user, data)


@router.patch("/{transaction_id}", response_model=TransactionResponse)
async def update_transaction(
    transaction_id: uuid.UUID,
    data: UpdateTransactionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Update a transaction after checking write access

    The route delegates write access checks, related entity validation, field
    updates, tag updates, snapshot recalculation, and response assembly to the
    update service

    Args:
        transaction_id: Transaction identifier from the route path
        data: Partial transaction update payload
        user: Authenticated user updating the transaction
        db: Active database session

    Returns:
        Updated transaction response with current related display data
    """
    return await update_transaction_and_get_response(db, user, transaction_id, data)


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    transaction_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a transaction after checking write access

    The route delegates access checks, tag removal, transaction deletion,
    snapshot recalculation, and cache updates to the deletion service

    Args:
        transaction_id: Transaction identifier from the route path
        user: Authenticated user deleting the transaction
        db: Active database session

    Returns:
        None
    """
    await delete_transaction_for_user(db, user, transaction_id)
