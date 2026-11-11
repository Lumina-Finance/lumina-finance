"""Claiming a credential the user supplied as a new connection, through any provider

The credential claims once and is a secret, so a refusal of the request body never repeats it, and
a provider that is withdrawn, turned off or no longer installed takes no new connection
"""

import json
from collections.abc import Mapping
from typing import override

import httpx
import pytest

from app.schemas.bank_sync import CreateBankConnectionRequest
from app.services.bank_sync import availability
from app.services.bank_sync.providers.contract import CredentialField
from tests.routes.support.bank_sync_helpers import _sign_up, _stored_connections
from tests.services.bank_sync.fake_provider import ACCESS_KEY, FakeProviderAdapter, _returned, remove_provider, use_adapter

# A credential the fake provider claims, and the access it hands over for it
_CREDENTIAL = "fake-access-key"
_STORED = "fake-stored-access"


async def _claim(
    client, headers, credential: str = _CREDENTIAL, nickname: str | None = None, provider: str = "fake", credentials: dict | None = None
) -> httpx.Response:
    """Claim a credential through the route, as the fake provider's one field unless other credentials are given"""
    sent = {ACCESS_KEY: credential} if credentials is None else credentials
    return await client.post("/bank-sync/connections", json={"provider": provider, "credentials": sent, "nickname": nickname}, headers=headers)


class _TwoFieldProvider(FakeProviderAdapter):
    """A provider whose connect form takes two tokens, as one with an app token and a user token does"""

    credential_fields = (
        CredentialField("app_token", "App ID token", "Paste the app token", 64),
        CredentialField("user_token", "User access token", "Paste the user token", 64),
    )

    @override
    async def claim(self, supplied: Mapping[str, str]) -> str:
        self.claims.append(dict(supplied))
        return _STORED


def _claimable(fake_provider: FakeProviderAdapter) -> None:
    """Let the fake provider claim the credential once, listing one bank account straight after"""
    fake_provider.claimable[_CREDENTIAL] = _STORED
    fake_provider.outcomes = [_returned("ACT-1")]


@pytest.mark.parametrize(
    ("body", "content_type", "loc", "error_type"),
    [
        ({"credentials": {ACCESS_KEY: _CREDENTIAL}}, "application/json", ["body", "provider"], "missing"),
        ({"provider": "fake", "credentials": {ACCESS_KEY: _CREDENTIAL}}, "text/plain", ["body"], "model_attributes_type"),
        (_CREDENTIAL, "application/json", ["body"], "model_attributes_type"),
        ([_CREDENTIAL], "application/json", ["body"], "model_attributes_type"),
        ({"provider": "fake", "credentials": _CREDENTIAL}, "application/json", ["body", "credentials"], "dict_type"),
        ({"provider": "fake", "credentials": {ACCESS_KEY: [_CREDENTIAL]}}, "application/json", ["body", "credentials"], "dict_type"),
        ({"provider": "fake", "credential": _CREDENTIAL}, "application/json", ["body", "credentials"], "missing"),
        (
            {"provider": "fake", "credentials": {f"field_{n}": _CREDENTIAL for n in range(9)}},
            "application/json",
            ["body", "credentials"],
            "too_long",
        ),
    ],
    ids=[
        "missing-provider",
        "sent-as-text",
        "bare-credential",
        "in-a-list",
        "not-an-object",
        "not-a-string",
        "under-another-name",
        "too-many-fields",
    ],
)
async def test_claim_refused_by_validation_never_repeats_the_credential(client, body, content_type, loc, error_type):
    """However the body is malformed, the refusal names what is wrong without the credential"""
    headers, _ = await _sign_up(client)

    refused = await client.post("/bank-sync/connections", content=json.dumps(body), headers={**headers, "Content-Type": content_type})

    assert refused.status_code == 422, refused.text
    assert [(error["loc"], error["type"]) for error in refused.json()["detail"]] == [(loc, error_type)]
    assert _CREDENTIAL not in refused.text


def test_claim_request_printed_masks_the_credential():
    """A request that reaches a log or a traceback never shows the credential"""
    assert _CREDENTIAL not in repr(CreateBankConnectionRequest(provider="fake", credentials={ACCESS_KEY: _CREDENTIAL}))


async def test_claim_hands_the_adapter_each_field_it_lists_by_key_and_nothing_else(client, monkeypatch):
    """A provider with two fields gets both values under their keys, and a field it doesn't list is left out"""
    provider = _TwoFieldProvider()
    provider.outcomes = [_returned("ACT-1")]
    use_adapter(monkeypatch, provider)
    headers, _ = await _sign_up(client)

    response = await _claim(client, headers, credentials={"app_token": "app-1", "user_token": "user-1", "other": "ignored"})

    assert response.status_code == 201, response.text
    assert provider.claims == [{"app_token": "app-1", "user_token": "user-1"}]


@pytest.mark.parametrize(
    ("credentials", "detail"),
    [
        ({"app_token": "app-1"}, "Please paste the user access token from Fake Bank Online"),
        ({"app_token": "app-1", "user_token": "   "}, "Please paste the user access token from Fake Bank Online"),
        (
            {"app_token": "a" * 65, "user_token": "user-1"},
            "That app ID token is too long. Please copy only the app ID token from Fake Bank Online and try again",
        ),
    ],
    ids=["missing", "blank", "too-long"],
)
async def test_claim_refuses_a_field_missing_blank_or_too_long_by_its_name_before_the_provider_is_asked(
    client, monkeypatch, credentials, detail
):
    """Each field is checked against its own label and length, and the refusal never repeats what was sent"""
    provider = _TwoFieldProvider()
    use_adapter(monkeypatch, provider)
    headers, _ = await _sign_up(client)

    refused = await _claim(client, headers, credentials=credentials)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == detail
    assert "a" * 65 not in refused.text
    assert provider.claims == []
    assert await _stored_connections() == []


async def test_claim_through_the_fake_provider_saves_the_connection_under_its_id(client, fake_provider):
    """The engine claims and lists through whichever provider was chosen, storing its id and its name for the response"""
    _claimable(fake_provider)
    headers, _ = await _sign_up(client)

    response = await _claim(client, headers)

    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["provider"], body["provider_name"], body["provider_site"], body["provider_available"]) == (
        "fake",
        "Fake Bank",
        "Fake Bank Online",
        True,
    )
    assert [account["external_id"] for account in body["accounts"]] == ["ACT-1"]
    assert [connection.provider for connection in await _stored_connections()] == ["fake"]


async def test_claim_with_the_provider_withdrawn_is_refused(client, fake_provider, monkeypatch):
    """New connections are refused once the environment withdraws the provider's offer"""
    _claimable(fake_provider)
    use_adapter(monkeypatch, fake_provider, offered=False)
    headers, _ = await _sign_up(client)

    refused = await _claim(client, headers)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == "Fake Bank is not offered for new connections. Existing connections keep working"
    assert await _stored_connections() == []


@pytest.mark.parametrize("gone", ["turned-off", "removed", "never-installed"])
async def test_claim_with_a_provider_this_server_lacks_is_refused(client, fake_provider, monkeypatch, gone):
    """A provider that is turned off, has had its folder deleted or never existed has nothing to claim with"""
    _claimable(fake_provider)
    provider = "fake"
    if gone == "turned-off":
        use_adapter(monkeypatch, fake_provider, enabled=False)
    elif gone == "removed":
        remove_provider(monkeypatch, "fake")
    else:
        provider = "lunar_bank"
    headers, _ = await _sign_up(client)

    refused = await _claim(client, headers, provider=provider)

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Choose a bank provider this server supports"
    assert fake_provider.claimable == {_CREDENTIAL: _STORED}
    assert await _stored_connections() == []


async def test_claim_by_a_user_who_may_not_link_bank_accounts_is_refused(client, fake_provider, monkeypatch):
    """The bank-linking check is enforced on the claim, not only in the interface"""
    _claimable(fake_provider)
    monkeypatch.setattr(availability, "may_link_bank_accounts", lambda _user_id: False)
    headers, _ = await _sign_up(client)

    refused = await _claim(client, headers)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == "Bank sync isn't available for your account"
    assert await _stored_connections() == []


@pytest.mark.parametrize(("nickname", "stored"), [("J" * 64, "J" * 64), ("   ", None), (None, None)], ids=["64-characters", "blank", "none"])
async def test_claim_nickname_up_to_64_characters_is_kept_and_blank_means_none(client, fake_provider, nickname, stored):
    """A nickname at the limit is kept whole, and a blank one leaves the provider's name showing"""
    _claimable(fake_provider)
    headers, _ = await _sign_up(client)

    response = await _claim(client, headers, nickname=nickname)

    assert response.status_code == 201, response.text
    assert response.json()["nickname"] == stored


async def test_claim_nickname_over_64_characters_is_refused_before_the_credential_is_spent(client, fake_provider):
    """A 65-character nickname is refused, and the credential still claims afterwards"""
    _claimable(fake_provider)
    headers, _ = await _sign_up(client)

    refused = await _claim(client, headers, nickname="J" * 65)
    retried = await _claim(client, headers, nickname="Joint")

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Keep the nickname to 64 characters or fewer"
    assert retried.status_code == 201, retried.text
