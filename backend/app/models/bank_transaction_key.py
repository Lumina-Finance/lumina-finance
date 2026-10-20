"""Record of which key the bank transaction hashes of OFX imports were made with"""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.encryption_key import SINGLETON_ID


class BankTransactionKeyFingerprint(Base):
    """Binds the database to the key its bank transaction hashes were made with

    Without it, a deployment restored without its key, or onto a volume that already generated
    another, starts cleanly and every statement imported again brings back what is already saved
    """

    __tablename__ = "bank_transaction_key_fingerprint"
    __table_args__ = (CheckConstraint(f"id = {SINGLETON_ID}", name="ck_bank_transaction_key_fingerprint_singleton"),)

    # Stated rather than inferred, so the metadata and the migration build the same column, as on
    # the encryption key's fingerprint
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False, default=SINGLETON_ID)

    # SHA-256 hex of the key rather than the key, so the row discloses nothing on its own
    fingerprint: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
