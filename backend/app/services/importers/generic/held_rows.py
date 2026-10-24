"""Telling the import page which of an OFX file's transactions an account already holds"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.bank_transaction_key import seal_bank_transaction_hash
from app.models.user import User
from app.permissions.accounts import load_account_access_lookup
from app.schemas.import_run import CheckHeldBankTransactionsRequest
from app.services.importers.shared.accounts import get_existing_import_account
from app.services.transactions.bank_transaction_ids import BankTransactionKey, find_held_bank_transactions


async def find_held_import_rows(db: AsyncSession, user: User, data: CheckHeldBankTransactionsRequest) -> list[int]:
    """Return the positions of the transactions whose account already holds their bank transaction

    The accounts must be ones the commit would write to, checked the way the commit checks them, so
    the answer never tells a user about an account they cannot import into. Nothing is stored

    Args:
        db: Active database session
        user: Authenticated user previewing the import
        data: The transactions as the import page sends them, each with the account it goes into

    Returns:
        Positions in the request, in request order

    Raises:
        HTTPException: Raised with 404 when an account is not the user's to write to, and 422 when it
            is archived
    """
    account_ids = {item.account_id for item in data.items}
    access_lookup = await load_account_access_lookup(db, account_ids, user.id)
    for account_id in sorted(account_ids):
        await get_existing_import_account(db, user, account_id, access_lookup)

    keys: list[BankTransactionKey] = [
        (item.account_id, seal_bank_transaction_hash(item.bank_account, item.bank_transaction)) for item in data.items
    ]
    held = await find_held_bank_transactions(db, keys)
    return [position for position, key in enumerate(keys) if key in held]
