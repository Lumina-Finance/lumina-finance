"""Recent activity dashboard widget service"""
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.dashboard import DASHBOARD_RECENT_TRANSACTIONS_LIMIT
from app.models.transaction import Transaction
from app.schemas.transaction import TransactionResponse
from app.services.transactions.response_helpers import (
    build_transaction_response,
    get_merchant_names_batch,
    get_tag_ids_batch,
    get_tags_batch,
)


async def get_recent_transactions(
    db: AsyncSession,
    account_ids: list[uuid.UUID],
    window_days: int,
    now: datetime,
) -> list[TransactionResponse]:
    """Return dashboard recent transaction responses inside the requested window

    Args:
        db: Active database session
        account_ids: Account IDs included in the dashboard scope
        window_days: Number of days to include before ``now``
        now: Viewer-local timestamp used to derive the window start

    Returns:
        Recent transaction responses ordered by newest transaction date first
    """
    if not account_ids:
        return []

    window_start = now.date() - timedelta(days=window_days)

    # Fetch newest transactions in the readable-account scope for the dashboard activity list
    transaction_result = await db.execute(
        select(Transaction)
        .where(
            Transaction.account_id.in_(account_ids),
            Transaction.dt >= window_start,
        )
        .order_by(Transaction.dt.desc(), Transaction.id)
        .limit(DASHBOARD_RECENT_TRANSACTIONS_LIMIT),
    )
    transactions = list(transaction_result.scalars().all())

    # Batch-load related response data so recent activity does not issue per-row queries
    tag_ids_by_transaction_id = await get_tag_ids_batch(db, [transaction.id for transaction in transactions])
    tag_summaries_by_transaction_id = await get_tags_batch(db, [transaction.id for transaction in transactions])
    merchant_names_by_id = await get_merchant_names_batch(db, [transaction.merchant_id for transaction in transactions])
    return [
        build_transaction_response(
            transaction,
            tag_ids_by_transaction_id[transaction.id],
            merchant_names_by_id.get(transaction.merchant_id) if transaction.merchant_id else None,
            tag_summaries_by_transaction_id[transaction.id],
        )
        for transaction in transactions
    ]
