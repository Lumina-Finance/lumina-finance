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
