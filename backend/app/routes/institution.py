import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.base import InstitutionStatus
from app.models.institution import Institution
from app.models.user import User
from app.schemas.institution import CreateInstitutionRequest, InstitutionResponse

# Auth required on all endpoints — institution data is internal to Lumina users
router = APIRouter(prefix="/institutions", tags=["institutions"])


@router.get("", response_model=list[InstitutionResponse])
async def list_institutions(
    _user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    country_code: str | None = Query(None, min_length=2, max_length=2),
):
    """Return canonical institutions, optionally filtered by country.

    Args:
        _user: Authenticated user (enforces auth gate).
        db: Async database session.
        country_code: Optional ISO 3166-1 alpha-2 filter.

    Returns:
        List of canonical institutions sorted by name.
    """
    query = select(Institution).where(Institution.status == InstitutionStatus.CANONICAL)
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
    """Return a single institution by ID.

    Args:
        institution_id: UUID of the institution.
        _user: Authenticated user (enforces auth gate).
        db: Async database session.

    Returns:
        The matching institution.

    Raises:
        HTTPException 404: Institution not found.
    """
    result = await db.execute(select(Institution).where(Institution.id == institution_id))
    institution = result.scalar_one_or_none()
    if not institution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Institution not found")
    return institution


@router.post("", response_model=InstitutionResponse, status_code=status.HTTP_201_CREATED)
async def create_institution(
    data: CreateInstitutionRequest,
    _user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Submit a new institution for review. Status defaults to PENDING.

    Args:
        data: Institution details (name, country_code, website).
        _user: Authenticated user (enforces auth gate).
        db: Async database session.

    Returns:
        The created institution with PENDING status.
    """
    institution = Institution(
        name=data.name,
        country_code=data.country_code,
        website=data.website,
        status=InstitutionStatus.PENDING,
    )
    db.add(institution)
    await db.commit()
    await db.refresh(institution)
    return institution
