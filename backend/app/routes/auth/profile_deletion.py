"""Profile deletion route"""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.database import get_db, get_session_factory
from app.dependencies import get_current_user, get_user_who_may_cancel_deletion
from app.models.user import User
from app.routes.auth.cookie_helpers import clear_refresh_cookie, read_oidc_reauth_stepup_cookie
from app.routes.auth.token_helpers import authorize_sensitive_action
from app.schemas.auth import ProfileDeletionResponse, StepUpRequest, UserInfo
from app.services.profile_deletion import cancel_profile_deletion, request_profile_deletion

router = APIRouter(prefix="/profile", tags=["auth"])


@router.post("/delete", response_model=ProfileDeletionResponse)
async def delete_profile_route(
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    session_factory: Annotated[async_sessionmaker[AsyncSession], Depends(get_session_factory)],
    data: StepUpRequest | None = None,
    oidc_reauth_stepup: Annotated[str | None, Depends(read_oidc_reauth_stepup_cookie)] = None,
):
    """Delete the authenticated user's profile and everything it holds, after step-up

    An account with a password steps up with it and any current second factor. A passwordless account
    instead presents the proof from a fresh provider reauth. Once the step-up passes, the user is
    signed out everywhere, the refresh cookie goes, and the data is deleted after the response, or once
    the waiting period set for deletions has passed

    Args:
        request: FastAPI request object
        response: FastAPI response object for clearing the refresh cookie and a spent proof cookie
        background_tasks: Runs the deletion once the response is out
        user: Authenticated user resolved from the access token
        db: Active database session
        session_factory: Opens the sessions the deletion runs in
        data: Password and a current factor, for an account that has a password
        oidc_reauth_stepup: Reauth proof cookie, for a passwordless account

    Returns:
        When the deletion is due, or None when the profile is being deleted at once

    Raises:
        HTTPException 401: The step-up is missing or fails
    """
    due_at = await authorize_sensitive_action(
        db,
        user,
        request,
        response,
        data,
        oidc_reauth_stepup,
        lambda: request_profile_deletion(db, user, background_tasks, session_factory),
    )
    clear_refresh_cookie(request, response)
    return ProfileDeletionResponse(deletion_due_at=due_at)


@router.post("/delete/cancel", response_model=UserInfo)
async def cancel_profile_deletion_route(
    user: Annotated[User, Depends(get_user_who_may_cancel_deletion)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Cancel the deletion of the authenticated user's profile while it is still waiting

    The only route a profile waiting to be deleted can reach. It needs no new password, since a session
    of a waiting profile can only come from a sign-in made after the deletion was requested. A session
    that outlives the due time reaches it too, and is told why the cancel came too late. A profile with
    no mark, such as one a second tab already cancelled, is answered with the user and left as it is

    Args:
        user: Authenticated user, let through when the profile is marked with a due time
        db: Active database session

    Returns:
        The user's info, with no deletion due

    Raises:
        HTTPException 403: The profile is marked with no due time, so it goes at once
        HTTPException 409: The profile's due time has passed, or the profile is gone
    """
    return await cancel_profile_deletion(db, user)
