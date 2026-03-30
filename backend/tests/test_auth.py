from datetime import UTC

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.auth import AuthIdentity, PasswordCredential
from app.models.base import AuthProvider
from app.models.currency import Currency
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
    u = User(email="john@example.com", first_name="John", last_name="Doe", tz="America/Toronto", base_currency="CAD")
    db.add(u)
    await db.flush()
    return u


@pytest.fixture
async def auth_identity(db, user):
    """Seed an auth identity."""
    ai = AuthIdentity(user_id=user.id, auth_provider=AuthProvider.PASSWORD)
    db.add(ai)
    await db.flush()
    return ai


@pytest.fixture
async def password_credential(db, user):
    """Seed a password credential."""
    pc = PasswordCredential(user_id=user.id, password_hash="hashed_pw", password_algo="argon2id")
    db.add(pc)
    await db.flush()
    return pc


# --- AuthIdentity: Basic CRUD ---


async def test_create_auth_identity(db, auth_identity):
    """Insert an auth identity and verify fields."""
    result = await db.get(AuthIdentity, auth_identity.id)
    assert result is not None
    assert result.auth_provider == AuthProvider.PASSWORD
    assert result.email_verified is False
    assert result.email_verified_at is None


async def test_update_auth_identity_email_verified(db, auth_identity):
    """Mark email as verified."""
    from datetime import datetime

    auth_identity.email_verified = True
    auth_identity.email_verified_at = datetime.now(UTC)
    await db.flush()

    result = await db.get(AuthIdentity, auth_identity.id)
    assert result.email_verified is True
    assert result.email_verified_at is not None


async def test_delete_auth_identity(db, auth_identity):
    """Delete an auth identity."""
    aid = auth_identity.id
    await db.delete(auth_identity)
    await db.flush()

    result = await db.get(AuthIdentity, aid)
    assert result is None


# --- AuthIdentity: Defaults ---


async def test_email_verified_defaults_to_false(db, auth_identity):
    """email_verified should default to false."""
    assert auth_identity.email_verified is False


async def test_email_verified_at_defaults_to_null(db, auth_identity):
    """email_verified_at should default to null."""
    assert auth_identity.email_verified_at is None


# --- AuthIdentity: Constraints ---


async def test_duplicate_user_provider_rejected(db, auth_identity, user):
    """Unique constraint on (user_id, auth_provider) should prevent duplicates."""
    db.add(AuthIdentity(user_id=user.id, auth_provider=AuthProvider.PASSWORD))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_auth_identity_invalid_user_rejected(db):
    """user_id must reference a valid user."""
    import uuid

    db.add(AuthIdentity(user_id=uuid.uuid4(), auth_provider=AuthProvider.PASSWORD))
    with pytest.raises(IntegrityError):
        await db.flush()


# --- PasswordCredential: Basic CRUD ---


async def test_create_password_credential(db, password_credential):
    """Insert a password credential and verify fields."""
    result = await db.get(PasswordCredential, password_credential.user_id)
    assert result is not None
    assert result.password_hash == "hashed_pw"
    assert result.password_algo == "argon2id"
    assert result.failed_attempt_count == 0
    assert result.locked_until is None


async def test_update_failed_attempt_count(db, password_credential):
    """Increment failed attempt count."""
    password_credential.failed_attempt_count = 3
    await db.flush()

    result = await db.get(PasswordCredential, password_credential.user_id)
    assert result.failed_attempt_count == 3


async def test_delete_password_credential(db, password_credential):
    """Delete a password credential."""
    uid = password_credential.user_id
    await db.delete(password_credential)
    await db.flush()

    result = await db.get(PasswordCredential, uid)
    assert result is None


# --- PasswordCredential: Defaults ---


async def test_updated_at_auto_set(db, password_credential):
    """updated_at should be set automatically by the database."""
    await db.refresh(password_credential)
    assert password_credential.updated_at is not None


async def test_failed_attempt_count_defaults_to_zero(db, password_credential):
    """failed_attempt_count should default to 0."""
    assert password_credential.failed_attempt_count == 0


async def test_locked_until_defaults_to_null(db, password_credential):
    """locked_until should default to null."""
    assert password_credential.locked_until is None


# --- PasswordCredential: Constraints ---


@pytest.mark.filterwarnings("ignore::sqlalchemy.exc.SAWarning")
async def test_duplicate_password_credential_rejected(db, password_credential):
    """One-to-one: only one password credential per user."""
    db.add(PasswordCredential(user_id=password_credential.user_id, password_hash="other", password_algo="bcrypt"))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_password_hash_rejected(db, user):
    """password_hash is NOT NULL."""
    db.add(PasswordCredential(user_id=user.id, password_hash=None, password_algo="argon2id"))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_null_password_algo_rejected(db, user):
    """password_algo is NOT NULL."""
    db.add(PasswordCredential(user_id=user.id, password_hash="hashed", password_algo=None))
    with pytest.raises(IntegrityError):
        await db.flush()
