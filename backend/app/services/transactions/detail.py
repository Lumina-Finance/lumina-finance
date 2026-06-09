"""Transaction detail service"""
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.models.user import User
from app.permissions import check_transaction_access
from app.schemas.transaction import TransactionResponse
from app.services.transaction_responses import get_transaction_response


async def get_transaction_response_for_user(
    db: AsyncSession,
    user: User,
    transaction_id: uuid.UUID,
) -> TransactionResponse:
    """Return one transaction response after checking read access

    The service loads a transaction through the access helper, then builds the
    public response with related tag and merchant display data

    Args:
        db: Active database session
        user: Authenticated user requesting the transaction
        transaction_id: Transaction identifier from the route path

    Returns:
        Transaction response enriched with related display data
    """
    # Load the transaction through the access helper so only readable rows are returned
    txn = await check_transaction_access(db, transaction_id, user.id, PermissionLevel.READ)

    # Load related merchant and tag display data for the public API shape
    return await get_transaction_response(db, txn)
