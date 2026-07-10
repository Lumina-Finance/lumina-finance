"""OIDC provider environment declaration tests"""

import os

import pytest

from app import config
from app.config import load_oidc_provider_configs


@pytest.fixture(autouse=True)
def clean_oidc_env(monkeypatch):
    """Isolate each test from the developer's own OIDC declarations

    The loader also needs a public app origin so declared providers pass the callback check
    """
    for key in list(os.environ):
        if key.startswith("OIDC_"):
            monkeypatch.delenv(key)
    monkeypatch.setattr(config, "APP_URL", "http://app.test")


def _declare_generic(monkeypatch, **overrides):
    """Configure a complete generic provider block, with fields removable through overrides"""
    values = {
        "OIDC_GENERIC_ISSUER": "https://idp.test",
        "OIDC_GENERIC_CLIENT_ID": "client-123",
        "OIDC_GENERIC_CLIENT_SECRET": "secret-abc",
        **overrides,
    }
    for key, value in values.items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, value)


def test_no_declaration_yields_no_providers():
    """An environment without a generic client id enables nothing"""
    assert load_oidc_provider_configs() == []


def test_generic_provider_loads_with_default_display_name(monkeypatch):
    """A generic provider loads its block and falls back to the neutral display name"""
    _declare_generic(monkeypatch)

    configs = load_oidc_provider_configs()

    assert len(configs) == 1
    assert configs[0].slug == "generic"
    assert configs[0].issuer == "https://idp.test"
    assert configs[0].display_name == "OIDC"


def test_generic_display_name_override(monkeypatch):
    """An operator-supplied display name labels the sign-in button"""
    _declare_generic(monkeypatch, OIDC_GENERIC_DISPLAY_NAME="Authentik")

    configs = load_oidc_provider_configs()

    assert configs[0].display_name == "Authentik"


def test_generic_requires_issuer(monkeypatch):
    """A generic provider without an issuer fails loudly at startup"""
    _declare_generic(monkeypatch, OIDC_GENERIC_ISSUER=None)

    with pytest.raises(RuntimeError, match="OIDC_GENERIC_ISSUER"):
        load_oidc_provider_configs()


def test_generic_disabled_without_client_id(monkeypatch):
    """The client id is the enable switch, so a block missing it stays off"""
    _declare_generic(monkeypatch, OIDC_GENERIC_CLIENT_ID=None)

    assert load_oidc_provider_configs() == []


def test_generic_requires_client_secret(monkeypatch):
    """An enabled provider missing its client secret fails loudly at startup"""
    _declare_generic(monkeypatch, OIDC_GENERIC_CLIENT_SECRET=None)

    with pytest.raises(RuntimeError, match="OIDC_GENERIC_CLIENT_SECRET"):
        load_oidc_provider_configs()


def test_unknown_provider_block_is_ignored(monkeypatch):
    """Only the generic slug is known, so an unrelated provider block enables nothing"""
    monkeypatch.setenv("OIDC_GITHUB_CLIENT_ID", "client-123")

    assert load_oidc_provider_configs() == []


def test_issuer_keeps_trailing_slash(monkeypatch):
    """An issuer is kept verbatim because the provider must echo it exactly"""
    _declare_generic(monkeypatch, OIDC_GENERIC_ISSUER="https://idp.test/application/o/lumina/")

    configs = load_oidc_provider_configs()

    assert configs[0].issuer == "https://idp.test/application/o/lumina/"


def test_non_https_issuer_is_rejected(monkeypatch):
    """A plain HTTP issuer is refused unless it is loopback"""
    _declare_generic(monkeypatch, OIDC_GENERIC_ISSUER="http://idp.internal")

    with pytest.raises(RuntimeError, match="must use https"):
        load_oidc_provider_configs()


def test_scopes_must_include_openid(monkeypatch):
    """A scope override without openid cannot produce an ID token and is refused"""
    _declare_generic(monkeypatch, OIDC_GENERIC_SCOPES="email profile")

    with pytest.raises(RuntimeError, match="must include openid"):
        load_oidc_provider_configs()
