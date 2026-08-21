"""Record of which encryption key the stored secrets are under"""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

# The table holds one row, and this is its id. A fixed primary key with a check constraint
# is what keeps a second row from ever being inserted alongside it
SINGLETON_ID = 1


class EncryptionKeyFingerprint(Base):
    """Binds the database to the encryption key its stored secrets were written under

    Without this, a deployment that loses its key file cannot tell a first run from a
    removed key, so it mints a fresh key, starts cleanly, and leaves every stored secret
    unreadable with nothing reporting it
    """

    __tablename__ = "encryption_key_fingerprint"
    __table_args__ = (
        CheckConstraint(f"id = {SINGLETON_ID}", name="ck_encryption_key_fingerprint_singleton"),
    )

    # autoincrement is stated rather than inferred, so the metadata and the migration build
    # the same column. An integer primary key is a sequence by default, and only the
    # client-side default above would otherwise suppress it here but not in the migration
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False, default=SINGLETON_ID)

    # SHA-256 hex of the key rather than the key, so the row discloses nothing on its own
    fingerprint: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
