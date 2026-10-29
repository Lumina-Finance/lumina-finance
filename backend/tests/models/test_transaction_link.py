from datetime import date

import pytest
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.models.account import Account
from app.models.base import AccountKind, AccountType, CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.transaction import Transaction
from app.models.transaction_link import TransactionLink
from app.models.user import User


@pytest.fixture
async def expense_and_refund(db):
    """Seed an expense and the refund of it in one account."""
    db.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
    user = User(email="user@example.com", first_name="Test", last_name="User", tz="America/Toronto", base_currency="CAD")
    db.add(user)
    await db.flush()
    account = Account(owner_id=user.id, account_kind=AccountKind.ASSET, account_type=AccountType.CHECKING, name="Checking", currency="CAD")
    category = Category(owner_id=user.id, name="Groceries", kind=CategoryKind.EXPENSE)
    db.add_all([account, category])
    await db.flush()
    expense, refund = (
        Transaction(
            created_by_user_id=user.id,
            account_id=account.id,
            category_id=category.id,
            dt=date(2026, 1, 1),
            amount=amount,
            currency="CAD",
        )
        for amount in (-5000, 5000)
    )
    db.add_all([expense, refund])
    await db.flush()
    return expense, refund


async def test_a_refund_links_to_one_expense(db, expense_and_refund):
    """A refund links to its expense once, so a second link from it is refused."""
    expense, refund = expense_and_refund
    db.add(TransactionLink(refund_transaction_id=refund.id, original_transaction_id=expense.id))
    await db.flush()
    db.add(TransactionLink(refund_transaction_id=refund.id, original_transaction_id=expense.id))
    with pytest.raises(IntegrityError, match="uq_transaction_links_refund"):
        await db.flush()


async def test_link_refuses_a_transaction_linked_to_itself(db, expense_and_refund):
    """A transaction cannot be both sides of one link."""
    expense, _ = expense_and_refund
    db.add(TransactionLink(refund_transaction_id=expense.id, original_transaction_id=expense.id))
    with pytest.raises(IntegrityError, match="ck_transaction_links_distinct"):
        await db.flush()


async def test_deleting_either_transaction_removes_its_links(db, expense_and_refund):
    """Deleting the refund removes the link and leaves the expense."""
    expense, refund = expense_and_refund
    db.add(TransactionLink(refund_transaction_id=refund.id, original_transaction_id=expense.id))
    await db.flush()
    await db.execute(delete(Transaction).where(Transaction.id == refund.id))
    assert (await db.execute(select(TransactionLink))).scalars().all() == []
    assert await db.get(Transaction, expense.id, populate_existing=True) is not None
