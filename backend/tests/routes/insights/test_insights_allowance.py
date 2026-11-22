"""What the allowance check does to insights: the figures and the saved ranges beside them are refused together

A refusal answers 403 with the check's own sentence, after sign-in is checked, so a request with
no sign-in is still 401 and never learns what the check allows. A check that raises fails the
request as any server fault does, and nothing is answered
"""

import pytest
from httpx import ASGITransport, AsyncClient

from app.allowance_hook import AllowanceKind, AllowanceRequest, Refusal, set_allowance_check
from app.main import app
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check

_RANGE = {"from_date": "2026-01-01", "to_date": "2026-01-31"}


@pytest.mark.parametrize(
    ("path", "params"),
    [
        pytest.param("/insights/period-glance", _RANGE, id="figures"),
        pytest.param("/insights/saved-ranges", None, id="saved-ranges"),
    ],
)
async def test_insights_refused_by_the_check_answers_403_with_the_reason_and_401_without_a_sign_in(client, path, params):
    """Every route of the router asks, saved ranges included, and a request with no sign-in never reaches the check"""
    headers = _get_auth_header(await _create_user(client))
    asked = install_check(refused={AllowanceKind.INSIGHTS})

    unauthenticated = await client.get(path, params=params)
    refused = await client.get(path, params=params, headers=headers)

    assert unauthenticated.status_code == 401, unauthenticated.text
    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == ALLOWANCE_REASON
    assert [(request.kind, request.held, request.adding) for request in asked] == [(AllowanceKind.INSIGHTS, None, 0)]


async def test_insights_with_a_check_that_raises_fail_as_a_server_fault_and_answer_nothing(client):
    """A check that errors never lets the figures out, and the user is shown the usual server fault"""
    headers = _get_auth_header(await _create_user(client))

    async def check(request: AllowanceRequest) -> Refusal | None:
        raise ConnectionError("The check failed")

    set_allowance_check(check)
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as failing_client:
        failed = await failing_client.get("/insights/period-glance", params=_RANGE, headers=headers)

    assert failed.status_code == 500, failed.text
