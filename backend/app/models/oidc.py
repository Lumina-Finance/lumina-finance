"""OIDC provider, identity, and authorization request models"""

import uuid
from datetime import datetime

from sqlalchemy import VARCHAR, Boolean, DateTime, ForeignKey, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class OidcProvider(Base):
    """An OpenID Connect provider sign-ins are accepted from, seeded from the environment"""

    __tablename__ = "oidc_providers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)

    # The environment key for the provider, stable across restarts so reseeding updates in place
    slug: Mapped[str] = mapped_column(VARCHAR(50), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(VARCHAR(100), nullable=False)  # sign-in button label

    # Issuer URL that discovery and every ID token check are bound to, exactly as the provider publishes it
    issuer: Mapped[str] = mapped_column(Text, nullable=False)
    client_id: Mapped[str] = mapped_column(Text, nullable=False)

    # Encrypted at rest so a leaked table cannot impersonate this client to the provider
    client_secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    scopes: Mapped[str] = mapped_column(Text, nullable=False)  # space-separated OAuth scopes

    # Providers removed from the environment are disabled rather than deleted, so linked
    # identities keep their provider row and re-enabling later needs no migration
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class OidcIdentity(Base):
    """Links a user to one subject at an OIDC provider, the pair that identifies a returning sign-in"""

    __tablename__ = "oidc_identities"
    __table_args__ = (
        UniqueConstraint("provider_id", "subject", name="uq_oidc_identity_provider_subject"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("oidc_providers.id", ondelete="CASCADE"), nullable=False
    )

    # The subject claim is the provider's permanent identifier for the user, matched before any email fallback
    subject: Mapped[str] = mapped_column(Text, nullable=False)

    # Email as the provider asserted it when the identity was linked, kept for support and audit
    email: Mapped[str | None] = mapped_column(VARCHAR(254))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class OidcAuthorizationRequest(Base):
    """Stores a single-use pending sign-in roundtrip to a provider, keyed by the hashed state"""

    __tablename__ = "oidc_authorization_requests"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)

    # Only the hash is stored so a leaked table cannot answer the callback for a pending sign-in
    state_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)

    # The nonce the ID token must echo, proving the token was minted for this roundtrip
    nonce: Mapped[str] = mapped_column(Text, nullable=False)

    # The PKCE verifier is revealed to the provider at the token exchange, so it must be stored raw
    code_verifier: Mapped[str] = mapped_column(Text, nullable=False)
    provider_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("oidc_providers.id", ondelete="CASCADE"), nullable=False
    )

    # The purpose scopes a roundtrip to the flow that started it, so a link roundtrip can
    # never complete a login and vice versa
    purpose: Mapped[str] = mapped_column(VARCHAR(10), nullable=False, server_default="login")

    # Set only for a link roundtrip, naming the signed-in account that passed step-up for it
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
