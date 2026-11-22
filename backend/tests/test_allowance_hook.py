"""Allowance check tests calling the hook directly, for what a route test cannot set up"""

import uuid

import pytest

from app.allowance_hook import AllowanceKind, AllowanceRequest, Refusal, find_refusal, set_allowance_check

_REQUEST = AllowanceRequest(user_id=uuid.uuid4(), kind=AllowanceKind.ACCOUNT, held=3, adding=1)


async def test_find_refusal_with_no_check_installed_allows():
    """A server nobody installed a check on lets every user add and use everything"""
    assert await find_refusal(_REQUEST) is None


async def test_find_refusal_returns_the_refusal_the_check_gave():
    """The check is told the request as it was made, and its refusal reaches the caller whole"""
    seen: list[AllowanceRequest] = []

    async def check(request: AllowanceRequest) -> Refusal | None:
        seen.append(request)
        return Refusal("This server allows no more of these")

    set_allowance_check(check)

    assert await find_refusal(_REQUEST) == Refusal("This server allows no more of these")
    assert seen == [_REQUEST]


async def test_find_refusal_lets_an_error_the_check_raises_reach_the_caller():
    """A check that fails never lets anyone in by default, so its error is the caller's to fail the request with"""

    async def check(request: AllowanceRequest) -> Refusal | None:
        raise ConnectionError("The check failed")

    set_allowance_check(check)

    with pytest.raises(ConnectionError):
        await find_refusal(_REQUEST)


@pytest.mark.parametrize("answer", [True, False, "no"], ids=["true", "false", "text"])
async def test_find_refusal_with_an_answer_that_is_not_none_or_a_refusal_raises(answer):
    """True would read as a yes and False as a no, so an answer that is neither None nor a Refusal is a mistake in the check"""

    async def check(request: AllowanceRequest) -> Refusal | None:
        return answer

    set_allowance_check(check)

    with pytest.raises(TypeError, match=type(answer).__name__):
        await find_refusal(_REQUEST)
