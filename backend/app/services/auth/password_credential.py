"""Shared first-password credential creation"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import AuthIdentity, PasswordCredential
from app.models.base import AuthProvider
from app.services.auth.password_helpers import hash_password

_PASSWORD_ALGO = "argon2id"  # noqa: S105 - algorithm name, not a secret


def create_first_password_credential(
    db: AsyncSession, user_id: uuid.UUID, new_password: str
) -> PasswordCredential:
    """Create the password credential and password auth identity for an account that had none

    Used where an account authenticates only through a provider and gains its first password,
    either through the emailed reset flow or an in-app set after reauth

    Args:
        db: Active database session
        user_id: Account gaining its first password
        new_password: Password already validated against the policy

    Returns:
        The added password credential
    """
    credential = PasswordCredential(
        user_id=user_id,
        password_hash=hash_password(new_password),
        password_algo=_PASSWORD_ALGO,
    )
    db.add(credential)
    db.add(AuthIdentity(user_id=user_id, auth_provider=AuthProvider.PASSWORD))
    return credential
