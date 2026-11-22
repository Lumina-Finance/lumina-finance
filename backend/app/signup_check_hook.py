"""A place for code that decides who may sign up to plug in

Code installs one check with set_signup_check. Every sign-up request, and every first sign-in through a
sign-in provider, asks the check before any email goes out or any onboarding starts. With no check
installed, everyone may sign up
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# How long a check may take before the sign-up is refused. A check may ask an outside service, and a
# request waiting on one that stalled would hold its place in the server for as long
SIGNUP_CHECK_TIMEOUT_SECONDS = 10


@dataclass(frozen=True)
class SignupAttempt:
    """What a check is told about a sign-up

    The check is never told whether the address already has an account, so its answer cannot reveal it

    Attributes:
        email: Address spelled as a typed address is stored, with the capitals of the part before the @
            kept, so a check comparing addresses must do so without regard to case
    """

    email: str


SignupCheck = Callable[[SignupAttempt], Awaitable[bool]]

_check: SignupCheck | None = None


def set_signup_check(check: SignupCheck) -> None:
    """Install the check every sign-up must pass, replacing any installed before

    Args:
        check: Async function taking the attempt and returning True to allow it. Any other answer, an
            error it raises or an answer taking longer than SIGNUP_CHECK_TIMEOUT_SECONDS refuses the
            sign-up. A refused sign-up answers as an allowed one does and sends no email
    """
    global _check
    _check = check


async def is_signup_allowed(email: str) -> bool:
    """Return whether the installed check allows a sign-up for the address, or True when none is installed

    Args:
        email: Address the sign-up is for
    """
    check = _check
    if check is None:
        return True
    try:
        async with asyncio.timeout(SIGNUP_CHECK_TIMEOUT_SECONDS):
            answer = await check(SignupAttempt(email=email))
    except Exception as error:
        # Best-effort boundary: a check that fails must refuse rather than let everyone in. Only the
        # class is logged, since the error text may quote the address
        logger.warning("The sign-up check failed, so the sign-up was refused: %s", type(error).__name__)
        return False
    if not isinstance(answer, bool):
        # A check answering something other than True or False is a mistake in it, so it refuses as an
        # error does, and is logged the same way so its owner can find why every sign-up is refused
        logger.warning("The sign-up check answered a %s, not True or False, so the sign-up was refused", type(answer).__name__)
    return answer is True
