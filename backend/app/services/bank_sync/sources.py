"""The bank source every transaction response carries

A ledger transaction is bank-sourced when an accepted bank transaction record points at it, and
manual otherwise, so the ledger has no source column of its own. The record keeps the provider and
the bank's values, so the source stays readable after the account is unlinked or its connection is
disconnected
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_transaction import BankTransaction
from app.models.transaction import Transaction
from app.schemas.bank_sync import BankValues, TransactionBankSource
from app.services.bank_sync.availability import PROVIDER_ADAPTERS
from app.services.bank_sync.review_state import edited_fields


def build_bank_source(record: BankTransaction, txn: Transaction) -> TransactionBankSource:
    """Return the bank source of a ledger transaction from the accepted record pointing at it

    Args:
        record: The accepted bank transaction the ledger row came from
        txn: The ledger row

    Returns:
        The provider, the bank's latest values, the fields the user has edited and the waiting
        correction or removal, if any
    """
    return TransactionBankSource(
        provider=record.provider,
        provider_name=PROVIDER_ADAPTERS[record.provider].provider_name,
        bank_values=BankValues(
            date=record.observed_date,
            amount=record.observed_amount,
            raw_amount=record.raw_amount,
            description=record.description,
        ),
        received_at=record.received_at,
        edited_fields=edited_fields(record, txn.dt, txn.amount),
        # A record's open correction or removal is reviewed under the record's own id
        review_item_id=record.id if record.open_kind is not None else None,
    )


async def get_bank_sources_batch(
    db: AsyncSession,
    transactions: list[Transaction],
) -> dict[uuid.UUID, TransactionBankSource]:
    """Return the bank sources of the bank-sourced transactions among a page, in one query

    Args:
        db: Active database session
        transactions: Ledger rows being returned

    Returns:
        Bank sources keyed by transaction id, with no entry for a manual transaction
    """
    if not transactions:
        return {}
    by_id = {txn.id: txn for txn in transactions}

    # Only an accepted record has a ledger row, so matching on it finds exactly the sources
    result = await db.execute(select(BankTransaction).where(BankTransaction.transaction_id.in_(by_id)))
    return {record.transaction_id: build_bank_source(record, by_id[record.transaction_id]) for record in result.scalars()}
