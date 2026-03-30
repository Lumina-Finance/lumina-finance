import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.account import Account
from app.models.base import AccountType, CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.tag import Tag, TransactionTag
from app.models.transaction import Transaction
from app.models.user import User

# --- Fixtures ---


@pytest.fixture
async def currency(db):
    """Seed a currency for FK references."""
    c = Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2)
    db.add(c)
    await db.flush()
    return c


@pytest.fixture
async def user(db, currency):
    """Seed a user for FK references."""
    u = User(email="user@example.com", first_name="Test", last_name="User", tz="America/Toronto", base_currency="CAD")
    db.add(u)
    await db.flush()
    return u


@pytest.fixture
async def tag(db, user):
    """Seed a tag."""
    t = Tag(owner_id=user.id, name="vacation")
    db.add(t)
    await db.flush()
    return t


@pytest.fixture
async def transaction(db, user, currency):
    """Seed a transaction for tagging."""
    account = Account(owner_id=user.id, account_type=AccountType.CHECKING, name="Checking", currency="CAD")
    db.add(account)
    await db.flush()

    category = Category(owner_id=user.id, name="Travel", kind=CategoryKind.EXPENSE)
    db.add(category)
    await db.flush()

    t = Transaction(
        created_by_user_id=user.id, account_id=account.id, category_id=category.id,
        ts=datetime.now(UTC), amount=-50000, currency="CAD",
    )
    db.add(t)
    await db.flush()
    return t


# --- Tag: Basic CRUD ---


async def test_create_tag(db, tag, user):
    """Insert a tag and verify fields."""
    result = await db.get(Tag, tag.id)
    assert result is not None
    assert result.owner_id == user.id
    assert result.name == "vacation"
    assert result.created_at is not None


async def test_update_tag(db, tag):
    """Update a tag's name."""
    tag.name = "travel"
    await db.flush()

    result = await db.get(Tag, tag.id)
    assert result.name == "travel"


async def test_delete_tag(db, tag):
    """Delete a tag."""
    tid = tag.id
    await db.delete(tag)
    await db.flush()

    result = await db.get(Tag, tid)
    assert result is None


# --- Tag: Defaults ---


async def test_created_at_auto_set(db, tag):
    """created_at should be set automatically by the database."""
    await db.refresh(tag)
    assert tag.created_at is not None


# --- Tag: Constraints ---


async def test_duplicate_tag_name_per_user_rejected(db, tag, user):
    """Unique constraint on (owner_id, name) should prevent duplicates."""
    db.add(Tag(owner_id=user.id, name="vacation"))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_same_tag_name_different_users_accepted(db, tag, currency):
    """Different users can have tags with the same name."""
    other = User(email="other@example.com", first_name="Other", last_name="User", tz="America/Toronto", base_currency="CAD")
    db.add(other)
    await db.flush()

    db.add(Tag(owner_id=other.id, name="vacation"))
    await db.flush()  # Should not raise


async def test_null_owner_rejected(db):
    """owner_id is NOT NULL."""
    db.add(Tag(owner_id=None, name="bad"))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_name_rejected(db, user):
    """name is NOT NULL."""
    db.add(Tag(owner_id=user.id, name=None))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_owner_rejected(db):
    """owner_id must reference a valid user."""
    db.add(Tag(owner_id=uuid.uuid4(), name="bad"))
    with pytest.raises(IntegrityError):
        await db.flush()


# --- TransactionTag: Basic CRUD ---


async def test_tag_transaction(db, tag, transaction):
    """Link a tag to a transaction."""
    tt = TransactionTag(transaction_id=transaction.id, tag_id=tag.id)
    db.add(tt)
    await db.flush()

    result = await db.get(TransactionTag, (transaction.id, tag.id))
    assert result is not None


async def test_untag_transaction(db, tag, transaction):
    """Remove a tag from a transaction."""
    tt = TransactionTag(transaction_id=transaction.id, tag_id=tag.id)
    db.add(tt)
    await db.flush()

    await db.delete(tt)
    await db.flush()

    result = await db.get(TransactionTag, (transaction.id, tag.id))
    assert result is None


async def test_multiple_tags_per_transaction(db, user, tag, transaction):
    """A transaction can have multiple tags."""
    tag2 = Tag(owner_id=user.id, name="tax-deductible")
    db.add(tag2)
    await db.flush()

    db.add(TransactionTag(transaction_id=transaction.id, tag_id=tag.id))
    db.add(TransactionTag(transaction_id=transaction.id, tag_id=tag2.id))
    await db.flush()

    r1 = await db.get(TransactionTag, (transaction.id, tag.id))
    r2 = await db.get(TransactionTag, (transaction.id, tag2.id))
    assert r1 is not None
    assert r2 is not None


# --- TransactionTag: Constraints ---


async def test_duplicate_transaction_tag_rejected(db, tag, transaction):
    """Same tag can't be applied to the same transaction twice."""
    db.add(TransactionTag(transaction_id=transaction.id, tag_id=tag.id))
    await db.flush()

    db.add(TransactionTag(transaction_id=transaction.id, tag_id=tag.id))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_transaction_rejected(db, tag):
    """transaction_id must reference a valid transaction."""
    db.add(TransactionTag(transaction_id=uuid.uuid4(), tag_id=tag.id))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_invalid_tag_rejected(db, transaction):
    """tag_id must reference a valid tag."""
    db.add(TransactionTag(transaction_id=transaction.id, tag_id=uuid.uuid4()))
    with pytest.raises(IntegrityError):
        await db.flush()
