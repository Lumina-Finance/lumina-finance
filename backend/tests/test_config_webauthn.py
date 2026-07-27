import pytest

from app.config.webauthn import _DEFAULT_WEBAUTHN_RP_NAME, resolve_webauthn_rp_name


@pytest.mark.parametrize(
    ("runtime", "configured_name", "expected"),
    [
        ("server", "", _DEFAULT_WEBAUTHN_RP_NAME),
        ("server", "Custom Name", _DEFAULT_WEBAUTHN_RP_NAME),
        ("lambda", "Custom Name", "Custom Name"),
        ("lambda", "", _DEFAULT_WEBAUTHN_RP_NAME),
        ("lambda", "   ", _DEFAULT_WEBAUTHN_RP_NAME),
    ],
)
def test_webauthn_rp_name_runtime_gate(runtime, configured_name, expected):
    """The relying party name is fixed for the server runtime and configurable otherwise"""
    assert resolve_webauthn_rp_name(runtime, configured_name) == expected
