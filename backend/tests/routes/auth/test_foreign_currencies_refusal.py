"""Signing up, signing in and renewing a session never depend on the allowance check, so a check that fails cannot lock anyone out"""

from app.allowance_hook import AllowanceRequest, Refusal, set_allowance_check
from tests.routes.support import SIGNUP_PAYLOAD, _create_user

_LOGIN = {"email": SIGNUP_PAYLOAD["email"], "password": "SecurePassword123!"}


async def test_sign_up_sign_in_and_renewal_work_while_the_check_raises(client):
    """A check that errors on every request leaves each response that hands the app its user answering 200"""

    async def check(request: AllowanceRequest) -> Refusal | None:
        raise ConnectionError("The check failed")

    set_allowance_check(check)

    signed_up = await _create_user(client)
    signed_in = await client.post("/auth/login", json=_LOGIN)
    renewed = await client.post("/auth/refresh")

    assert [signed_up.status_code, signed_in.status_code, renewed.status_code] == [201, 200, 200]
