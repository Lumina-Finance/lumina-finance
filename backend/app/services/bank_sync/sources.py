"""The bank source every transaction response carries

A ledger transaction is bank-sourced when an accepted bank transaction record points at it, and
manual otherwise, so the ledger has no source column of its own. The record keeps the provider and
the bank's values, so the source stays readable after the account is unlinked or its connection is
disconnected
"""

import uuid
from collections.abc import Iterable

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_transaction import BankTransaction
from app.models.transaction import Transaction
from app.schemas.bank_sync import BankValues, TransactionBankSource
from app.services.bank_sync.availability import read_provider_labels
from app.services.bank_sync.review_state import edited_fields


def build_bank_source(record: BankTransaction, txn: Transaction, provider_name: str) -> TransactionBankSource:
    """Return the bank source of a ledger transaction from the accepted record pointing at it

    Args:
        record: The accepted bank transaction the ledger row came from
        txn: The ledger row
        provider_name: The name the record's provider is shown by

    Returns:
        The provider, the bank's latest values, the fields the user has edited and the waiting
        correction or removal, if any
    """
    return TransactionBankSource(
        provider=record.provider,
        provider_name=provider_name,
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


def with_bank_records(query: Select[tuple[Transaction]]) -> Select[tuple[Transaction, BankTransaction | None]]:
    """Return a ledger read with each row's accepted bank record joined in, None on a manual row

    Only an accepted record has a ledger row, and at most one points at each, so the join keeps the
    read's rows as they were and the sources come with them rather than in a query of their own
    """
    return query.outerjoin(BankTransaction, BankTransaction.transaction_id == Transaction.id).add_columns(BankTransaction)


async def build_bank_sources(
    db: AsyncSession,
    rows: Iterable[tuple[Transaction, BankTransaction | None]],
) -> dict[uuid.UUID, TransactionBankSource]:
    """Return the bank sources of the bank-sourced rows among a read made through with_bank_records

    Args:
        db: Active database session, read only for a provider no longer installed
        rows: Each ledger row with its accepted bank record, None on a manual row

    Returns:
        Bank sources keyed by transaction id, with no entry for a manual transaction
    """
    sourced = [(txn, record) for txn, record in rows if record is not None]
    names = await read_provider_labels(db, (record.provider for _, record in sourced))
    return {txn.id: build_bank_source(record, txn, names[record.provider]) for txn, record in sourced}


async def get_bank_source(db: AsyncSession, txn: Transaction) -> TransactionBankSource | None:
    """Return one ledger row's bank source, None on a manual transaction

    Args:
        db: Active database session
        txn: The ledger row being returned

    Returns:
        The bank source, or None when no accepted record points at the row
    """
    # Only an accepted record has a ledger row, so matching on it finds exactly the source
    record = await db.scalar(select(BankTransaction).where(BankTransaction.transaction_id == txn.id))
    return (await build_bank_sources(db, [(txn, record)])).get(txn.id)
