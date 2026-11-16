"""A bank sign-in in flight, between sending the user to their bank and the bank sending them back"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import VARCHAR, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.bank_connection import PROVIDER_ID_MAX_LENGTH, provider_id_check
from app.models.base import Base
from app.models.types import EncryptedText

# How long a user has at the bank before the sign-in is refused on return. Long enough to find a banking
# app and approve there, short enough that a stolen link to the return page is soon useless
BANK_AUTHORIZATION_LIFETIME = timedelta(minutes=30)

# The length of the hex digest of the sign-in's state, the only form of it that is stored
STATE_HASH_LENGTH = 64


class BankAuthorization(Base):
    """What the app must remember between sending a user to their bank and the bank sending them back

    The checked credential fields stay here, encrypted under the application key, since the return
    carries only a one-time code and the state this row is found by. The state itself is never stored,
    only its hash, so a copy of this table can't be turned into a return link. The row is deleted the
    moment a return claims it, so a return link works once, and an expired row is pruned
    """

    __tablename__ = "bank_authorizations"
    __table_args__ = (
        provider_id_check("bank_authorizations"),
        UniqueConstraint("state_hash", name="uq_bank_authorizations_state_hash"),
        # One sign-in in flight per user: starting another replaces the first
        UniqueConstraint("owner_id", name="uq_bank_authorizations_owner_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(VARCHAR(PROVIDER_ID_MAX_LENGTH), nullable=False)

    # Set when the sign-in replaces a rejected connection's credential, and null for a new connection
    connection_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("bank_connections.id", ondelete="CASCADE"))
    nickname: Mapped[str | None] = mapped_column(VARCHAR(64))

    # The account whose link flow sent the user here, so the return goes back to it. Deleting the
    # account leaves the sign-in valid, and the return then lands in settings
    return_account_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"))

    # The JSON of the credential fields the user supplied, such as an application's key
    credentials_encrypted: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    state_hash: Mapped[str] = mapped_column(VARCHAR(STATE_HASH_LENGTH), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
