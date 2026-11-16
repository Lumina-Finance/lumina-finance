"""Shared helpers for the tests of connecting a bank by signing in at the bank

A test starts a sign-in through the route, reads the state the engine sent the bank off the scripted
provider, and finishes with the code it queued there, as the browser does when the bank sends the user back
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update

from app.encryption import encrypt
from app.models.bank_authorization import BankAuthorization
from app.models.bank_connection import BankConnection
from tests.conftest import TestSession
from tests.routes.support.auth_helpers import _get_auth_header, sign_up_confirmed
from tests.routes.support.bank_sync_helpers import _build_bank_connection
from tests.services.bank_sync.authorizing_provider import APPLICATION_KEY, AUTHORIZING_PROVIDER, AuthorizingProviderAdapter

# The address the test browser is on, and the one the bank is told to send the user back to
ORIGIN = "https://app.example.com"
RETURN_URL = "https://app.example.com/settings/bank-authorization"

APPLICATION_KEY_VALUE = "application-key-1"
CODE = "bank-code-1"
STORED_ACCESS = "signed-in-access"
OLD_ACCESS = "old-signed-in-access"


async def _start(client, headers, *, origin: str | None = ORIGIN, **fields):
    """Start a sign-in through the route, as the authorizing provider with its one field unless the fields say otherwise"""
    body = {"provider": AUTHORIZING_PROVIDER, "credentials": {APPLICATION_KEY: APPLICATION_KEY_VALUE}} | fields
    sent = headers if origin is None else {**headers, "Origin": origin}
    return await client.post("/bank-sync/authorizations", json=body, headers=sent)


async def _finish(client, headers, state: str, **answer):
    """Finish a sign-in through the route with the code the bank sends back unless the answer says otherwise"""
    return await client.post("/bank-sync/authorizations/finish", json={"state": state, **(answer or {"code": CODE})}, headers=headers)


async def _started_state(client, headers, provider: AuthorizingProviderAdapter, **fields) -> str:
    """Start a sign-in that must succeed, queue the code the bank will send back for it, and return its state"""
    started = await _start(client, headers, **fields)
    assert started.status_code == 201, started.text
    provider.codes[CODE] = STORED_ACCESS
    return provider.starts[-1].state


async def _stored_authorizations() -> list[BankAuthorization]:
    """Return every stored bank sign-in"""
    async with TestSession() as session:
        return list(await session.scalars(select(BankAuthorization)))


async def _expire_authorizations() -> None:
    """Move every stored bank sign-in's expiry into the past"""
    async with TestSession() as session:
        await session.execute(update(BankAuthorization).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
        await session.commit()


async def _commit_rejected_connection(owner_id: uuid.UUID, *, rejected: bool = True) -> BankConnection:
    """Commit a connection through the authorizing provider holding an access its provider rejected, or one that works"""
    async with TestSession() as session:
        connection = _build_bank_connection(owner_id, AUTHORIZING_PROVIDER, "Sign-in Bank")
        connection.credential_encrypted = encrypt(OLD_ACCESS)
        connection.created_at = datetime.now(UTC) - timedelta(days=2)
        if rejected:
            connection.credential_rejected_at = datetime.now(UTC) - timedelta(days=1)
        session.add(connection)
        await session.commit()
    return connection


async def _sign_up_other_user(client) -> tuple[dict, str]:
    """Sign up a second user and return their auth headers and id"""
    response = await sign_up_confirmed(
        client,
        {
            "email": "other@example.com",
            "password": "SecurePassword123!",
            "first_name": "Other",
            "tz": "America/Toronto",
            "base_currency": "CAD",
        },
    )
    return _get_auth_header(response), response.json()["user"]["id"]
