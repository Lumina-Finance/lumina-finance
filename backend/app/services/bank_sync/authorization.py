"""Connecting a bank by signing in at the bank and returning, for providers that connect that way

Starting checks what the user supplied as a pasted claim does, asks the provider for the bank's address
and keeps the checked fields in a sign-in record, found again by the hash of a random state. The bank
sends the user back to the app with the state and a one-time code. Finishing takes the record by its
state in one committed delete, so a return works once and only for the user who started it, and then
claims the code and saves the connection through the steps a pasted claim or reconnect uses
"""

import hashlib
import json
import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import urlsplit

from fastapi import HTTPException, status
from sqlalchemy import delete, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.rls.functions import PRUNE_EXPIRED_BANK_AUTHORIZATIONS
from app.encryption import decrypt, encrypt
from app.models.bank_authorization import BANK_AUTHORIZATION_LIFETIME, BankAuthorization
from app.models.user import User
from app.schemas.bank_sync import (
    FinishBankAuthorizationRequest,
    FinishBankAuthorizationResponse,
    StartBankAuthorizationRequest,
    StartBankAuthorizationResponse,
)
from app.services.accounts.access import get_own_personal_account
from app.services.bank_sync.availability import LINK_NOT_OWN_DETAIL, get_enabled_adapter, require_bank_linking
from app.services.bank_sync.claim import (
    check_reconnectable,
    read_credentials,
    require_offered,
    save_claimed_connection,
    save_reconnected_connection,
)
from app.services.bank_sync.connections import read_nickname
from app.services.bank_sync.outbound import within_time_budget
from app.services.bank_sync.providers.contract import REFUSED_FIELDS_HEADER, ClaimRefused, ProviderAdapter, ProviderUnreachable
from app.services.bank_sync.release import release_credential

logger = logging.getLogger(__name__)

# Where the bank sends the user back to, under the address the user is on. The app's page at this
# path finishes the sign-in
RETURN_PATH = "/settings/bank-authorization"

# The random bytes of a sign-in's state, enough to be unguessable
STATE_BYTES = 32

# The kinds of address a provider may send the user to. A bank on a local server for development is plain http
_BANK_URL_SCHEMES = frozenset({"https", "http"})

# What a new start overwrites in the user's earlier sign-in
_REPLACED_FIELDS = (
    "provider",
    "connection_id",
    "nickname",
    "return_account_id",
    "credentials_encrypted",
    "state_hash",
    "created_at",
    "expires_at",
)

AUTHORIZATION_ENDED_DETAIL = "This bank sign-in has ended. Please connect again"
AUTHORIZATION_EXPIRED_DETAIL = "This bank sign-in took too long. Please connect again"


def hash_state(state: str) -> str:
    """Return the form of a state that is stored and looked up, so a copy of the table can't be turned into a return link"""
    return hashlib.sha256(state.encode()).hexdigest()


@within_time_budget
async def start_authorization(
    db: AsyncSession,
    user: User,
    request: StartBankAuthorizationRequest,
    *,
    origin: str | None,
) -> StartBankAuthorizationResponse:
    """Check what the user supplied, ask the provider for the bank's address and keep the sign-in until the user returns

    The user's earlier sign-in that never returned is replaced, since one is in flight at a time.
    Nothing is counted against the provider's request budget, as the connection doesn't exist yet

    Args:
        db: Active database session
        user: The user connecting
        request: The provider and its credential fields, a nickname for a new connection, or the
            rejected connection to reconnect, and the account whose link flow started it
        origin: The address of the page the request came from, which the bank is told to send the user back to

    Returns:
        The bank's address to send the user to

    Raises:
        HTTPException 403: The user may not link bank accounts, or the provider isn't offered for
            new connections
        HTTPException 404: The connection or the account isn't the user's
        HTTPException 409: The connection's credential still works
        HTTPException 422: The provider isn't enabled or connects another way, the origin is missing,
            a field or the nickname is refused, or the provider refused what was supplied, saying why
        HTTPException 502: The provider couldn't be reached or gave no usable answer
    """
    adapter = get_enabled_adapter(request.provider)
    if not adapter.authorizes_at_bank:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"{adapter.provider_name} connects by pasting a credential, not by signing in at your bank",
        )
    require_bank_linking(user.id)
    redirect_url = _build_redirect_url(origin)
    nickname = await _check_target(db, user, adapter, request)
    if request.return_account_id is not None:
        await get_own_personal_account(db, request.return_account_id, user.id, not_own_detail=LINK_NOT_OWN_DETAIL)
    credentials = read_credentials(adapter, request.credentials)

    state = secrets.token_urlsafe(STATE_BYTES)
    try:
        url = await adapter.start_authorization(credentials, redirect_url=redirect_url, state=state)
    except ClaimRefused as refused:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(refused),
            headers={REFUSED_FIELDS_HEADER: ",".join(refused.fields)} if refused.fields else None,
        ) from None
    except ProviderUnreachable as unreachable:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(unreachable)) from None
    # The browser goes straight to this address, so one that isn't a web page, such as a javascript: one, never reaches it
    if urlsplit(url).scheme not in _BANK_URL_SCHEMES:
        logger.warning("%s gave a bank address that isn't a web page", adapter.provider_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"{adapter.provider_name} gave a bank address Lumina Finance can't open. Please try again in a few minutes",
        )

    # A user has one sign-in in flight, held by the table's unique key on the owner, so a start replaces
    # the earlier one even when starts overlap
    statement = insert(BankAuthorization).values(
        owner_id=user.id,
        provider=adapter.provider_id,
        connection_id=request.connection_id,
        nickname=nickname,
        return_account_id=request.return_account_id,
        credentials_encrypted=encrypt(json.dumps(credentials)),
        state_hash=hash_state(state),
        expires_at=datetime.now(UTC) + BANK_AUTHORIZATION_LIFETIME,
    )
    await db.execute(
        statement.on_conflict_do_update(
            index_elements=[BankAuthorization.owner_id],
            set_={field: statement.excluded[field] for field in _REPLACED_FIELDS},
        )
    )
    await db.commit()
    return StartBankAuthorizationResponse(url=url)


@dataclass(frozen=True)
class _TakenAuthorization:
    """A sign-in record as the return took it, with its credential fields decrypted"""

    provider: str
    connection_id: uuid.UUID | None
    nickname: str | None
    return_account_id: uuid.UUID | None
    credentials: dict[str, str]
    expires_at: datetime


@within_time_budget
async def finish_authorization(db: AsyncSession, user: User, request: FinishBankAuthorizationRequest) -> FinishBankAuthorizationResponse:
    """Finish a bank sign-in from what the bank sent the user back with, adding or reconnecting a connection

    The sign-in is spent first, in a committed transaction of its own, so a return link works once
    whatever follows. The code is claimed only after every check, and once claimed, any failure
    gives the provider's access back before it is raised

    Args:
        db: Active database session
        user: The user the bank sent back, who must be the one who started the sign-in
        request: The state, and the bank's code or the error it returned in its place

    Returns:
        The new or reconnected connection, or that the bank refused and nothing was added

    Raises:
        HTTPException 403: The user may not link bank accounts, or the provider is no longer
            offered for new connections
        HTTPException 404: The state is unknown, already used, another user's, or its connection
            is gone
        HTTPException 409: The reconnected connection's credential works again, or its provider
            is no longer installed
        HTTPException 422: The sign-in expired, the provider isn't enabled, or refused the code
        HTTPException 502: The provider couldn't be reached, so the sign-in must start again
    """
    taken = await _take_authorization(db, user.id, request.state)
    if taken.expires_at <= datetime.now(UTC):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=AUTHORIZATION_EXPIRED_DETAIL)
    if request.error is not None or request.code is None:
        return FinishBankAuthorizationResponse(
            outcome="cancelled", return_account_id=taken.return_account_id, connection=None, reconnection=None
        )

    if taken.connection_id is None:
        adapter = get_enabled_adapter(taken.provider)
        require_bank_linking(user.id)
        require_offered(taken.provider, adapter)
    else:
        adapter = await check_reconnectable(db, user, taken.connection_id)

    try:
        credential = await adapter.claim_authorized(taken.credentials, code=request.code)
    except ClaimRefused as refused:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(refused)) from None
    except ProviderUnreachable:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"{adapter.provider_name} couldn't confirm your bank sign-in. Please connect again",
        ) from None

    try:
        return await _save(db, user, adapter, taken, credential)
    except BaseException:
        # The code is spent and nothing keeps the access it yielded, so the provider is told to end it,
        # and what failed is raised as it was
        await db.rollback()
        await release_credential(adapter, credential)
        raise


async def _save(
    db: AsyncSession,
    user: User,
    adapter: ProviderAdapter,
    taken: _TakenAuthorization,
    credential: str,
) -> FinishBankAuthorizationResponse:
    """Keep the claimed access as a new connection, or in place of the rejected connection's credential"""
    if taken.connection_id is None:
        connection = await save_claimed_connection(db, user, adapter, nickname=taken.nickname, credential=credential)
        return FinishBankAuthorizationResponse(
            outcome="connected", return_account_id=taken.return_account_id, connection=connection, reconnection=None
        )
    reconnection = await save_reconnected_connection(db, user, adapter, connection_id=taken.connection_id, credential=credential)
    return FinishBankAuthorizationResponse(
        outcome="reconnected", return_account_id=taken.return_account_id, connection=None, reconnection=reconnection
    )


async def _take_authorization(db: AsyncSession, user_id: uuid.UUID, state: str) -> _TakenAuthorization:
    """Delete and return the user's sign-in that the state belongs to, committed before anything else is done with it

    A state that is unknown, already used or another user's deletes nothing

    Raises:
        HTTPException 404: No sign-in of the user's has this state
    """
    result = await db.execute(
        delete(BankAuthorization)
        .where(BankAuthorization.state_hash == hash_state(state), BankAuthorization.owner_id == user_id)
        .returning(
            BankAuthorization.provider,
            BankAuthorization.connection_id,
            BankAuthorization.nickname,
            BankAuthorization.return_account_id,
            BankAuthorization.credentials_encrypted,
            BankAuthorization.expires_at,
        )
    )
    row = result.one_or_none()
    await db.commit()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=AUTHORIZATION_ENDED_DETAIL)
    return _TakenAuthorization(
        provider=row.provider,
        connection_id=row.connection_id,
        nickname=row.nickname,
        return_account_id=row.return_account_id,
        credentials=json.loads(decrypt(row.credentials_encrypted)),
        expires_at=row.expires_at,
    )


async def _check_target(db: AsyncSession, user: User, adapter: ProviderAdapter, request: StartBankAuthorizationRequest) -> str | None:
    """Check what the sign-in is for, and return the nickname to keep for a new connection

    Raises:
        HTTPException 403: The provider isn't offered for new connections
        HTTPException 404: The connection isn't the user's
        HTTPException 409: The connection's credential still works
        HTTPException 422: The nickname is too long, a reconnection names one, or the connection is another provider's
    """
    if request.connection_id is None:
        nickname = read_nickname(request.nickname)
        require_offered(adapter.provider_id, adapter)
        return nickname
    if request.nickname:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A reconnected connection keeps its nickname, so please leave this blank",
        )
    reconnecting = await check_reconnectable(db, user, request.connection_id)
    if reconnecting.provider_id != adapter.provider_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                f"That connection belongs to {reconnecting.provider_name}, not {adapter.provider_name}. "
                f"Please reconnect it with {reconnecting.provider_name}"
            ),
        )
    return None


def _build_redirect_url(origin: str | None) -> str:
    """Return the address the bank sends the user back to: the page's own origin and the return path

    Taken from the browser's Origin header and never from the request body, so the address the bank
    returns to is the one the user is on

    Raises:
        HTTPException 422: The request carries no origin, or one that isn't a web address's origin
    """
    parts = urlsplit(origin or "")
    is_origin = (
        parts.scheme in ("http", "https")
        and bool(parts.hostname)
        and "@" not in parts.netloc
        and parts.path == ""
        and not parts.query
        and not parts.fragment
    )
    if not is_origin:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "Your browser didn't share the address of this page, so the bank can't send you back to it. "
                "Please reload the page and try again"
            ),
        )
    return f"{parts.scheme}://{parts.netloc}{RETURN_PATH}"


async def delete_expired_bank_authorizations(db: AsyncSession) -> None:
    """Delete every user's bank sign-ins past their expiry

    Sign-ins are secured to their owner, so the rule lives in a SECURITY DEFINER helper that reaches
    every user's rows

    Args:
        db: Active database session
    """
    await db.execute(text(f"SELECT {PRUNE_EXPIRED_BANK_AUTHORIZATIONS}()"))
