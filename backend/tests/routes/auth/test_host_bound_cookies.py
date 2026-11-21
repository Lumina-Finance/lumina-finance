"""Host-bound sign-in cookie tests: an HTTPS request uses `__Host-` names no sibling hostname can plant

The test client's base URL is plain HTTP, so a test marks a request as HTTPS with the proxy header the
deployed app sees, and hands Secure cookies back by name (`_resend_cookie`), as a browser on an HTTPS
site would
"""

import pytest
from starlette.requests import Request

from app.routes.auth.cookie_helpers import request_is_https
from tests.routes.support import (
    SIGNUP_PAYLOAD,
    _assert_bare_cookie,
    _assert_host_bound_cookie,
    _create_user,
    _get_auth_header,
    _resend_cookie,
    sign_up_confirmed,
)

_HOST_COOKIE = "__Host-refresh_token"
_ATTACKER_EMAIL = "attacker@example.com"
_LOGIN = {"email": SIGNUP_PAYLOAD["email"], "password": SIGNUP_PAYLOAD["password"]}


def _over_https(client) -> None:
    """Make every request the client sends from here on look like one that arrived over HTTPS"""
    client.headers["x-forwarded-proto"] = "https"


async def _sign_up_attacker(client):
    """Sign a second user up, whose valid refresh token an attacker would plant in the victim's browser"""
    return await sign_up_confirmed(client, {**SIGNUP_PAYLOAD, "email": _ATTACKER_EMAIL})


async def test_login_over_https_sets_the_refresh_cookie_host_bound(client):
    """The cookie a browser accepts only from this exact host, so a sibling hostname can't overwrite it"""
    await _create_user(client)
    client.cookies.clear()
    _over_https(client)

    resp = await client.post("/auth/login", json=_LOGIN)

    assert resp.status_code == 200
    header = _assert_host_bound_cookie(resp, "refresh_token")
    assert "httponly" in header
    assert "samesite=lax" in header


async def test_login_and_logout_over_plain_http_keep_the_bare_cookie_a_browser_there_accepts(client):
    """An install used over plain HTTP still signs in and out, since a browser there refuses Secure cookies"""
    await _create_user(client)
    client.cookies.clear()

    login = await client.post("/auth/login", json=_LOGIN)
    logout = await client.post("/auth/logout")

    assert login.status_code == 200
    assert "max-age" in _assert_bare_cookie(login, "refresh_token")
    assert logout.status_code == 200
    assert "max-age=0" in _assert_bare_cookie(logout, "refresh_token"), "the removal carries no Secure either"


async def test_refresh_and_logout_over_https_use_the_host_bound_cookie(client):
    """A user signed in over HTTPS stays signed in through a refresh, and signing out removes the cookie the browser holds"""
    _over_https(client)
    signup = await _create_user(client)
    _assert_host_bound_cookie(signup, "refresh_token")
    _resend_cookie(client, _HOST_COOKIE)

    refreshed = await client.post("/auth/refresh")

    assert refreshed.status_code == 200
    assert refreshed.json()["user"]["email"] == SIGNUP_PAYLOAD["email"]
    _assert_host_bound_cookie(refreshed, "refresh_token")
    _resend_cookie(client, _HOST_COOKIE, resp=refreshed)

    logout = await client.post("/auth/logout")

    assert logout.status_code == 200
    assert "max-age=0" in _assert_host_bound_cookie(logout, "refresh_token")
    again = await client.post("/auth/refresh")
    assert (again.status_code, again.json()["detail"]) == (401, "Session is not active"), "signing out ended the session"
    assert "max-age=0" in _assert_host_bound_cookie(again, "refresh_token"), "a refused refresh removes the host-bound cookie too"


@pytest.mark.parametrize("planted", ["attacker-session", "garbage"], ids=["valid-token", "garbage"])
async def test_plain_cookie_planted_beside_the_host_bound_one_changes_nothing(client, planted):
    """A sibling hostname's cookie under the bare name neither swaps the user's session nor signs them out"""
    victim = await _create_user(client)
    attacker = await _sign_up_attacker(client)
    planted_value = attacker.cookies["refresh_token"] if planted == "attacker-session" else "garbage"
    _over_https(client)
    client.cookies.clear()
    client.cookies.set(_HOST_COOKIE, victim.cookies["refresh_token"])
    client.cookies.set("refresh_token", planted_value)

    resp = await client.post("/auth/refresh")

    assert "refresh_token=" in resp.request.headers["cookie"], "the planted cookie reached the app"
    assert resp.status_code == 200
    assert resp.json()["user"]["email"] == SIGNUP_PAYLOAD["email"], "the genuine session answers, not the planted one"
    assert not any(h.lower().startswith("refresh_token=") for h in resp.headers.get_list("set-cookie")), "the planted cookie is left alone"


async def test_plain_cookie_alone_over_https_is_not_a_session(client):
    """With no host-bound cookie, a bare-name cookie can't sign anyone in, so a planted session is never adopted

    This is also what a user signed in before the change meets once: their cookie has the bare name, so
    they sign in again
    """
    await _create_user(client)
    attacker = await _sign_up_attacker(client)
    _over_https(client)
    client.cookies.clear()
    client.cookies.set("refresh_token", attacker.cookies["refresh_token"])

    resp = await client.post("/auth/refresh")

    assert "refresh_token=" in resp.request.headers["cookie"], "the planted cookie reached the app"
    assert (resp.status_code, resp.json()["detail"]) == (401, "Missing refresh token")
    assert "access_token" not in resp.json()


async def test_plain_cookie_over_https_does_not_end_the_session_it_names_at_logout(client):
    """A logout sent with only a bare-name cookie revokes nothing, since a sibling hostname could have planted it"""
    signup = await _create_user(client)
    bare_cookie = signup.cookies["refresh_token"]
    _over_https(client)
    client.cookies.clear()
    client.cookies.set("refresh_token", bare_cookie)

    logout = await client.post("/auth/logout")

    assert "refresh_token=" in logout.request.headers["cookie"], "the bare cookie reached the app"
    assert logout.status_code == 200
    del client.headers["x-forwarded-proto"]
    still_signed_in = await client.post("/auth/refresh")
    assert still_signed_in.status_code == 200, "the session the bare cookie names was never revoked"


@pytest.mark.parametrize(
    ("forwarded", "scheme", "expected"),
    [
        ("https", "http", True),
        ("HTTPS", "http", True),
        ("https, http", "http", True),
        ("http", "https", False),
        (None, "https", True),
        (None, "http", False),
    ],
    ids=["header", "header-upper-case", "first-of-a-chain", "header-over-scheme", "scheme-only", "neither"],
)
def test_request_is_https_follows_the_proxy_header_then_the_scheme(forwarded, scheme, expected):
    """The cookie name rests on this answer, so a proxy's chain or capitals can't make an HTTPS install fall back to bare names"""
    headers = [(b"x-forwarded-proto", forwarded.encode())] if forwarded else []
    request = Request({"type": "http", "scheme": scheme, "server": ("test", 443), "path": "/", "query_string": b"", "headers": headers})

    assert request_is_https(request) is expected


async def test_stale_reauth_proof_sent_by_a_password_account_over_https_is_removed_host_bound(client):
    """A password account steps up with its password, and a proof it still holds is only cleared away"""
    signup = await _create_user(client)
    auth = _get_auth_header(signup)
    client.cookies.clear()
    _over_https(client)
    client.cookies.set("__Host-oidc_reauth_stepup", "left-over-proof")

    resp = await client.post("/auth/sessions/end-others", headers=auth, json={"password": SIGNUP_PAYLOAD["password"]})

    assert resp.status_code == 204
    assert "max-age=0" in _assert_host_bound_cookie(resp, "oidc_reauth_stepup")
