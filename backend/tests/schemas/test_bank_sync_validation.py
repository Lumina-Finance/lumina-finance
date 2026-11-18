"""Bank sync request schemas

A credential claims once and is a secret, so a refusal of a request body names what is wrong and
never repeats it, however the body is malformed
"""

import pytest
from pydantic import ValidationError

from app.schemas.bank_sync import CreateBankConnectionRequest

# A credential nothing may repeat
_CREDENTIAL = "fake-access-key"
_FIELD = "access_key"


@pytest.mark.parametrize(
    ("body", "loc", "error_type"),
    [
        ({"credentials": {_FIELD: _CREDENTIAL}}, ("provider",), "missing"),
        (_CREDENTIAL, (), "model_type"),
        ([_CREDENTIAL], (), "model_type"),
        ({"provider": "fake", "credentials": _CREDENTIAL}, ("credentials",), "dict_type"),
        ({"provider": "fake", "credentials": {_FIELD: [_CREDENTIAL]}}, ("credentials",), "dict_type"),
        ({"provider": "fake", "credential": _CREDENTIAL}, ("credentials",), "missing"),
        ({"provider": "fake", "credentials": {f"field_{n}": _CREDENTIAL for n in range(9)}}, ("credentials",), "too_long"),
    ],
    ids=["missing-provider", "bare-credential", "in-a-list", "not-an-object", "not-a-string", "under-another-name", "too-many-fields"],
)
def test_claim_body_refused_never_repeats_the_credential(body, loc, error_type):
    """However the body is malformed, the refusal names what is wrong without the credential"""
    with pytest.raises(ValidationError) as refused:
        CreateBankConnectionRequest.model_validate(body)

    assert [(error["loc"], error["type"]) for error in refused.value.errors()] == [(loc, error_type)]
    assert _CREDENTIAL not in refused.value.json()
    assert _CREDENTIAL not in str(refused.value)
