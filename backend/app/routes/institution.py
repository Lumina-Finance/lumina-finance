"""Institution route handlers"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.base import InstitutionStatus
from app.models.institution import Institution
from app.models.user import User
from app.schemas.institution import (
    CreateInstitutionRequest,
    InstitutionResponse,
    UpdateInstitutionRequest,
)
from app.services.cache_state import mark_user_cache_changed

# Auth is required on every endpoint, since institution data is internal to signed-in users
router = APIRouter(prefix="/institutions", tags=["institutions"])

NOT_FOUND_DETAIL = "Institution not found"
DUPLICATE_DETAIL = "Institution with this name and country already exists"


@router.get("", response_model=list[InstitutionResponse])
async def list_institutions(
    _user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    country_code: str | None = Query(None, min_length=2, max_length=2),
):
    """Return all institutions, optionally filtered by country

    Args:
        _user: Authenticated user (enforces auth gate)
        db: Async database session
        country_code: Optional ISO 3166-1 alpha-2 filter

    Returns:
        List of institutions sorted by name
    """
    query = select(Institution)
    if country_code:
        query = query.where(Institution.country_code == country_code)
    result = await db.execute(query.order_by(Institution.name))
    return result.scalars().all()


@router.get("/{institution_id}", response_model=InstitutionResponse)
async def get_institution(
    institution_id: uuid.UUID,
    _user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return a single institution by ID

    Args:
        institution_id: UUID of the institution
        _user: Authenticated user (enforces auth gate)
        db: Async database session

    Returns:
        The matching institution

    Raises:
        HTTPException 404: Institution not found
    """
    result = await db.execute(select(Institution).where(Institution.id == institution_id))
    institution = result.scalar_one_or_none()
    if not institution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_DETAIL)
    return institution


@router.post("", response_model=InstitutionResponse, status_code=status.HTTP_201_CREATED)
async def create_institution(
    data: CreateInstitutionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Submit a new institution for review. Status defaults to PENDING

    Args:
        data: Institution details (name, country_code, website)
        user: Authenticated user (enforces auth gate)
        db: Async database session

    Returns:
        The created institution with PENDING status

    Raises:
        HTTPException 409: Institution with the same name and country already exists
    """
    await _raise_for_duplicate_institution(db, data.name, data.country_code)

    # Explicitly set PENDING, since client input for status is never trusted
    institution = Institution(
        name=data.name,
        country_code=data.country_code,
        website=data.website,
        logo_url=data.logo_url,
        status=InstitutionStatus.PENDING,
    )
    db.add(institution)
    await mark_user_cache_changed(db, user.id)
    await _commit_or_raise_for_duplicate(db)
    await db.refresh(institution)
    return institution


@router.patch("/{institution_id}", response_model=InstitutionResponse)
async def update_institution(
    institution_id: uuid.UUID,
    data: UpdateInstitutionRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Apply a correction to an institution every user on the instance shares

    The row drops back to PENDING, so a reviewer can tell a corrected institution from an
    untouched one. A request carrying no fields changes nothing and leaves the status alone

    Args:
        institution_id: UUID of the institution being corrected
        data: Fields to change, all optional
        user: Authenticated user (enforces auth gate)
        db: Async database session

    Returns:
        The corrected institution with PENDING status

    Raises:
        HTTPException 404: Institution not found
        HTTPException 409: Another institution already holds the new name and country
    """
    result = await db.execute(select(Institution).where(Institution.id == institution_id))
    institution = result.scalar_one_or_none()
    if not institution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_DETAIL)

    updates = data.model_dump(exclude_unset=True)
    if not updates:
        return institution

    # A correction that leaves the name and country pair as it was cannot collide with
    # anything, and checking it anyway would find the row itself
    name = updates.get("name", institution.name)
    country_code = updates.get("country_code", institution.country_code)
    if (name, country_code) != (institution.name, institution.country_code):
        await _raise_for_duplicate_institution(db, name, country_code)

    for field, value in updates.items():
        setattr(institution, field, value)

    # Nothing has reviewed the correction, so the row stops counting as canonical
    institution.status = InstitutionStatus.PENDING
    await mark_user_cache_changed(db, user.id)
    await _commit_or_raise_for_duplicate(db)
    await db.refresh(institution)
    return institution


async def _raise_for_duplicate_institution(
    db: AsyncSession,
    name: str,
    country_code: str,
) -> None:
    """Reject a name and country pair an institution already holds

    Args:
        db: Async database session
        name: Institution name being claimed
        country_code: ISO 3166-1 alpha-2 code being claimed

    Raises:
        HTTPException 409: An institution already holds the pair
    """
    # Look for an institution already registered under this name and country
    result = await db.execute(
        select(Institution.id).where(
            Institution.name == name,
            Institution.country_code == country_code,
        ),
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=DUPLICATE_DETAIL)


async def _commit_or_raise_for_duplicate(db: AsyncSession) -> None:
    """Commit an institution write, answering a lost race with the same conflict

    Two writes claiming one name and country pair both clear the check before either
    commits, so the second reaches the unique constraint instead

    Args:
        db: Async database session

    Raises:
        HTTPException 409: The pair was taken between the check and the commit
    """
    try:
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=DUPLICATE_DETAIL,
        ) from error
