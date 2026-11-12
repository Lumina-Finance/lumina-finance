import base64

from tests.fake_simplefin_bridge._helpers import _add_account, _claim, _create_scenario, _get_accounts


async def test_claim_setup_token_twice_refuses_the_second(bridge):
    """A setup token claims one working access URL, and claiming it again gets the Bridge's 403"""
    scenario_id, setup_token = await _create_scenario(bridge)
    await _add_account(bridge, scenario_id, id="ACT-1")

    first = await _claim(bridge, setup_token)
    second = await _claim(bridge, setup_token)

    assert first.status_code == 200
    accounts = await _get_accounts(bridge, first.text)
    assert accounts.status_code == 200
    assert [account["id"] for account in accounts.json()["accounts"]] == ["ACT-1"]
    assert second.status_code == 403


async def test_setup_token_points_at_the_test_origin_whatever_address_minted_it(bridge, monkeypatch):
    """With the app's test origin set, as beside the app, a token minted at another address still claims through that origin"""
    monkeypatch.setenv("BANK_SYNC_SIMPLEFIN_TEST_ORIGIN", "http://fake-bridge:8790/")
    _, setup_token = await _create_scenario(bridge)

    claim = await _claim(bridge, setup_token)

    assert base64.b64decode(setup_token).decode().startswith("http://fake-bridge:8790/simplefin/claim/")
    assert claim.status_code == 200
