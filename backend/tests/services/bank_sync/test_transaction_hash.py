"""The keyed hash kept in place of a bank transaction's ID

The ID a provider sends is a bank's own reference for a transaction, so a copy of the database holding it as sent
would tie a ledger row to a record at the bank. The server keeps a keyed hash of it instead, and the hash is how a
record sent again is told from a new one. Two bank accounts that happen to number a transaction alike must not
collide, or the second account's transaction would be taken for one already approved or dismissed in the first
"""

import hashlib
import hmac

from app.bank_transaction_key import resolve_key
from app.models.bank_connection import BankProvider
from app.services.bank_sync.transaction_hash import hash_bank_transaction_id


def test_the_hash_is_the_keyed_digest_of_the_provider_bank_account_and_id():
    """Worked out here from its definition, since the migration carrying saved IDs builds the same bytes in SQL"""
    digest = hashlib.sha256(b"simplefin:ACT-1\0TRN-coffee").digest()
    expected = hmac.new(resolve_key(generate=False), digest, hashlib.sha256).hexdigest()

    assert hash_bank_transaction_id(BankProvider.SIMPLEFIN, "ACT-1", "TRN-coffee") == expected


def test_the_same_id_on_two_bank_accounts_hashes_apart():
    """An ID is the bank account's own, so only the pair names a transaction"""
    assert hash_bank_transaction_id(BankProvider.SIMPLEFIN, "ACT-1", "TRN-1") != hash_bank_transaction_id(
        BankProvider.SIMPLEFIN, "ACT-2", "TRN-1"
    )
