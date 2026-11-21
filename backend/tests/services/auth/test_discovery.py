"""The discovery document a verifier in front of the app reads names the issuer exactly as configured

A verifier compares each token's issuer to it character for character, and looks the document up only at
an https address ending in /auth, so no other issuer may carry one
"""

import pytest

from app.services.auth.discovery import build_discovery_document


@pytest.mark.parametrize(
    ("issuer", "jwks_uri"),
    [
        ("https://api.example.test/auth", "https://api.example.test/auth/.well-known/jwks.json"),
        ("https://api.example.test/auth/", "https://api.example.test/auth/.well-known/jwks.json"),
        ("https://example.test/api/auth", "https://example.test/api/auth/.well-known/jwks.json"),
        ("https://api.example.test:8443/auth", "https://api.example.test:8443/auth/.well-known/jwks.json"),
    ],
)
def test_discovery_document_names_the_issuer_exactly_and_the_key_set_beside_it(issuer, jwks_uri):
    """The issuer comes back as configured, trailing slash or not, with the key set address beside it"""
    document = build_discovery_document(issuer)

    assert document == {
        "issuer": issuer,
        "jwks_uri": jwks_uri,
        "id_token_signing_alg_values_supported": ["RS256"],
    }


@pytest.mark.parametrize(
    "issuer",
    [
        "lumina-finance",
        "http://api.example.test/auth",
        "https://api.example.test",
        "https://api.example.test/",
        "https://api.example.test/other",
        "https://api.example.test/oauth",
        "https://api.example.test/auth/extra",
        "https://api.example.test/auth//",
        "https://api.example.test/auth?tenant=one",
        "https://api.example.test/auth?",
        "https://api.example.test/auth#top",
        "https://user:secret@api.example.test/auth",
        "https:///auth",
        "",
    ],
)
def test_discovery_document_is_not_built_for_an_issuer_a_verifier_would_not_look_up(issuer):
    """An issuer that is no https URL ending in /auth gets no document, so no wrong address is published"""
    assert build_discovery_document(issuer) is None
