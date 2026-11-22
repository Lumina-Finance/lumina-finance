"""A second access key lets the access key change without a verifier in front of the app refusing tokens

While both keys are published, a token signed by either verifies. Once the second key is removed, a token it
signed is refused. Settings are read at import, so the second key is set where the key set and verification
read it
"""

import base64

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.config.jwt import JWT_ACCESS_KID, JWT_ACCESS_PRIVATE_KEY, JWT_REFRESH_KID
from app.services.auth import tokens
from tests.routes.support import _create_user
from tests.routes.support.auth_helpers import SECOND_ACCESS_KID, signed_again


@pytest.fixture
def second_private_key():
    """Return a key that is not the access signing key"""
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def second_key_published(monkeypatch, second_private_key):
    """Publish and accept the second key beside the signing key"""
    monkeypatch.setattr(tokens, "JWT_ACCESS_SECOND_KEY", (SECOND_ACCESS_KID, second_private_key.public_key()))


async def _access_token(client) -> str:
    """Return the access token of a newly signed-up user, signed with the signing key"""
    return (await _create_user(client)).json()["access_token"]


async def _status_with(client, token: str) -> int:
    """Return the status of a request that needs an access token"""
    return (await client.get("/test/me", headers={"Authorization": f"Bearer {token}"})).status_code


@pytest.mark.usefixtures("second_key_published")
async def test_the_key_set_publishes_the_second_key_beside_the_signing_keys(client, second_private_key):
    """A verifier that caches the key set already holds whichever access key signs next"""
    keys = (await client.get("/auth/.well-known/jwks.json")).json()["keys"]

    assert [key["kid"] for key in keys] == [JWT_ACCESS_KID, SECOND_ACCESS_KID, JWT_REFRESH_KID]
    second = keys[1]
    numbers = second_private_key.public_key().public_numbers()
    assert int.from_bytes(base64.urlsafe_b64decode(second["n"] + "=="), "big") == numbers.n, "the second key's own modulus"
    assert int.from_bytes(base64.urlsafe_b64decode(second["e"] + "=="), "big") == numbers.e, "the second key's own exponent"
    assert (second["kty"], second["use"], second["alg"]) == ("RSA", "sig", "RS256")


@pytest.mark.usefixtures("second_key_published")
async def test_a_token_signed_by_either_published_key_is_accepted(client, second_private_key):
    """Tokens signed before and after the keys swap both work while both keys are published"""
    access_token = await _access_token(client)

    assert await _status_with(client, access_token) == 200, "the signing key's token"
    assert await _status_with(client, signed_again(access_token, second_private_key, SECOND_ACCESS_KID)) == 200, "the second key's token"
    # Only the second key's ID picks the second key, so a signing key token keeps working whatever ID it names
    assert await _status_with(client, signed_again(access_token, JWT_ACCESS_PRIVATE_KEY, "another-kid")) == 200, "another ID"
    assert await _status_with(client, signed_again(access_token, JWT_ACCESS_PRIVATE_KEY, None)) == 200, "no ID"


@pytest.mark.usefixtures("second_key_published")
async def test_a_token_whose_key_id_names_the_other_key_is_refused(client, second_private_key):
    """The key ID only picks which key to check, so a token never passes against a key that didn't sign it"""
    access_token = await _access_token(client)

    assert await _status_with(client, signed_again(access_token, second_private_key, JWT_ACCESS_KID)) == 401, "second key, signing key's ID"
    assert await _status_with(client, signed_again(access_token, JWT_ACCESS_PRIVATE_KEY, SECOND_ACCESS_KID)) == 401, (
        "signing key, second key's ID"
    )


@pytest.mark.usefixtures("second_key_published")
async def test_a_token_whose_header_cannot_be_read_is_refused_while_a_second_key_is_set(client):
    """Reading the key ID first must not turn a garbled token into a server error"""
    resp = await client.get("/test/me", headers={"Authorization": "Bearer not.a.valid.jwt"})

    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or expired token"


async def test_a_token_signed_by_a_key_no_longer_published_is_refused(client, second_private_key):
    """Once the second key is removed, a token it signed stops working even though it names that key's ID"""
    assert [kid for kid, _ in tokens.access_public_keys()] == [JWT_ACCESS_KID], "no second key is published"
    access_token = await _access_token(client)

    assert await _status_with(client, signed_again(access_token, second_private_key, SECOND_ACCESS_KID)) == 401
