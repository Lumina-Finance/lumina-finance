"""Adding an institution to the shared list, within each person's limit of pending ones"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import InstitutionStatus
from app.models.institution import Institution
from app.models.institution_submission import InstitutionSubmission
from app.models.user import User
from app.schemas.institution import CreateInstitutionRequest

# Every user shares one institution list, so one person adding without end would bury everyone's
# picker. An institution stops counting once it's approved or deleted, so the person can add another
MAX_PENDING_SUBMISSIONS = 20

LIMIT_REACHED_DETAIL = (
    f"This institution isn't added: you already have {MAX_PENDING_SUBMISSIONS} waiting to be approved. Please pick one from the list"
)


async def require_room_for_submission(db: AsyncSession, user: User) -> None:
    """Refuse a person who already has the most pending institutions one person may add

    Raises:
        HTTPException 403: The person's pending institutions are at the limit
    """
    # Two additions racing would each count the same total and both pass, so the user's row is locked
    # first and the later one counts after the earlier commits. A lock that leaves the key alone, so the
    # foreign key checks of the user's other writes don't wait on it
    await db.execute(select(User.id).where(User.id == user.id).with_for_update(key_share=True))

    # Row-level security narrows the submissions to the requester's own
    pending_count = await db.scalar(
        select(func.count())
        .select_from(InstitutionSubmission)
        .join(Institution, Institution.id == InstitutionSubmission.institution_id)
        .where(Institution.status == InstitutionStatus.PENDING)
    )
    if pending_count >= MAX_PENDING_SUBMISSIONS:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=LIMIT_REACHED_DETAIL)


def add_submitted_institution(db: AsyncSession, user: User, data: CreateInstitutionRequest) -> Institution:
    """Add a pending institution and the record of who added it, leaving the commit to the caller

    The identifier is set here rather than at flush, since the submission needs it before anything
    is flushed, and flushing early would move a name clash outside the caller's commit guard
    """
    # Explicitly PENDING, since client input for status is never trusted
    institution = Institution(
        id=uuid.uuid4(),
        name=data.name,
        country_code=data.country_code,
        website=data.website,
        logo_url=data.logo_url,
        status=InstitutionStatus.PENDING,
    )
    db.add(institution)
    db.add(InstitutionSubmission(institution_id=institution.id, user_id=user.id))
    return institution
