"""What the server keeps in place of the ID a provider gave a bank transaction"""

from app.bank_transaction_key import seal_bank_transaction_hash


def hash_bank_transaction_id(provider: str, external_account_id: str, external_transaction_id: str) -> str:
    """Return the keyed hash a bank transaction is stored under

    A provider's transaction IDs belong to a bank account, so the provider and the bank account name the
    transaction with it. They are the bank account key of the hash an OFX import keeps, joined by a colon,
    and the migration that carried saved IDs into hashes builds them the same way in SQL. Changing it leaves
    every saved record unmatched, so the next sync brings in again what the user already decided

    Args:
        provider: The provider that reported the transaction
        external_account_id: The provider's ID for the bank account the transaction belongs to
        external_transaction_id: The provider's ID for the transaction

    Returns:
        The keyed hash, as 64 lower-case hex characters
    """
    return seal_bank_transaction_hash(f"{provider}:{external_account_id}", external_transaction_id)
