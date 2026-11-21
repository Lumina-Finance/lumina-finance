"""Caching headers of the sign-in routes"""

import re

import pyotp
import pytest

from app.request_security import MAX_REQUEST_BODY_BYTES
from tests.routes.support import SIGNUP_PAYLOAD, _create_user, _get_auth_header
from tests.routes.support.route_helpers import served_routes

_NO_STORE = "no-store"

# One fixed id for every path parameter, so each test worker collects the same test names
_A_ID = "00000000-0000-4000-8000-000000000001"

_STEP_UP = {"password": SIGNUP_PAYLOAD["password"]}


def _sign_in_routes() -> list[tuple[str, str]]:
    """Return every method and path the app serves under /auth, with path parameters filled in"""
    routes = []
    for template, route in served_routes():
        if template.startswith("/auth/"):
            path = re.sub(r"\{[^}]+\}", _A_ID, template)
            routes.extend((method, path) for method in sorted(route.methods))
    return routes


def test_the_walk_below_covers_the_routes_of_every_sign_in_router():
    """The route list the walk uses holds routes from the main, passkey, provider and native routers"""
    paths = {path for _, path in _sign_in_routes()}

    assert "/auth/login" in paths
    assert "/auth/2fa/setup" in paths
    assert "/auth/passkeys/register/options" in paths
    assert "/auth/oidc/identities" in paths
    assert "/auth/native/exchange" in paths
    assert "/auth/native/handoff" in paths
    assert len(paths) > 30


@pytest.mark.parametrize(("method", "path"), _sign_in_routes())
async def test_every_sign_in_route_answers_with_no_store(client, method, path):
    """A sign-in route says no-store whatever it answers, here a refusal of a bare request

    The walk sends no body and no credentials, so each route answers a refusal. A route added later
    is walked too, so it cannot be left without the header
    """
    response = await client.request(method, path, follow_redirects=False)

    assert response.headers["cache-control"] == _NO_STORE


async def test_two_factor_setup_says_no_store(client):
    """The answer holding an authenticator secret is not cached"""
    auth = _get_auth_header(await _create_user(client))

    response = await client.post("/auth/2fa/setup", headers=auth, json={"step_up": _STEP_UP})

    assert response.status_code == 200
    assert response.headers["cache-control"] == _NO_STORE


async def test_two_factor_confirm_and_recovery_codes_say_no_store(client):
    """The answers holding recovery codes are not cached"""
    auth = _get_auth_header(await _create_user(client))
    secret = (await client.post("/auth/2fa/setup", headers=auth, json={"step_up": _STEP_UP})).json()["secret"]

    confirmed = await client.post("/auth/2fa/confirm", headers=auth, json={"code": pyotp.TOTP(secret).now()})
    await client.post("/auth/2fa/complete", headers=auth)
    regenerated = await client.post(
        "/auth/2fa/recovery-codes",
        headers=auth,
        json={"step_up": {**_STEP_UP, "code": pyotp.TOTP(secret).now()}},
    )

    assert confirmed.status_code == 200
    assert confirmed.headers["cache-control"] == _NO_STORE
    assert regenerated.headers["cache-control"] == _NO_STORE


async def test_passkey_registration_options_say_no_store(client):
    """The answer holding a registration challenge is not cached"""
    auth = _get_auth_header(await _create_user(client))

    response = await client.post("/auth/passkeys/register/options", headers=auth, json={"step_up": _STEP_UP})

    assert response.status_code == 200
    assert response.headers["cache-control"] == _NO_STORE


async def test_linked_provider_list_says_no_store(client):
    """The list of the account's sign-in identities is not cached"""
    auth = _get_auth_header(await _create_user(client))

    response = await client.get("/auth/oidc/identities", headers=auth)

    assert response.status_code == 200
    assert response.headers["cache-control"] == _NO_STORE


async def test_native_handoff_redirect_says_no_store(client):
    """The redirect that carries the handoff code to the app is not cached"""
    access_token = (await _create_user(client)).json()["access_token"]

    response = await client.post(
        "/auth/native/handoff",
        data={"access_token": access_token, "code_challenge": "c" * 43},
        follow_redirects=False,
    )

    assert response.status_code == 303
    assert response.headers["cache-control"] == _NO_STORE


async def test_an_oversized_sign_in_request_refusal_says_no_store(client):
    """A refusal made before the route runs carries the header too"""
    response = await client.post("/auth/login", content=b"x" * (MAX_REQUEST_BODY_BYTES + 1))

    assert response.status_code == 413
    assert response.headers["cache-control"] == _NO_STORE


async def test_routes_outside_sign_in_are_left_alone(client):
    """The header is not added to the rest of the API, the accounts list the sign-in answers sit beside included"""
    auth = _get_auth_header(await _create_user(client))

    health = await client.get("/health")
    accounts = await client.get("/accounts", headers=auth)

    assert accounts.status_code == 200
    assert "cache-control" not in health.headers
    assert "cache-control" not in accounts.headers
