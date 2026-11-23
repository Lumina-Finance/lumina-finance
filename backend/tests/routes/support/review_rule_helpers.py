"""Shared test builders for import rules on waiting bank items: a signed-up user with the records a rule names, and the press"""

import uuid
from dataclasses import dataclass

from tests.routes.support.bank_sync_helpers import _new_account, _review_page, _sign_up
from tests.routes.support.import_rule_helpers import _make_category, _make_merchant


@dataclass(frozen=True)
class _RulesInbox:
    """A signed-up user's Everyday and Savings accounts, the Harbour Coffee merchant and the Coffee expense category"""

    headers: dict
    user_id: uuid.UUID
    everyday_id: str
    savings_id: str
    merchant_id: str
    category_id: str


async def _rules_inbox(client) -> _RulesInbox:
    """Sign up with empty Everyday and Savings accounts in CAD, a Harbour Coffee merchant and a Coffee expense category"""
    headers, user_id = await _sign_up(client)
    everyday_id = await _new_account(client, headers, "Everyday")
    savings_id = await _new_account(client, headers, "Savings")
    merchant_id = await _make_merchant(client, headers, "Harbour Coffee")
    category_id = await _make_category(client, headers, "Coffee")
    return _RulesInbox(headers, user_id, everyday_id, savings_id, merchant_id, category_id)


async def _rules_version(client, headers, **params) -> str:
    """Return the version of the rules the first page of the review list answers with"""
    return (await _review_page(client, headers, **params))["rules"]["version"]


async def _apply(client, headers, rules_version: str, account_ids: list[str] | None = None):
    """Press Apply rules over some accounts or every one, at the version of the rules the list showed"""
    return await client.post(
        "/bank-review/items/apply-rules", json={"account_ids": account_ids, "rules_version": rules_version}, headers=headers
    )
