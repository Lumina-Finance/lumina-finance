"""Deciding a waiting item clears the rule values it holds

Only an item still waiting may hold the rules' values, so a write that accepts or dismisses one has to
clear them, or the database refuses the write and the request fails with a server error
"""

import pytest

from app.models.bank_transaction import BankTransactionDisposition
from tests.routes.support.bank_sync_helpers import BANK_DATE, _commit_review_item, _stored_item
from tests.routes.support.review_rule_helpers import _rules_inbox

_FILL = {"merchant": {"id": "00000000-0000-4000-8000-000000000001", "rule": {"id": "00000000-0000-4000-8000-000000000002", "name": "Coffee"}}}
_DIGEST = "a" * 64


async def _decide(client, inbox, item_id, route: str):
    """Decide one item the way the route says: add or dismiss it alone, or in a bulk request at the version the list showed"""
    values = {"merchant_id": inbox.merchant_id, "category_id": inbox.category_id}
    if route == "add":
        single = {"dt": BANK_DATE.isoformat(), "amount": -1250, **values}
        return await client.post(f"/bank-review/items/{item_id}/add", json=single, headers=inbox.headers)
    if route == "dismiss":
        return await client.post(f"/bank-review/items/{item_id}/dismiss", headers=inbox.headers)
    bulk = {"items": [{"id": str(item_id), "version": 1}], **(values if route == "bulk-add" else {})}
    return await client.post(f"/bank-review/items/{route}", json=bulk, headers=inbox.headers)


@pytest.mark.parametrize("route", ["add", "bulk-add", "dismiss", "bulk-dismiss"])
async def test_accepting_or_dismissing_an_item_that_holds_rule_values_clears_them(client, route):
    """The item holds a fill and the digest it was put through, and the decision succeeds and leaves neither"""
    inbox = await _rules_inbox(client)
    item_id = await _commit_review_item(inbox.everyday_id, rule_fill=_FILL, rules_version=_DIGEST)

    decided = await _decide(client, inbox, item_id, route)

    assert decided.status_code in (200, 201, 204), decided.text
    stored = await _stored_item(item_id)
    assert stored.disposition != BankTransactionDisposition.AWAITING_REVIEW
    assert (stored.rule_fill, stored.rules_version) == (None, None)
