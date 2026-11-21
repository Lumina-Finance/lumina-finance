"""A token verifier placed in front of the app can find the keys and check an access token's issuer

It reads the discovery document, then the key set the document names, then each token's signature,
issuer and audience, so the three must agree, and an issuer change must end the sessions signed under
the old one
"""

from urllib.parse import urlsplit

import httpx
import jwt
import pytest

from app.main import app
from app.services.auth.tokens import SignupConfirmationClaims, create_signup_confirmation_token
from tests.routes.support.auth_helpers import SIGNUP_PAYLOAD, _assert_host_bound_cookie, _create_user, _resend_cookie

ISSUER = "https://api.example.test/auth/"

# What a verifier adds to the issuer to find the document
DISCOVERY_PATH = "/.well-known/openid-configuration"


async def test_default_issuer_publishes_no_discovery_document(client):
    """An install that keeps the plain issuer answers the discovery address with a 404"""
    resp = await client.get("/auth/.well-known/openid-configuration")

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Discovery document not found"


@pytest.mark.parametrize("issuer", [ISSUER, ISSUER.removesuffix("/")], ids=["trailing slash", "no trailing slash"])
async def test_https_issuer_publishes_a_document_that_leads_to_the_key_set(client, issuer_set_to, issuer):
    """Asked with no access token where a standard verifier looks, the document names the issuer and a key set the app serves

    The standard drops a trailing slash from the issuer before adding the well-known path
    """
    issuer_set_to(issuer)

    resp = await client.get(urlsplit(issuer.removesuffix("/") + DISCOVERY_PATH).path)

    assert resp.status_code == 200
    document = resp.json()
    assert document["issuer"] == issuer
    assert document["id_token_signing_alg_values_supported"] == ["RS256"]
    keys_resp = await client.get(urlsplit(document["jwks_uri"]).path)
    assert keys_resp.status_code == 200
    assert {key["use"] for key in keys_resp.json()["keys"]} == {"sig"}


async def test_access_token_verifies_against_the_published_document_and_keys(client, issuer_set_to):
    """A verifier that follows the document finds the token's key by its kid and accepts the issuer and audience"""
    issuer_set_to(ISSUER)
    signup_resp = await _create_user(client)
    access_token = signup_resp.json()["access_token"]
    document = (await client.get("/auth/.well-known/openid-configuration")).json()
    published_keys = (await client.get(urlsplit(document["jwks_uri"]).path)).json()["keys"]
    key_id = jwt.get_unverified_header(access_token)["kid"]
    signing_key = jwt.PyJWK(next(key for key in published_keys if key["kid"] == key_id))

    claims = jwt.decode(access_token, signing_key, algorithms=["RS256"], audience="access", issuer=document["issuer"])

    assert claims["aud"] == "access"
    me_resp = await client.get("/test/me", headers={"Authorization": f"Bearer {access_token}"})
    assert me_resp.status_code == 200


async def test_changing_the_issuer_ends_the_sessions_signed_under_the_old_one(client, issuer_set_to):
    """After the issuer changes, the old access and refresh tokens and an unused sign-up link are refused"""
    signup_resp = await _create_user(client)
    access_token = signup_resp.json()["access_token"]
    client.cookies.set("refresh_token", signup_resp.cookies["refresh_token"])
    confirmation_token = create_signup_confirmation_token(
        SignupConfirmationClaims("second@example.com", "Second", None, SIGNUP_PAYLOAD["tz"], SIGNUP_PAYLOAD["base_currency"])
    )
    assert (await client.get("/test/me", headers={"Authorization": f"Bearer {access_token}"})).status_code == 200

    issuer_set_to(ISSUER)

    me_resp = await client.get("/test/me", headers={"Authorization": f"Bearer {access_token}"})
    refresh_resp = await client.post("/auth/refresh")
    confirm_resp = await client.post("/auth/signup/confirm", json={"token": confirmation_token, "new_password": SIGNUP_PAYLOAD["password"]})
    assert (me_resp.status_code, me_resp.json()["detail"]) == (401, "Invalid or expired token")
    assert (refresh_resp.status_code, refresh_resp.json()["detail"]) == (401, "Invalid or expired refresh token")
    assert (confirm_resp.status_code, confirm_resp.json()["detail"]) == (400, "Invalid or expired confirmation link")


async def test_verifier_checks_tokens_of_an_api_on_its_own_host_beside_the_frontend(client, issuer_set_to):
    """With the site on example.test and the API on api.example.test, a verifier reaches the keys and accepts the tokens

    The browser signs in from the site's origin over HTTPS and keeps a host-bound cookie. The verifier is
    a separate caller with no cookie and no access token, which reads only the issuer's address, the document
    it finds there and the key set the document names, as a gateway in front of the API does
    """
    api_issuer = "https://api.example.test/auth"
    issuer_set_to(api_issuer)
    client.headers.update({"x-forwarded-proto": "https", "origin": "https://example.test"})
    signup_resp = await _create_user(client)
    _assert_host_bound_cookie(signup_resp, "refresh_token")
    _resend_cookie(client, "__Host-refresh_token")
    refreshed = await client.post("/auth/refresh")
    assert refreshed.status_code == 200
    tokens = [signup_resp.json()["access_token"], refreshed.json()["access_token"]]

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://api.example.test") as verifier:
        document = (await verifier.get(f"{api_issuer}/.well-known/openid-configuration")).json()
        published_keys = (await verifier.get(document["jwks_uri"])).json()["keys"]

    assert document["issuer"] == api_issuer
    assert document["jwks_uri"].startswith("https://api.example.test/")
    for token in tokens:
        key_id = jwt.get_unverified_header(token)["kid"]
        signing_key = jwt.PyJWK(next(key for key in published_keys if key["kid"] == key_id))
        claims = jwt.decode(token, signing_key, algorithms=["RS256"], audience="access", issuer=document["issuer"])
        assert claims["aud"] == "access"
