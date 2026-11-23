"""GET /me/feature-grants, the features the installed allowance check lets the signed-in user use"""

from app.allowance_hook import AllowanceKind
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.support.allowance_helpers import install_check


async def test_every_feature_is_granted_without_a_check(client):
    """A server with no allowance check grants every feature, bank sync first"""
    headers = _get_auth_header(await _create_user(client))

    response = await client.get("/me/feature-grants", headers=headers)

    assert response.status_code == 200
    assert response.json() == {"features": ["bank_sync", "insights", "foreign_currencies"]}


async def test_no_feature_is_granted_when_the_check_refuses_every_one(client):
    """Bank sync, insights and foreign currencies all refused grant nothing"""
    headers = _get_auth_header(await _create_user(client))
    install_check(refused={AllowanceKind.INSIGHTS, AllowanceKind.BANK_SYNC, AllowanceKind.FOREIGN_CURRENCIES})

    response = await client.get("/me/feature-grants", headers=headers)

    assert response.json() == {"features": []}


async def test_lists_each_feature_the_check_allows_the_user(client):
    """Insights refused while the others are allowed grants the others, each asked as a feature for the signed-in user"""
    headers = _get_auth_header(await _create_user(client))
    user_id = (await client.get("/me", headers=headers)).json()["id"]
    asked = install_check(refused={AllowanceKind.INSIGHTS})

    response = await client.get("/me/feature-grants", headers=headers)

    assert response.status_code == 200
    assert response.json() == {"features": ["bank_sync", "foreign_currencies"]}
    assert {(str(request.user_id), request.kind, request.held, request.adding) for request in asked} == {
        (user_id, AllowanceKind.BANK_SYNC, None, 0),
        (user_id, AllowanceKind.INSIGHTS, None, 0),
        (user_id, AllowanceKind.FOREIGN_CURRENCIES, None, 0),
    }


async def test_a_record_or_change_kind_refused_keeps_every_feature_granted(client):
    """A check refusing more accounts or a change of main currency still grants every feature, since neither is a feature"""
    headers = _get_auth_header(await _create_user(client))
    install_check(refused={AllowanceKind.ACCOUNT, AllowanceKind.MAIN_CURRENCY_CHANGE})

    response = await client.get("/me/feature-grants", headers=headers)

    assert response.json() == {"features": ["bank_sync", "insights", "foreign_currencies"]}


async def test_without_sign_in_returns_401(client):
    """Nobody signed in is never answered"""
    response = await client.get("/me/feature-grants")

    assert response.status_code == 401
