"""Shared bank sync test builders

Bank sync records have no routes yet that create them, so tests build them directly. Each builder
returns an unsaved row with the fields every test needs, for the caller to add to whichever session
it is testing through. Rows other rows point at get their id up front, so a dependent row can be
built before the first is flushed, though each level still has to be flushed before the next
"""

import uuid
from datetime import UTC, date, datetime

from app.models.account import Account
from app.models.bank_connection import (
    BankAccountLink,
    BankConnection,
    BankExternalAccount,
    BankImportKind,
    BankProvider,
    BankSigninNotice,
)
from app.models.bank_pending_transaction import BankPendingTransaction
from app.models.bank_transaction import BankTransaction, BankTransactionDisposition
from app.models.base import AccountKind, AccountType, CategoryKind
from app.models.category import Category
from app.models.transaction import Transaction
from app.models.user import User

BANK_ACCOUNT_ID = "ACT-1"
LINK_START = date(2026, 9, 1)
BANK_DATE = date(2026, 10, 3)
BANK_DESCRIPTION = "HARBOUR COFFEE 0412"


def _build_user(email: str) -> User:
    """Return an unsaved user with the fields every test user needs"""
    return User(id=uuid.uuid4(), email=email, first_name="Test", tz="America/Toronto", base_currency="CAD")


def _build_account(owner_id: uuid.UUID, name: str = "Everyday") -> Account:
    """Return an unsaved personal chequing account in CAD"""
    return Account(
        id=uuid.uuid4(),
        owner_id=owner_id,
        account_kind=AccountKind.ASSET,
        account_type=AccountType.CHECKING,
        name=name,
        currency="CAD",
    )


def _build_bank_connection(owner_id: uuid.UUID) -> BankConnection:
    """Return an unsaved SimpleFIN connection whose credential is a placeholder token"""
    return BankConnection(
        id=uuid.uuid4(),
        owner_id=owner_id,
        provider=BankProvider.SIMPLEFIN,
        credential_encrypted="not-a-real-token",
        server_host="bridge.example",
    )


def _build_external_account(connection: BankConnection, external_id: str = BANK_ACCOUNT_ID) -> BankExternalAccount:
    """Return an unsaved bank account listed by a connection"""
    return BankExternalAccount(
        owner_id=connection.owner_id,
        connection_id=connection.id,
        external_id=external_id,
        name="Everyday Chequing",
        institution_key="harbour",
        institution_name="Harbour Bank",
        login_key="login-1",
        currency="CAD",
        last_seen_at=datetime(2026, 10, 1, tzinfo=UTC),
    )


def _build_bank_link(
    account: Account,
    connection: BankConnection | None,
    external_account_id: str = BANK_ACCOUNT_ID,
) -> BankAccountLink:
    """Return an unsaved active link from a Lumina account to a bank account on a connection

    The link is owned by the account's owner and names the connection's provider
    """
    return BankAccountLink(
        id=uuid.uuid4(),
        owner_id=account.owner_id,
        account_id=account.id,
        connection_id=connection.id if connection else None,
        provider=BankProvider.SIMPLEFIN,
        external_account_id=external_account_id,
        external_account_name="Everyday Chequing",
        institution_name="Harbour Bank",
        import_kind=BankImportKind.INITIAL,
        import_start=LINK_START,
        checkpoint=date(2026, 8, 31),
    )


def _build_signin_notice(connection: BankConnection, login_key: str = "login-1") -> BankSigninNotice:
    """Return an unsaved notice that a bank login on a connection needs a sign-in"""
    return BankSigninNotice(
        owner_id=connection.owner_id,
        connection_id=connection.id,
        login_key=login_key,
        since=datetime(2026, 10, 1, tzinfo=UTC),
    )


def _build_category(owner_id: uuid.UUID) -> Category:
    """Return an unsaved personal expense category"""
    return Category(id=uuid.uuid4(), owner_id=owner_id, name="Coffee", kind=CategoryKind.EXPENSE)


def _build_ledger_transaction(account: Account, category_id: uuid.UUID, amount: int = -1250) -> Transaction:
    """Return an unsaved ledger transaction on the bank's date, in the account's currency"""
    return Transaction(
        id=uuid.uuid4(),
        created_by_user_id=account.owner_id,
        account_id=account.id,
        dt=BANK_DATE,
        category_id=category_id,
        amount=amount,
        currency=account.currency,
    )


def _build_bank_transaction(
    account: Account,
    external_transaction_id: str = "TRN-1001",
    *,
    external_account_id: str = BANK_ACCOUNT_ID,
    amount: int = -1250,
    transaction: Transaction | None = None,
) -> BankTransaction:
    """Return an unsaved bank transaction the bank sent for an account

    Given its ledger row, the record is accepted and aligned with the bank's date and amount;
    otherwise it awaits review
    """
    accepted = transaction is not None
    return BankTransaction(
        id=uuid.uuid4(),
        owner_id=account.owner_id,
        account_id=account.id,
        provider=BankProvider.SIMPLEFIN,
        external_account_id=external_account_id,
        external_transaction_id=external_transaction_id,
        disposition=BankTransactionDisposition.ACCEPTED if accepted else BankTransactionDisposition.AWAITING_REVIEW,
        transaction_id=transaction.id if accepted else None,
        observed_date=BANK_DATE,
        observed_amount=amount,
        description=BANK_DESCRIPTION,
        observed_at=datetime(2026, 10, 4, 9, 0, tzinfo=UTC),
        aligned_date=BANK_DATE if accepted else None,
        aligned_amount=amount if accepted else None,
    )


def _build_pending_transaction(account: Account, external_transaction_id: str, amount: int = -2500) -> BankPendingTransaction:
    """Return an unsaved pending item the bank reports for an account"""
    return BankPendingTransaction(
        owner_id=account.owner_id,
        account_id=account.id,
        external_transaction_id=external_transaction_id,
        transaction_date=date(2026, 10, 4),
        amount=amount,
        description="HOLD HARBOUR FUEL",
        observed_at=datetime(2026, 10, 4, 9, 0, tzinfo=UTC),
    )
