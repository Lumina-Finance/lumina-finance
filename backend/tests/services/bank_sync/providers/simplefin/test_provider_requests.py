"""SimpleFIN's quota answers and the request budget

A quota warning ignored would let Lumina exceed SimpleFIN Bridge's limit and disable the user's
token, while a notice taken for one would hold back requests the budget still has
"""

from datetime import timedelta

import pytest

from app.models.bank_connection import ProviderRequestPurpose
from app.services.bank_sync.provider_requests import (
    RequestBudget,
    RequestBudgetSpent,
    is_quota_spent,
    mark_request_budget_spent,
    read_request_budget,
    reserve_provider_request,
)
from tests.fake_simplefin_bridge import FakeBridgeTransport
from tests.services.bank_sync.providers.simplefin.stand_ins import FakeBridgeScenario, simplefin_adapter
from tests.services.bank_sync.test_provider_requests import _NOW, _connection_with_requests


@pytest.mark.parametrize("fault", ["rate_limited", "quota_warning"], ids=["429", "quota-warning-with-data"])
async def test_quota_spent_answer_marks_the_budget_spent_until_the_oldest_request_leaves(db, scenario: FakeBridgeScenario, fault):
    """With 3 of 20 used, a 429 or a quota warning beside data leaves none until the oldest of the 3 leaves"""
    await scenario.add_harbour_accounts()
    adapter = simplefin_adapter(FakeBridgeTransport())
    access_url = await adapter.claim_setup_token(scenario.setup_token)
    await scenario.change("PUT", "/fault", {"kind": fault})
    oldest = _NOW - timedelta(hours=5)
    connection = await _connection_with_requests(db, oldest, _NOW - timedelta(hours=1))
    await reserve_provider_request(db, connection, purpose=ProviderRequestPurpose.DISCOVERY, now=_NOW)

    result = await adapter.discover(access_url, currency_exponents={"USD": 2})
    assert is_quota_spent(result)
    await mark_request_budget_spent(db, connection, now=_NOW)

    frees_at = oldest + timedelta(hours=24)
    assert await read_request_budget(db, connection, now=_NOW) == RequestBudget(
        limit=20, used=20, available_again_at=frees_at, held_by_provider=True
    )
    with pytest.raises(RequestBudgetSpent) as refused:
        await reserve_provider_request(db, connection, purpose=ProviderRequestPurpose.SYNC, now=frees_at - timedelta(seconds=1))
    assert refused.value.available_again_at == frees_at
    await reserve_provider_request(db, connection, purpose=ProviderRequestPurpose.SYNC, now=frees_at)


async def test_other_warnings_beside_data_leave_the_budget_alone(scenario: FakeBridgeScenario):
    """A maintenance notice isn't about the quota, so the rest of the budget can still be used"""
    await scenario.add_harbour_accounts()
    adapter = simplefin_adapter(FakeBridgeTransport())
    access_url = await adapter.claim_setup_token(scenario.setup_token)
    await scenario.change("POST", "/errors", {"code": "gen.maintenance", "msg": "Some banks may be slow to update tonight."})

    result = await adapter.discover(access_url, currency_exponents={"USD": 2})

    assert result.warnings
    assert not is_quota_spent(result)
