"""Auth password reset route helpers"""

from fastapi import Response, status

from app.schemas.auth import PasswordResetResponse
from app.services.auth.password_reset import CompletedPasswordReset


def answer_completed_reset(completed: CompletedPasswordReset) -> PasswordResetResponse | Response:
    """Return the answer to a finished reset

    A reset that only changed the password answers 204 as it always has, so only a reset that also
    removed the account's linked sign-in providers carries a body for the success screen to show

    Args:
        completed: The finished reset

    Returns:
        The notice of removed providers, or an empty 204
    """
    if completed.sign_in_providers_removed:
        return PasswordResetResponse(sign_in_providers_removed=completed.sign_in_providers_removed)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
