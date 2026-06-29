"""Passkey registration and management routes"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import WEBAUTHN_RP_ID
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.auth import (
    PasskeyConfigResponse,
    PasskeyRegisterRequest,
    PasskeyRenameRequest,
    PasskeySummary,
)
from app.services.auth import (
    build_passkey_registration_options,
    list_passkeys,
    register_passkey,
    remove_passkey,
    rename_passkey,
)

# Browsers reject ceremonies whose options are not raw WebAuthn JSON, so they are returned untouched
_OPTIONS_MEDIA_TYPE = "application/json"

router = APIRouter(prefix="/passkeys", tags=["auth"])


@router.get("/config", response_model=PasskeyConfigResponse)
async def passkey_config_route():
    """Report the relying party id the client checks the current origin against

    Public because the login screen needs it before any user is known

    Returns:
        The configured relying party id
    """
    return PasskeyConfigResponse(rp_id=WEBAUTHN_RP_ID)


@router.get("", response_model=list[PasskeySummary])
async def list_passkeys_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """List the authenticated user's registered passkeys

    Args:
        user: Authenticated user resolved from the access token
        db: Active database session

    Returns:
        The user's passkeys, newest first
    """
    return await list_passkeys(db, user.id)


@router.post("/register/options")
async def passkey_registration_options_route(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Begin registration by returning ceremony options for the browser

    Args:
        user: Authenticated user resolved from the access token
        db: Active database session

    Returns:
        WebAuthn registration options as raw JSON
    """
    options_json = await build_passkey_registration_options(db, user.id, user.email)
    return Response(content=options_json, media_type=_OPTIONS_MEDIA_TYPE)


@router.post("/register", response_model=PasskeySummary, status_code=status.HTTP_201_CREATED)
async def register_passkey_route(
    data: PasskeyRegisterRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Verify a finished registration ceremony and store the passkey

    Args:
        data: The browser's attestation response and the label to store it under
        user: Authenticated user resolved from the access token
        db: Active database session

    Returns:
        The stored passkey summary

    Raises:
        HTTPException: The challenge is unknown or expired, or the attestation fails to verify
    """
    return await register_passkey(db, user.id, data.credential, data.name)


@router.patch("/{passkey_id}", response_model=PasskeySummary)
async def rename_passkey_route(
    passkey_id: uuid.UUID,
    data: PasskeyRenameRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Relabel one of the authenticated user's passkeys

    Args:
        passkey_id: Passkey to relabel
        data: The new label
        user: Authenticated user resolved from the access token
        db: Active database session

    Returns:
        The updated passkey summary

    Raises:
        HTTPException: The passkey does not exist or belongs to another user
    """
    return await rename_passkey(db, user.id, passkey_id, data.name)


@router.delete("/{passkey_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_passkey_route(
    passkey_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete one of the authenticated user's passkeys

    Args:
        passkey_id: Passkey to delete
        user: Authenticated user resolved from the access token
        db: Active database session

    Raises:
        HTTPException: The passkey does not exist or belongs to another user
    """
    await remove_passkey(db, user.id, passkey_id)
