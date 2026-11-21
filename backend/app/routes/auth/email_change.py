"""Email change routes"""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.routes.auth.cookie_helpers import read_oidc_reauth_stepup_cookie
from app.routes.auth.token_helpers import authorize_sensitive_action
from app.schemas.auth import ConfirmEmailChangeRequest, ConfirmEmailChangeResponse, RequestEmailChangeRequest
from app.services.auth import confirm_email_change, reject_unchanged_email, request_email_change

router = APIRouter(prefix="/email/change", tags=["auth"])


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
async def request_email_change_route(
    data: RequestEmailChangeRequest,
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    oidc_reauth_stepup: Annotated[str | None, Depends(read_oidc_reauth_stepup_cookie)] = None,
):
    """Email a confirmation link to a new address for the authenticated user's account, after step-up

    An account with a password steps up with it and any current second factor. A passwordless account
    instead presents the proof from a fresh provider reauth. The response is always 204 once the
    step-up passes, so the endpoint never reveals whether another account uses the address, and the
    email goes out after it. The address on the account changes only when the link is confirmed

    Args:
        data: The new address, and the step-up for an account that has a password
        request: FastAPI request object
        response: FastAPI response object for clearing a spent proof cookie
        background_tasks: Runs the send once the response is out
        user: Authenticated user resolved from the access token
        db: Active database session
        oidc_reauth_stepup: Reauth proof cookie, for a passwordless account

    Raises:
        HTTPException: The address is the account's current one, or the step-up is missing or fails
    """
    # Checked before the step-up, since the step-up spends the proof or counts a password attempt
    reject_unchanged_email(user, data.new_email)
    await authorize_sensitive_action(
        db,
        user,
        request,
        response,
        data.step_up,
        oidc_reauth_stepup,
        lambda: request_email_change(db, user, data.new_email, background_tasks),
    )


@router.post("/confirm", response_model=ConfirmEmailChangeResponse)
async def confirm_email_change_route(
    data: ConfirmEmailChangeRequest,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Change the account's email to the address its emailed link was sent to, and sign it out everywhere

    Needs no session, since the link is opened from a mailbox. The token travels in the body, never the
    address, so it stays out of access logs

    Args:
        data: The emailed token
        background_tasks: Runs the notice to the old address once the response is out
        db: Active database session

    Returns:
        The address the account has now

    Raises:
        HTTPException: The link is invalid, expired, replaced or used, or another account has taken the address
    """
    return ConfirmEmailChangeResponse(email=await confirm_email_change(db, data.token, background_tasks))
