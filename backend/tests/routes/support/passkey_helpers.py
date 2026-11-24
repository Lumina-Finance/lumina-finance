"""Shared passkey sign-in test support"""

import json
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from webauthn.helpers import bytes_to_base64url

from app.config.webauthn import WEBAUTHN_ORIGINS
from app.models.auth import AuthIdentity, WebauthnCredential
from app.models.base import AuthProvider
from tests.conftest import TestSession


async def _seed_passkey(user_id: str, credential_id: bytes, name: str = "Seeded key") -> uuid.UUID:
    """Insert a passkey and its WebAuthn identity directly for management tests

    Args:
        user_id: Owner of the passkey
        credential_id: Unique raw credential id
        name: Label to store

    Returns:
        The new passkey's id
    """
    async with TestSession() as db:
        passkey = WebauthnCredential(
            user_id=uuid.UUID(user_id),
            credential_id=credential_id,
            public_key=b"public-key-bytes",
            sign_count=0,
            name=name,
            confirmed_at=datetime.now(UTC),
        )
        db.add(passkey)

        # The registration flow records a WebAuthn identity alongside the first passkey, so this does too
        identity_exists = await db.scalar(
            select(AuthIdentity).where(
                AuthIdentity.user_id == uuid.UUID(user_id),
                AuthIdentity.auth_provider == AuthProvider.WEBAUTHN,
            )
        )
        if identity_exists is None:
            db.add(AuthIdentity(user_id=uuid.UUID(user_id), auth_provider=AuthProvider.WEBAUTHN))
        await db.commit()
        return passkey.id


def _build_assertion(challenge: str, credential_id: bytes, user_id: str) -> dict:
    """Assemble a sign-in assertion whose client data carries the given challenge"""
    client_data = {
        "type": "webauthn.get",
        "challenge": challenge,
        "origin": WEBAUTHN_ORIGINS[0],
    }
    return {
        "id": bytes_to_base64url(credential_id),
        "rawId": bytes_to_base64url(credential_id),
        "type": "public-key",
        "response": {
            "clientDataJSON": bytes_to_base64url(json.dumps(client_data).encode()),
            "authenticatorData": bytes_to_base64url(b"stub-authenticator-data"),
            "signature": bytes_to_base64url(b"stub-signature"),
            "userHandle": bytes_to_base64url(uuid.UUID(user_id).bytes),
        },
        "clientExtensionResults": {},
    }
