"""What the allowance check does to insights: the figures and the saved ranges beside them are refused together

A refusal answers 403 with the deployment's own sentence, after sign-in is checked, so a request with
no sign-in is still 401 and never learns what the deployment allows
"""

import pytest

from app.allowance_hook import AllowanceKind
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check

_RANGE = {"from_date": "2026-01-01", "to_date": "2026-01-31"}


@pytest.mark.parametrize(
    ("method", "path", "params"),
    [
        pytest.param("GET", "/insights/period-glance", _RANGE, id="figures"),
        pytest.param("GET", "/insights/saved-ranges", None, id="saved-ranges"),
    ],
)
async def test_insights_refused_by_the_check_answers_403_with_the_reason_and_401_without_a_sign_in(client, method, path, params):
    """Every route of the router asks, saved ranges included, and a request with no sign-in never reaches the check"""
    headers = _get_auth_header(await _create_user(client))
    asked = install_check(refused={AllowanceKind.INSIGHTS})

    unauthenticated = await client.request(method, path, params=params)
    refused = await client.request(method, path, params=params, headers=headers)

    assert unauthenticated.status_code == 401, unauthenticated.text
    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == ALLOWANCE_REASON
    assert [(request.kind, request.held, request.adding) for request in asked] == [(AllowanceKind.INSIGHTS, None, 0)]


async def test_insights_allowed_by_the_check_still_answer(client):
    """Refusing another kind leaves the figures alone"""
    headers = _get_auth_header(await _create_user(client))
    install_check(refused={AllowanceKind.SAVED_INSIGHTS_RANGE})

    response = await client.get("/insights/period-glance", params=_RANGE, headers=headers)

    assert response.status_code == 200, response.text
